// SPDX-License-Identifier: MIT
pragma solidity ^0.8.25;

import { FHE, euint64 } from "@fhenixprotocol/cofhe-contracts/FHE.sol";
import { LibAdapterStorage } from "./LibAdapterStorage.sol";
import { FHERC20Wrapper } from "../../token/FHERC20Wrapper.sol";
import { IFHERC20 } from "../../token/interfaces/IFHERC20.sol";
import { IERC20 } from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import { IERC20Metadata } from "@openzeppelin/contracts/token/ERC20/extensions/IERC20Metadata.sol";

library LibWithdrawRequest {
    function withdrawRequest(address asset, euint64 amount) internal {
        LibAdapterStorage.Storage storage s = LibAdapterStorage.getStorage();

        euint64 withdrawableScaledBalance = FHE.sub(s.scaledBalances[msg.sender][asset], s.scaledDebts[msg.sender][asset]);
        euint64 safeAmount = FHE.select(FHE.lte(amount, withdrawableScaledBalance), amount, FHE.asEuint64(0));

        s.withdrawRequests.push(
            LibAdapterStorage.WithdrawRequestData({ sender: msg.sender, asset: asset, amount: safeAmount, to: msg.sender })
        );

        FHE.allow(safeAmount, msg.sender);
        FHE.allowThis(safeAmount);

        emit LibAdapterStorage.WithdrawRequested(asset, msg.sender, msg.sender, safeAmount);

        if (s.withdrawRequests.length >= s.REQUEST_THRESHOLD) {
            _tryFormBatch(s, asset);
        }
    }

    function _tryFormBatch(LibAdapterStorage.Storage storage s, address asset) private {
        uint256 threshold = s.REQUEST_THRESHOLD;
        LibAdapterStorage.WithdrawRequestData[] memory matched = new LibAdapterStorage.WithdrawRequestData[](threshold);
        uint256[] memory matchedIndexes = new uint256[](threshold);
        euint64[] memory amounts = new euint64[](threshold);
        uint256 count = 0;

        for (uint256 i = 0; i < s.withdrawRequests.length && count < threshold; i++) {
            if (s.withdrawRequests[i].asset == asset) {
                matched[count] = s.withdrawRequests[i];
                matchedIndexes[count] = i;
                amounts[count] = s.withdrawRequests[i].amount;
                count++;
            }
        }
        if (count < threshold) return;

        (uint256 batchId, euint64 total) = LibAdapterStorage.formBatch(amounts);

        for (uint256 i = 0; i < matched.length; i++) {
            s.batchIdToWithdrawRequests[batchId].push(matched[i]);
        }

        emit LibAdapterStorage.WithdrawBatchFormed(asset, batchId, matched.length, uint256(euint64.unwrap(total)));

        for (uint256 i = matchedIndexes.length; i > 0; i--) {
            uint256 idx = matchedIndexes[i - 1];
            s.withdrawRequests[idx] = s.withdrawRequests[s.withdrawRequests.length - 1];
            s.withdrawRequests.pop();
        }
    }

    function finalizeWithdrawRequests(uint256 batchId, uint64 batchTotal, bytes calldata signature) internal {
        LibAdapterStorage.Storage storage s = LibAdapterStorage.getStorage();
        LibAdapterStorage.WithdrawRequestData[] memory requests = s.batchIdToWithdrawRequests[batchId];
        if (requests.length == 0) revert LibAdapterStorage.NotEnoughWithdrawRequest();
        if (batchTotal == 0) revert LibAdapterStorage.AmountIsZero();

        LibAdapterStorage.verifyBatchTotal(batchId, batchTotal, signature);

        address asset = requests[0].asset;
        address cToken = s.tokenAddressToCTokenAddress[asset];

        uint256 amountToWithdraw = uint256(batchTotal) *
            (10 ** (IERC20Metadata(asset).decimals() - IERC20Metadata(cToken).decimals()));

        s.aavePool.withdraw(asset, amountToWithdraw, address(this));

        IERC20(asset).approve(cToken, amountToWithdraw);
        FHERC20Wrapper(cToken).wrap(address(this), amountToWithdraw);

        _applyWithdrawToUsers(s, requests, asset, cToken);

        emit LibAdapterStorage.FinalizeWithdrawRequest(asset, batchId);

        delete s.batchIdToWithdrawRequests[batchId];
        s.batchIdToTotalAmount[batchId] = euint64.wrap(bytes32(0));
    }

    function _applyWithdrawToUsers(
        LibAdapterStorage.Storage storage s,
        LibAdapterStorage.WithdrawRequestData[] memory requests,
        address asset,
        address cToken
    ) private {
        for (uint256 i = 0; i < requests.length; i++) {
            address sender = requests[i].sender;

            euint64 newBalance = FHE.sub(s.scaledBalances[sender][asset], requests[i].amount);
            s.scaledBalances[sender][asset] = newBalance;

            FHE.allow(newBalance, sender);
            FHE.allowThis(newBalance);

            LibAdapterStorage.setMaxBorrowables(newBalance, sender);

            FHE.allow(requests[i].amount, cToken);
            IFHERC20(cToken).confidentialTransfer(requests[i].to, requests[i].amount);
        }
    }
}
