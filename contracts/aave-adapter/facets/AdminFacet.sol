// SPDX-License-Identifier: MIT
pragma solidity ^0.8.25;

import { FHE } from "@fhenixprotocol/cofhe-contracts/FHE.sol";
import { LibAdapterStorage } from "../libraries/LibAdapterStorage.sol";
import { LibDiamond } from "../libraries/LibDiamond.sol";
import { IPool } from "@aave/core-v3/contracts/interfaces/IPool.sol";
import { IPoolDataProvider } from "@aave/core-v3/contracts/interfaces/IPoolDataProvider.sol";

contract AdminFacet {
    modifier onlyOwner() {
        require(msg.sender == LibDiamond.diamondStorage().contractOwner, "AdminFacet: Not owner");
        _;
    }

    function setCTokenAddress(address[] memory tokens, address[] memory cTokens) external onlyOwner {
        LibAdapterStorage.Storage storage s = LibAdapterStorage.getStorage();

        for (uint256 i = 0; i < tokens.length; i++) {
            s.tokenAddressToCTokenAddress[tokens[i]] = cTokens[i];
            s.cTokenAddressToTokenAddress[cTokens[i]] = tokens[i];
        }
    }

    function setAavePoolAddress(address pool, address poolDataProvider) external onlyOwner {
        LibAdapterStorage.Storage storage s = LibAdapterStorage.getStorage();
        s.aavePool = IPool(pool);
        s.aaveDataProvider = IPoolDataProvider(poolDataProvider);
    }

    function setRequestThreshold(uint8 threshold) external onlyOwner {
        LibAdapterStorage.Storage storage s = LibAdapterStorage.getStorage();
        s.REQUEST_THRESHOLD = threshold;
    }

    function initMappings(address user, address[] memory tokens) external onlyOwner {
        LibAdapterStorage.Storage storage s = LibAdapterStorage.getStorage();

        for (uint256 i = 0; i < tokens.length; i++) {
            if (!FHE.isInitialized(s.scaledBalances[user][tokens[i]])) {
                s.scaledBalances[user][tokens[i]] = FHE.asEuint64(0);
                FHE.allowThis(s.scaledBalances[user][tokens[i]]);
                FHE.allow(s.scaledBalances[user][tokens[i]], user);
            }
            if (!FHE.isInitialized(s.scaledDebts[user][tokens[i]])) {
                s.scaledDebts[user][tokens[i]] = FHE.asEuint64(0);
                FHE.allowThis(s.scaledDebts[user][tokens[i]]);
                FHE.allow(s.scaledDebts[user][tokens[i]], user);
            }
            if (!FHE.isInitialized(s.userMaxBorrowablePerAsset[user][tokens[i]])) {
                s.userMaxBorrowablePerAsset[user][tokens[i]] = FHE.asEuint64(0);
                FHE.allowThis(s.userMaxBorrowablePerAsset[user][tokens[i]]);
                FHE.allow(s.userMaxBorrowablePerAsset[user][tokens[i]], user);
            }

            s.aaveAssets.push(tokens[i]);
        }
    }
}
