// SPDX-License-Identifier: MIT
pragma solidity ^0.8.25;

import {FHERC20Wrapper} from "./FHERC20Wrapper.sol";
import {IERC20} from "@openzeppelin/contracts/interfaces/IERC20.sol";

contract eERC20 is FHERC20Wrapper {
    constructor(
        IERC20 erc20_,
        string memory symbolOverride_
    ) FHERC20Wrapper(erc20_, symbolOverride_) {}
}
