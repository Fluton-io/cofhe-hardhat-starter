// SPDX-License-Identifier: MIT
pragma solidity ^0.8.25;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {IFHERC20} from "./IFHERC20.sol";
import {euint128, InEuint128} from "@fhenixprotocol/cofhe-contracts/FHE.sol";

/**
 * @dev Interface for ConfidentialERC20 contract
 * Extends IFHERC20 with additional functionality specific to ConfidentialERC20
 */
interface IConfidentialERC20 is IFHERC20 {
    /**
     * @dev Emitted when ERC20 tokens are encrypted and wrapped
     */
    event EncryptedERC20(
        address indexed from,
        address indexed to,
        uint128 value
    );

    /**
     * @dev Emitted when encrypted tokens are decrypted
     */
    event DecryptedERC20(
        address indexed from,
        address indexed to,
        uint128 value
    );

    /**
     * @dev Emitted when decrypted tokens are claimed
     */
    event ClaimedDecryptedERC20(
        address indexed from,
        address indexed to,
        uint128 value
    );

    /**
     * @dev Emitted when symbol is updated
     */
    event SymbolUpdated(string symbol);

    /**
     * @dev The erc20 token couldn't be wrapped.
     */
    error FHERC20InvalidErc20(address token);

    /**
     * @dev The recipient is the zero address.
     */
    error InvalidRecipient();

    /**
     * @dev Returns the address of the underlying ERC20 token
     */
    function erc20() external view returns (IERC20);

    /**
     * @dev Update the symbol of the token (only owner)
     */
    function updateSymbol(string memory updatedSymbol) external;

    /**
     * @dev Encrypt ERC20 tokens and mint confidential tokens
     * @param to The recipient of the confidential tokens (use address(0) for msg.sender)
     * @param value The amount of ERC20 tokens to encrypt
     */
    function encrypt(address to, uint128 value) external;

    /**
     * @dev Decrypt confidential tokens and prepare for claiming
     * @param to The recipient of the decrypted tokens (use address(0) for msg.sender)
     * @param value The amount of confidential tokens to decrypt
     */
    function decrypt(address to, uint128 value) external;

    /**
     * @dev Claim a specific decrypted amount
     * @param ctHash The hash of the ciphertext to claim
     */
    function claimDecrypted(uint256 ctHash) external;

    /**
     * @dev Claim all available decrypted amounts
     */
    function claimAllDecrypted() external;
}
