// contracts/GLDToken.sol
// SPDX-License-Identifier: MIT
pragma solidity ^0.8.0;

import "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import "@openzeppelin/contracts/access/Ownable.sol";

contract AAVEToken is ERC20("AAVE Test Token", "AAVE.t"), Ownable(msg.sender) {
    constructor(uint256 initialSupply) {
        _mint(msg.sender, initialSupply);
    }

    // only owner can mint
    function mint(
        address account,
        uint256 amount
    ) public onlyOwner returns (bool) {
        _mint(account, amount);
        return true;
    }

    // only owner can burn
    function burn(address account, uint256 value) public onlyOwner {
        _burn(account, value);
    }
}
