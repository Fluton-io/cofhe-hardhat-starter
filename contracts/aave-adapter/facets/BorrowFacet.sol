// SPDX-License-Identifier: MIT
pragma solidity ^0.8.25;

import { LibBorrowRequest } from "../libraries/LibBorrowRequest.sol";
import { FHE, euint64, externalEuint64 } from "@fhenixprotocol/cofhe-contracts/FHE.sol";
import { DataTypes } from "@aave/core-v3/contracts/protocol/libraries/types/DataTypes.sol";

contract BorrowFacet {
    function borrowRequest(
        address asset,
        externalEuint64 amount,
        DataTypes.InterestRateMode interestRateMode,
        uint16 referralCode,
        bytes calldata inputProof
    ) external {
        euint64 decrypted = FHE.asEuint64(amount, inputProof);
        LibBorrowRequest.borrowRequest(asset, decrypted, referralCode, interestRateMode);
    }

    function finalizeBorrowRequests(uint256 batchId, uint64 batchTotal, bytes calldata signature) external {
        LibBorrowRequest.finalizeBorrowRequests(batchId, batchTotal, signature);
    }
}
