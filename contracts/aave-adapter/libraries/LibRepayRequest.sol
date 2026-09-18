// SPDX-License-Identifier: MIT
pragma solidity ^0.8.25;

import { FHE, euint64, euint128 } from "@fhenixprotocol/cofhe-contracts/FHE.sol";
import { LibAdapterStorage } from "./LibAdapterStorage.sol";
import { IFHERC20 } from "../../token/interfaces/IFHERC20.sol";
import { DataTypes } from "@aave/core-v3/contracts/protocol/libraries/types/DataTypes.sol";
import { IERC20 } from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import { IERC20Metadata } from "@openzeppelin/contracts/token/ERC20/extensions/IERC20Metadata.sol";
import { IScaledBalanceToken } from "@aave/core-v3/contracts/interfaces/IAToken.sol";

library LibRepayRequest {
    function repayRequest(address asset, euint64 amount, DataTypes.InterestRateMode interestRateMode) internal {
        LibAdapterStorage.Storage storage s = LibAdapterStorage.getStorage();

        address cToken = s.tokenAddressToCTokenAddress[asset];
        if (cToken == address(0)) revert LibAdapterStorage.InvalidCTokenAddress(asset);

        euint64 scaledDebt = s.scaledDebts[msg.sender][asset];
        uint256 reserveNormalizedDebt = s.aavePool.getReserveNormalizedVariableDebt(asset);

        euint128 realDebt128 = FHE.div(
            FHE.mul(FHE.asEuint128(scaledDebt), FHE.asEuint128(reserveNormalizedDebt)),
            FHE.asEuint128(uint256(1e27))
        );
        euint64 realDebt = FHE.asEuint64(realDebt128);
        euint64 safeAmount = FHE.select(FHE.lte(amount, realDebt), amount, realDebt);

        FHE.allow(safeAmount, cToken);
        euint64 transferred = IFHERC20(cToken).confidentialTransferFrom(msg.sender, address(this), safeAmount);
        FHE.allowThis(transferred);

        s.repayRequests.push(
            LibAdapterStorage.RepayRequestData({
                sender: msg.sender,
                asset: asset,
                amount: transferred,
                interestRateMode: interestRateMode
            })
        );

        emit LibAdapterStorage.RepayRequested(asset, msg.sender, transferred, interestRateMode);

        if (s.repayRequests.length >= s.REQUEST_THRESHOLD) {
            _tryFormBatch(s, asset, interestRateMode);
        }
    }

    function _tryFormBatch(
        LibAdapterStorage.Storage storage s,
        address asset,
        DataTypes.InterestRateMode interestRateMode
    ) private {
        uint256 threshold = s.REQUEST_THRESHOLD;
        LibAdapterStorage.RepayRequestData[] memory matched = new LibAdapterStorage.RepayRequestData[](threshold);
        uint256[] memory matchedIndexes = new uint256[](threshold);
        euint64[] memory amounts = new euint64[](threshold);
        uint256 count = 0;

        for (uint256 i = 0; i < s.repayRequests.length && count < threshold; i++) {
            if (s.repayRequests[i].asset == asset && s.repayRequests[i].interestRateMode == interestRateMode) {
                matched[count] = s.repayRequests[i];
                matchedIndexes[count] = i;
                amounts[count] = s.repayRequests[i].amount;
                count++;
            }
        }
        if (count < threshold) return;

        (uint256 batchId, euint64 total) = LibAdapterStorage.formBatch(amounts);

        for (uint256 i = 0; i < matched.length; i++) {
            s.batchIdToRepayRequests[batchId].push(matched[i]);
        }

        emit LibAdapterStorage.RepayBatchFormed(asset, batchId, matched.length, uint256(euint64.unwrap(total)));

        for (uint256 i = matchedIndexes.length; i > 0; i--) {
            uint256 idx = matchedIndexes[i - 1];
            s.repayRequests[idx] = s.repayRequests[s.repayRequests.length - 1];
            s.repayRequests.pop();
        }
    }

    function unwrapRepayForFinalize(uint256 batchId, uint64 batchTotal, bytes calldata signature) internal {
        LibAdapterStorage.Storage storage s = LibAdapterStorage.getStorage();
        LibAdapterStorage.RepayRequestData[] storage requests = s.batchIdToRepayRequests[batchId];
        if (requests.length == 0) revert LibAdapterStorage.NotEnoughRepayRequest();

        LibAdapterStorage.verifyBatchTotal(batchId, batchTotal, signature);

        address cToken = s.tokenAddressToCTokenAddress[requests[0].asset];
        uint256 ctHash = LibAdapterStorage.unwrapAndTrackClaim(cToken, batchTotal);
        s.batchIdToUnwrapCtHash[batchId] = ctHash;

        emit LibAdapterStorage.RepayUnwrapped(batchId, batchTotal, ctHash);
    }

    function finalizeRepayRequests(uint256 batchId, uint64 unwrappedAmount, bytes calldata unwrapSignature) internal {
        LibAdapterStorage.Storage storage s = LibAdapterStorage.getStorage();

        LibAdapterStorage.RepayRequestData[] memory requests = s.batchIdToRepayRequests[batchId];
        if (requests.length == 0) revert LibAdapterStorage.NotEnoughRepayRequest();
        if (unwrappedAmount == 0) revert LibAdapterStorage.AmountIsZero();

        address asset = requests[0].asset;
        address cToken = s.tokenAddressToCTokenAddress[asset];
        DataTypes.InterestRateMode interestRateMode = requests[0].interestRateMode;

        LibAdapterStorage.settleUnwrapClaim(cToken, s.batchIdToUnwrapCtHash[batchId], unwrappedAmount, unwrapSignature);

        uint256 amount = uint256(unwrappedAmount) *
            (10 ** (IERC20Metadata(asset).decimals() - IERC20Metadata(cToken).decimals()));

        address debtToken = s.aavePool.getReserveData(asset).variableDebtTokenAddress;
        uint256 beforeScaledDebt = IScaledBalanceToken(debtToken).scaledBalanceOf(address(this));

        IERC20(asset).approve(address(s.aavePool), amount);
        s.aavePool.repay(asset, amount, uint256(interestRateMode), address(this));

        uint256 afterScaledDebt = IScaledBalanceToken(debtToken).scaledBalanceOf(address(this));
        uint256 multiplier = ((beforeScaledDebt - afterScaledDebt) * (10 ** 6)) / amount;

        _applyRepayToUsers(s, requests, multiplier, asset);

        emit LibAdapterStorage.FinalizeRepayRequest(asset, batchId);

        delete s.batchIdToRepayRequests[batchId];
        s.batchIdToTotalAmount[batchId] = euint64.wrap(bytes32(0));
        delete s.batchIdToUnwrapCtHash[batchId];
    }

    function _applyRepayToUsers(
        LibAdapterStorage.Storage storage s,
        LibAdapterStorage.RepayRequestData[] memory requests,
        uint256 multiplier,
        address asset
    ) private {
        for (uint256 i = 0; i < requests.length; i++) {
            address sender = requests[i].sender;

            euint64 scaledDecrease = FHE.div(
                FHE.mul(requests[i].amount, FHE.asEuint64(uint64(multiplier))),
                FHE.asEuint64(uint64(1e6))
            );
            euint64 newDebt = FHE.sub(s.scaledDebts[sender][asset], scaledDecrease);
            s.scaledDebts[sender][asset] = newDebt;

            FHE.allow(newDebt, sender);
            FHE.allowThis(newDebt);

            LibAdapterStorage.setMaxBorrowables(s.scaledBalances[sender][asset], sender);
        }
    }
}
