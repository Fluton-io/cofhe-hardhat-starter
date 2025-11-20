// SPDX-License-Identifier: UNLICENSED
pragma solidity ^0.8.25;

import "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import {FHE, InEuint64, euint64} from "@fhenixprotocol/cofhe-contracts/FHE.sol";
import {IFHERC20} from "./token/interfaces/IFHERC20.sol";

contract MultiTransfer is ReentrancyGuard {
    function multiTokenTransfer(
        address[] calldata tokens,
        address to,
        InEuint64[] calldata amounts
    ) external nonReentrant {
        require(tokens.length == amounts.length, "Mismatched input lengths");
        for (uint256 i = 0; i < tokens.length; i++) {
            euint64 encAmount = FHE.asEuint64(amounts[i]);
            FHE.allow(encAmount, tokens[i]);
            FHE.allow(encAmount, to);
            FHE.allow(encAmount, msg.sender);
            IFHERC20(tokens[i]).confidentialTransferFrom(
                msg.sender,
                to,
                encAmount
            );
        }
    }
}
