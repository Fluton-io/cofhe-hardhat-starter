// SPDX-License-Identifier: MIT
pragma solidity ^0.8.25;

import { LibRepayRequest } from "../libraries/LibRepayRequest.sol";
import { FHE, euint64, externalEuint64 } from "@fhenixprotocol/cofhe-contracts/FHE.sol";
import { DataTypes } from "@aave/core-v3/contracts/protocol/libraries/types/DataTypes.sol";

contract RepayFacet {
    function repayRequest(
        address asset,
        externalEuint64 amount,
        DataTypes.InterestRateMode interestRateMode,
        bytes calldata inputProof
    ) external {
        euint64 decrypted = FHE.asEuint64(amount, inputProof);
        LibRepayRequest.repayRequest(asset, decrypted, interestRateMode);
    }

    function unwrapRepayForFinalize(uint256 batchId, uint64 batchTotal, bytes calldata signature) external {
        LibRepayRequest.unwrapRepayForFinalize(batchId, batchTotal, signature);
    }

    function finalizeRepayRequests(uint256 batchId, uint64 unwrappedAmount, bytes calldata unwrapSignature) external {
        LibRepayRequest.finalizeRepayRequests(batchId, unwrappedAmount, unwrapSignature);
    }
}
