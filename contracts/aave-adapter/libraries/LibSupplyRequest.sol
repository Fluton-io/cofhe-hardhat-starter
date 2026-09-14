// SPDX-License-Identifier: MIT
pragma solidity ^0.8.25;

import { FHE, euint64 } from "@fhenixprotocol/cofhe-contracts/FHE.sol";
import { LibAdapterStorage } from "./LibAdapterStorage.sol";
import { IFHERC20 } from "../../token/interfaces/IFHERC20.sol";
import { IERC20 } from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import { IERC20Metadata } from "@openzeppelin/contracts/token/ERC20/extensions/IERC20Metadata.sol";
import { IScaledBalanceToken } from "@aave/core-v3/contracts/interfaces/IAToken.sol";

library LibSupplyRequest {
    function supplyRequest(address asset, euint64 amount, uint16 referralCode) internal {
        LibAdapterStorage.Storage storage s = LibAdapterStorage.getStorage();

        address cToken = s.tokenAddressToCTokenAddress[asset];
        if (cToken == address(0)) revert LibAdapterStorage.InvalidCTokenAddress(asset);

        FHE.allow(amount, cToken);
        euint64 transferred = IFHERC20(cToken).confidentialTransferFrom(msg.sender, address(this), amount);
        FHE.allowThis(transferred);

        s.supplyRequests.push(
            LibAdapterStorage.SupplyRequestData({
                sender: msg.sender,
                asset: asset,
                amount: transferred,
                referralCode: referralCode
            })
        );

        emit LibAdapterStorage.SupplyRequested(asset, msg.sender, transferred, referralCode);

        if (s.supplyRequests.length >= s.REQUEST_THRESHOLD) {
            _tryFormBatch(s, asset);
        }
    }

    function _tryFormBatch(LibAdapterStorage.Storage storage s, address asset) private {
        uint256 threshold = s.REQUEST_THRESHOLD;
        LibAdapterStorage.SupplyRequestData[] memory matched = new LibAdapterStorage.SupplyRequestData[](threshold);
        uint256[] memory matchedIndexes = new uint256[](threshold);
        euint64[] memory amounts = new euint64[](threshold);
        uint256 count = 0;

        for (uint256 i = 0; i < s.supplyRequests.length && count < threshold; i++) {
            if (s.supplyRequests[i].asset == asset) {
                matched[count] = s.supplyRequests[i];
                matchedIndexes[count] = i;
                amounts[count] = s.supplyRequests[i].amount;
                count++;
            }
        }
        if (count < threshold) return;

        (uint256 batchId, euint64 total) = LibAdapterStorage.formBatch(amounts);

        for (uint256 i = 0; i < matched.length; i++) {
            s.batchIdToSupplyRequests[batchId].push(matched[i]);
        }

        emit LibAdapterStorage.SupplyBatchFormed(asset, batchId, matched.length, uint256(euint64.unwrap(total)));

        for (uint256 i = matchedIndexes.length; i > 0; i--) {
            uint256 idx = matchedIndexes[i - 1];
            s.supplyRequests[idx] = s.supplyRequests[s.supplyRequests.length - 1];
            s.supplyRequests.pop();
        }
    }

    function unwrapSupplyForFinalize(uint256 batchId, uint64 batchTotal, bytes calldata signature) internal {
        LibAdapterStorage.Storage storage s = LibAdapterStorage.getStorage();
        LibAdapterStorage.SupplyRequestData[] storage requests = s.batchIdToSupplyRequests[batchId];
        if (requests.length == 0) revert LibAdapterStorage.NotEnoughSupplyRequest();

        LibAdapterStorage.verifyBatchTotal(batchId, batchTotal, signature);

        address cToken = s.tokenAddressToCTokenAddress[requests[0].asset];
        uint256 ctHash = LibAdapterStorage.unwrapAndTrackClaim(cToken, batchTotal);
        s.batchIdToUnwrapCtHash[batchId] = ctHash;

        emit LibAdapterStorage.SupplyUnwrapped(batchId, batchTotal, ctHash);
    }

    function finalizeSupplyRequests(uint256 batchId, uint64 unwrappedAmount, bytes calldata unwrapSignature) internal {
        LibAdapterStorage.Storage storage s = LibAdapterStorage.getStorage();

        LibAdapterStorage.SupplyRequestData[] memory requests = s.batchIdToSupplyRequests[batchId];
        if (requests.length == 0) revert LibAdapterStorage.NotEnoughSupplyRequest();
        if (unwrappedAmount == 0) revert LibAdapterStorage.AmountIsZero();

        address asset = requests[0].asset;
        address cToken = s.tokenAddressToCTokenAddress[asset];

        LibAdapterStorage.settleUnwrapClaim(cToken, s.batchIdToUnwrapCtHash[batchId], unwrappedAmount, unwrapSignature);

        uint256 amount = uint256(unwrappedAmount) *
            (10 ** (IERC20Metadata(asset).decimals() - IERC20Metadata(cToken).decimals()));

        address aToken = s.aavePool.getReserveData(asset).aTokenAddress;
        uint256 beforeScaledBalance = IScaledBalanceToken(aToken).scaledBalanceOf(address(this));

        IERC20(asset).approve(address(s.aavePool), amount);
        s.aavePool.supply(asset, amount, address(this), requests[0].referralCode);

        uint256 afterScaledBalance = IScaledBalanceToken(aToken).scaledBalanceOf(address(this));
        uint256 multiplier = (afterScaledBalance - beforeScaledBalance) / (amount / (10 ** 6));

        _applySupplyToUsers(s, requests, multiplier, asset);

        emit LibAdapterStorage.FinalizeSupplyRequest(asset, batchId, multiplier, amount);

        delete s.batchIdToSupplyRequests[batchId];
        s.batchIdToTotalAmount[batchId] = euint64.wrap(bytes32(0));
        delete s.batchIdToUnwrapCtHash[batchId];
    }

    function _applySupplyToUsers(
        LibAdapterStorage.Storage storage s,
        LibAdapterStorage.SupplyRequestData[] memory requests,
        uint256 multiplier,
        address asset
    ) private {
        for (uint256 i = 0; i < requests.length; i++) {
            address sender = requests[i].sender;

            euint64 scaledIncrease = FHE.div(
                FHE.mul(requests[i].amount, FHE.asEuint64(uint64(multiplier))),
                FHE.asEuint64(uint64(1e6))
            );
            euint64 newBalance = FHE.add(s.scaledBalances[sender][asset], scaledIncrease);
            s.scaledBalances[sender][asset] = newBalance;

            FHE.allowThis(newBalance);
            FHE.allow(newBalance, sender);

            LibAdapterStorage.setMaxBorrowables(newBalance, sender);
        }
    }
}
