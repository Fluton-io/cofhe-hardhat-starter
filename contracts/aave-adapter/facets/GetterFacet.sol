// SPDX-License-Identifier: MIT
pragma solidity ^0.8.25;

import { LibAdapterStorage } from "../libraries/LibAdapterStorage.sol";
import { FHE, euint64, euint128 } from "@fhenixprotocol/cofhe-contracts/FHE.sol";

contract GetterFacet {
    function getSuppliedBalance(address user, address asset) external view returns (euint64) {
        LibAdapterStorage.Storage storage s = LibAdapterStorage.getStorage();

        return s.scaledBalances[user][asset];
    }

    function getBorrowedBalance(address user, address asset) external returns (euint64) {
        LibAdapterStorage.Storage storage s = LibAdapterStorage.getStorage();
        euint64 scaledDebt = s.scaledDebts[user][asset];
        uint256 reserveNormalizedDebt = s.aavePool.getReserveNormalizedVariableDebt(asset);

        euint128 scaledProduct = FHE.mul(FHE.asEuint128(scaledDebt), FHE.asEuint128(reserveNormalizedDebt));
        euint128 scaledResult = FHE.div(scaledProduct, FHE.asEuint128(uint256(1e27)));

        return FHE.asEuint64(scaledResult);
    }

    function getMaxBorrowable(address user, address asset) external view returns (euint64) {
        LibAdapterStorage.Storage storage s = LibAdapterStorage.getStorage();
        return s.userMaxBorrowablePerAsset[user][asset];
    }

    function getScaledDebt(address user, address asset) external view returns (euint64) {
        LibAdapterStorage.Storage storage s = LibAdapterStorage.getStorage();
        return s.scaledDebts[user][asset];
    }
}
