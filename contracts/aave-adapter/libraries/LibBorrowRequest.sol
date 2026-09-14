// SPDX-License-Identifier: MIT
pragma solidity ^0.8.25;

import { FHE, euint64 } from "@fhenixprotocol/cofhe-contracts/FHE.sol";
import { LibAdapterStorage } from "./LibAdapterStorage.sol";
import { FHERC20Wrapper } from "../../token/FHERC20Wrapper.sol";
import { IFHERC20 } from "../../token/interfaces/IFHERC20.sol";
import { DataTypes } from "@aave/core-v3/contracts/protocol/libraries/types/DataTypes.sol";
import { IERC20 } from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import { IERC20Metadata } from "@openzeppelin/contracts/token/ERC20/extensions/IERC20Metadata.sol";
import { IScaledBalanceToken } from "@aave/core-v3/contracts/interfaces/IAToken.sol";

library LibBorrowRequest {
    function borrowRequest(
        address asset,
        euint64 amount,
        uint16 referralCode,
        DataTypes.InterestRateMode interestRateMode
    ) internal {
        LibAdapterStorage.Storage storage s = LibAdapterStorage.getStorage();

        euint64 maxBorrowable = s.userMaxBorrowablePerAsset[msg.sender][asset];
        euint64 safeAmount = FHE.select(FHE.lte(amount, maxBorrowable), amount, FHE.asEuint64(0));

        s.borrowRequests.push(
            LibAdapterStorage.BorrowRequestData({
                sender: msg.sender,
                asset: asset,
                amount: safeAmount,
                interestRateMode: interestRateMode,
                referralCode: referralCode
            })
        );

        FHE.allow(safeAmount, msg.sender);
        FHE.allowThis(safeAmount);

        emit LibAdapterStorage.BorrowRequested(asset, msg.sender, safeAmount, interestRateMode, referralCode);

        if (s.borrowRequests.length >= s.REQUEST_THRESHOLD) {
            _tryFormBatch(s, asset, interestRateMode);
        }
    }

    function _tryFormBatch(
        LibAdapterStorage.Storage storage s,
        address asset,
        DataTypes.InterestRateMode interestRateMode
    ) private {
        uint256 threshold = s.REQUEST_THRESHOLD;
        LibAdapterStorage.BorrowRequestData[] memory matched = new LibAdapterStorage.BorrowRequestData[](threshold);
        uint256[] memory matchedIndexes = new uint256[](threshold);
        euint64[] memory amounts = new euint64[](threshold);
        uint256 count = 0;

        for (uint256 i = 0; i < s.borrowRequests.length && count < threshold; i++) {
            if (s.borrowRequests[i].asset == asset && s.borrowRequests[i].interestRateMode == interestRateMode) {
                matched[count] = s.borrowRequests[i];
                matchedIndexes[count] = i;
                amounts[count] = s.borrowRequests[i].amount;
                count++;
            }
        }
        if (count < threshold) return;

        (uint256 batchId, euint64 total) = LibAdapterStorage.formBatch(amounts);

        for (uint256 i = 0; i < matched.length; i++) {
            s.batchIdToBorrowRequests[batchId].push(matched[i]);
        }

        emit LibAdapterStorage.BorrowBatchFormed(asset, batchId, matched.length, uint256(euint64.unwrap(total)));

        for (uint256 i = matchedIndexes.length; i > 0; i--) {
            uint256 idx = matchedIndexes[i - 1];
            s.borrowRequests[idx] = s.borrowRequests[s.borrowRequests.length - 1];
            s.borrowRequests.pop();
        }
    }

    function finalizeBorrowRequests(uint256 batchId, uint64 batchTotal, bytes calldata signature) internal {
        LibAdapterStorage.Storage storage s = LibAdapterStorage.getStorage();
        LibAdapterStorage.BorrowRequestData[] memory requests = s.batchIdToBorrowRequests[batchId];
        if (requests.length == 0) revert LibAdapterStorage.NotEnoughBorrowRequest();
        if (batchTotal == 0) revert LibAdapterStorage.AmountIsZero();

        LibAdapterStorage.verifyBatchTotal(batchId, batchTotal, signature);

        address asset = requests[0].asset;
        address cToken = s.tokenAddressToCTokenAddress[asset];
        DataTypes.InterestRateMode interestRateMode = requests[0].interestRateMode;

        uint256 amountToBorrow = uint256(batchTotal) *
            (10 ** (IERC20Metadata(asset).decimals() - IERC20Metadata(cToken).decimals()));

        address debtToken = s.aavePool.getReserveData(asset).variableDebtTokenAddress;
        uint256 beforeScaledDebt = IScaledBalanceToken(debtToken).scaledBalanceOf(address(this));

        s.aavePool.borrow(asset, amountToBorrow, uint256(interestRateMode), requests[0].referralCode, address(this));

        uint256 afterScaledDebt = IScaledBalanceToken(debtToken).scaledBalanceOf(address(this));
        uint256 multiplier = (afterScaledDebt - beforeScaledDebt) / (amountToBorrow / (10 ** 6));

        IERC20(asset).approve(cToken, amountToBorrow);
        FHERC20Wrapper(cToken).wrap(address(this), amountToBorrow);

        _applyBorrowToUsers(s, requests, multiplier, asset, cToken);

        emit LibAdapterStorage.FinalizeBorrowRequest(asset, batchId);

        delete s.batchIdToBorrowRequests[batchId];
        s.batchIdToTotalAmount[batchId] = euint64.wrap(bytes32(0));
    }

    function _applyBorrowToUsers(
        LibAdapterStorage.Storage storage s,
        LibAdapterStorage.BorrowRequestData[] memory requests,
        uint256 multiplier,
        address asset,
        address cToken
    ) private {
        for (uint256 i = 0; i < requests.length; i++) {
            address sender = requests[i].sender;

            euint64 scaledIncrease = FHE.div(
                FHE.mul(requests[i].amount, FHE.asEuint64(uint64(multiplier))),
                FHE.asEuint64(uint64(1e6))
            );
            euint64 newDebt = FHE.add(s.scaledDebts[sender][asset], scaledIncrease);
            s.scaledDebts[sender][asset] = newDebt;

            FHE.allowThis(newDebt);
            FHE.allow(newDebt, sender);

            LibAdapterStorage.setMaxBorrowables(s.scaledBalances[sender][asset], sender);

            FHE.allow(requests[i].amount, cToken);
            IFHERC20(cToken).confidentialTransfer(sender, requests[i].amount);
        }
    }
}
