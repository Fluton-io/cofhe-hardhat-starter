// SPDX-License-Identifier: MIT
pragma solidity ^0.8.25;

import { LibWithdrawRequest } from "../libraries/LibWithdrawRequest.sol";
import { FHE, euint64, externalEuint64 } from "@fhenixprotocol/cofhe-contracts/FHE.sol";

contract WithdrawFacet {
    function withdrawRequest(address asset, externalEuint64 amount, bytes calldata inputProof) external {
        euint64 decrypted = FHE.asEuint64(amount, inputProof);
        LibWithdrawRequest.withdrawRequest(asset, decrypted);
    }

    function finalizeWithdrawRequests(uint256 batchId, uint64 batchTotal, bytes calldata signature) external {
        LibWithdrawRequest.finalizeWithdrawRequests(batchId, batchTotal, signature);
    }
}
