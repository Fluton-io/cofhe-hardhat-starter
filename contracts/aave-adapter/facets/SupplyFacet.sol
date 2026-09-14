// SPDX-License-Identifier: MIT
pragma solidity ^0.8.25;

import { LibSupplyRequest } from "../libraries/LibSupplyRequest.sol";
import { FHE, euint64, externalEuint64 } from "@fhenixprotocol/cofhe-contracts/FHE.sol";

contract SupplyFacet {
    function supplyRequest(
        address asset,
        externalEuint64 amount,
        uint16 referralCode,
        bytes calldata inputProof
    ) external {
        euint64 decrypted = FHE.asEuint64(amount, inputProof);
        LibSupplyRequest.supplyRequest(asset, decrypted, referralCode);
    }

    function unwrapSupplyForFinalize(uint256 batchId, uint64 batchTotal, bytes calldata signature) external {
        LibSupplyRequest.unwrapSupplyForFinalize(batchId, batchTotal, signature);
    }

    function finalizeSupplyRequests(uint256 batchId, uint64 unwrappedAmount, bytes calldata unwrapSignature) external {
        LibSupplyRequest.finalizeSupplyRequests(batchId, unwrappedAmount, unwrapSignature);
    }
}
