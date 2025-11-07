// SPDX-License-Identifier: MIT
// OpenZeppelin Contracts (last updated v5.1.0) (token/ERC20/ERC20.sol)

pragma solidity ^0.8.25;

import {IERC20, IERC20Metadata, ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {SafeCast} from "@openzeppelin/contracts/utils/math/SafeCast.sol";
import {euint64, FHE} from "@fhenixprotocol/cofhe-contracts/FHE.sol";
import {IFHERC20, FHERC20} from "./FHERC20.sol";
import {FHERC20UnwrapClaim} from "./FHERC20UnwrapClaim.sol";

contract FHERC20Wrapper is FHERC20, Ownable, FHERC20UnwrapClaim {
    using SafeERC20 for IERC20;

    IERC20 private immutable _erc20;
    string private _symbol;
    uint8 private immutable _decimals;
    uint256 private immutable _rate;

    event WrappedERC20(address indexed from, address indexed to, uint64 value);
    event UnwrappedERC20(
        address indexed from,
        address indexed to,
        uint64 value
    );
    event ClaimedUnwrappedERC20(
        address indexed from,
        address indexed to,
        uint64 value
    );
    event SymbolUpdated(string symbol);

    /**
     * @dev The erc20 token couldn't be wrapped.
     */
    error FHERC20InvalidErc20(address token);

    /**
     * @dev The recipient is the zero address.
     */
    error InvalidRecipient();

    constructor(
        IERC20 erc20_,
        string memory symbolOverride_
    )
        Ownable(msg.sender)
        FHERC20(
            string.concat(
                "FHERC20 Wrapped ",
                IERC20Metadata(address(erc20_)).name()
            ),
            bytes(symbolOverride_).length == 0
                ? string.concat("e", IERC20Metadata(address(erc20_)).symbol())
                : symbolOverride_,
            IERC20Metadata(address(erc20_)).decimals()
        )
    {
        try IFHERC20(address(erc20_)).isFherc20() returns (bool isFherc20) {
            if (isFherc20) {
                revert FHERC20InvalidErc20(address(erc20_));
            }
        } catch {
            // Not an FHERC20, continue
        }

        uint8 tokenDecimals = _tryGetAssetDecimals(erc20_);
        uint8 maxDecimals = _maxDecimals();

        if (tokenDecimals > maxDecimals) {
            _decimals = maxDecimals;
            _rate = 10 ** (tokenDecimals - maxDecimals);
        } else {
            _decimals = tokenDecimals;
            _rate = 1;
        }

        _erc20 = erc20_;

        _symbol = bytes(symbolOverride_).length == 0
            ? string.concat("e", IERC20Metadata(address(erc20_)).symbol())
            : symbolOverride_;
    }

    function symbol() public view override returns (string memory) {
        return _symbol;
    }

    function decimals() public view virtual override returns (uint8) {
        return _decimals;
    }

    /**
     * @dev Returns the rate at which the underlying token is converted to the wrapped token.
     * For example, if the `rate` is 1000, then 1000 units of the underlying token equal 1 unit of the wrapped token.
     */
    function rate() public view virtual returns (uint256) {
        return _rate;
    }

    function updateSymbol(string memory updatedSymbol) public onlyOwner {
        _symbol = updatedSymbol;
        emit SymbolUpdated(updatedSymbol);
    }

    /**
     * @dev Returns the address of the erc20 ERC-20 token that is being encrypted wrapped.
     */
    function erc20() public view returns (IERC20) {
        return _erc20;
    }

    function wrap(address to, uint256 value) public {
        if (to == address(0)) to = msg.sender;
        _erc20.safeTransferFrom(
            msg.sender,
            address(this),
            value - (value % rate())
        );
        _mint(to, SafeCast.toUint64(value / rate()));
        emit WrappedERC20(msg.sender, to, SafeCast.toUint64(value / rate()));
    }

    function unwrap(address to, uint64 value) public {
        if (to == address(0)) to = msg.sender;
        euint64 burned = _burn(msg.sender, value);
        FHE.decrypt(burned);
        _createClaim(to, value, burned);
        emit UnwrappedERC20(msg.sender, to, value);
    }

    /**
     * @notice Claim a decrypted amount of the underlying ERC20
     * @param ctHash The ctHash of the burned amount
     */
    function claimUnwrapped(uint256 ctHash) public {
        Claim memory claim = _handleClaim(ctHash);

        // Send the ERC20 to the recipient
        _erc20.safeTransfer(claim.to, claim.decryptedAmount * rate());
        emit ClaimedUnwrappedERC20(msg.sender, claim.to, claim.decryptedAmount);
    }

    /**
     * @notice Claim all decrypted amounts of the underlying ERC20
     */
    function claimAllUnwrapped() public {
        Claim[] memory claims = _handleClaimAll();

        for (uint256 i = 0; i < claims.length; i++) {
            _erc20.safeTransfer(
                claims[i].to,
                claims[i].decryptedAmount * rate()
            );
            emit ClaimedUnwrappedERC20(
                msg.sender,
                claims[i].to,
                claims[i].decryptedAmount
            );
        }
    }

    /**
     * @dev Returns the default number of decimals of the underlying ERC-20 token that is being wrapped.
     * Used as a default fallback when {_tryGetAssetDecimals} fails to fetch decimals of the underlying
     * ERC-20 token.
     */
    function _fallbackUnderlyingDecimals()
        internal
        pure
        virtual
        returns (uint8)
    {
        return 18;
    }

    /**
     * @dev Returns the maximum number that will be used for {decimals} by the wrapper.
     */
    function _maxDecimals() internal pure virtual returns (uint8) {
        return 6;
    }

    function _tryGetAssetDecimals(
        IERC20 asset_
    ) private view returns (uint8 assetDecimals) {
        (bool success, bytes memory encodedDecimals) = address(asset_)
            .staticcall(abi.encodeCall(IERC20Metadata.decimals, ()));
        if (success && encodedDecimals.length == 32) {
            return abi.decode(encodedDecimals, (uint8));
        }
        return _fallbackUnderlyingDecimals();
    }
}
