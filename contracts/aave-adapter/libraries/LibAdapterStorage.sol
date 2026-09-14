// SPDX-License-Identifier: MIT
pragma solidity ^0.8.25;

import { FHE, euint64 } from "@fhenixprotocol/cofhe-contracts/FHE.sol";
import { IPool } from "@aave/core-v3/contracts/interfaces/IPool.sol";
import { IPoolDataProvider } from "@aave/core-v3/contracts/interfaces/IPoolDataProvider.sol";
import { DataTypes } from "@aave/core-v3/contracts/protocol/libraries/types/DataTypes.sol";
import { FHERC20Wrapper } from "../../token/FHERC20Wrapper.sol";
import { FHERC20UnwrapClaim } from "../../token/FHERC20UnwrapClaim.sol";

library LibAdapterStorage {
    bytes32 constant STORAGE_POSITION = keccak256("confidential.adapter.storage");

    struct SupplyRequestData {
        address sender;
        address asset;
        euint64 amount;
        uint16 referralCode;
    }

    struct WithdrawRequestData {
        address sender;
        address asset;
        euint64 amount;
        address to;
    }

    struct BorrowRequestData {
        address sender;
        address asset;
        euint64 amount;
        DataTypes.InterestRateMode interestRateMode;
        uint16 referralCode;
    }

    struct RepayRequestData {
        address sender;
        address asset;
        euint64 amount;
        DataTypes.InterestRateMode interestRateMode;
    }

    struct Storage {
        uint8 REQUEST_THRESHOLD;
        IPool aavePool;
        IPoolDataProvider aaveDataProvider;
        SupplyRequestData[] supplyRequests;
        WithdrawRequestData[] withdrawRequests;
        BorrowRequestData[] borrowRequests;
        RepayRequestData[] repayRequests;
        address[] aaveAssets;
        uint256 nextBatchId;
        mapping(address => address) tokenAddressToCTokenAddress;
        mapping(address => address) cTokenAddressToTokenAddress;
        mapping(uint256 => SupplyRequestData[]) batchIdToSupplyRequests;
        mapping(uint256 => WithdrawRequestData[]) batchIdToWithdrawRequests;
        mapping(uint256 => BorrowRequestData[]) batchIdToBorrowRequests;
        mapping(uint256 => RepayRequestData[]) batchIdToRepayRequests;
        mapping(uint256 => euint64) batchIdToTotalAmount;
        mapping(uint256 => uint256) batchIdToUnwrapCtHash;
        mapping(address => mapping(address => euint64)) scaledBalances;
        mapping(address => mapping(address => euint64)) scaledDebts;
        mapping(address => mapping(address => euint64)) userMaxBorrowablePerAsset;
    }

    error AmountIsZero();
    error NotEnoughSupplyRequest();
    error NotEnoughWithdrawRequest();
    error NotEnoughBorrowRequest();
    error NotEnoughRepayRequest();
    error InvalidCTokenAddress(address asset);
    error InvalidDecryptSignature();
    error UnwrapClaimNotFound();

    event SupplyRequested(
        address indexed reserve,
        address indexed user,
        euint64 amount,
        uint16 indexed referralCode
    );
    event WithdrawRequested(address indexed reserve, address indexed user, address indexed to, euint64 amount);
    event BorrowRequested(
        address indexed reserve,
        address indexed user,
        euint64 amount,
        DataTypes.InterestRateMode interestRateMode,
        uint16 indexed referralCode
    );
    event RepayRequested(
        address indexed reserve,
        address indexed user,
        euint64 amount,
        DataTypes.InterestRateMode interestRateMode
    );

    event SupplyBatchFormed(address indexed reserve, uint256 indexed batchId, uint256 requestCount, uint256 ctHash);
    event WithdrawBatchFormed(address indexed reserve, uint256 indexed batchId, uint256 requestCount, uint256 ctHash);
    event BorrowBatchFormed(address indexed reserve, uint256 indexed batchId, uint256 requestCount, uint256 ctHash);
    event RepayBatchFormed(address indexed reserve, uint256 indexed batchId, uint256 requestCount, uint256 ctHash);

    event SupplyUnwrapped(uint256 indexed batchId, uint64 amount, uint256 unwrapCtHash);
    event RepayUnwrapped(uint256 indexed batchId, uint64 amount, uint256 unwrapCtHash);

    event FinalizeSupplyRequest(address indexed reserve, uint256 indexed batchId, uint256 multiplier, uint256 amount);
    event FinalizeWithdrawRequest(address indexed reserve, uint256 indexed batchId);
    event FinalizeBorrowRequest(address indexed reserve, uint256 indexed batchId);
    event FinalizeRepayRequest(address indexed reserve, uint256 indexed batchId);

    function getStorage() internal pure returns (Storage storage s) {
        bytes32 position = STORAGE_POSITION;
        assembly {
            s.slot := position
        }
    }

    function formBatch(euint64[] memory amounts) internal returns (uint256 batchId, euint64 total) {
        Storage storage s = getStorage();

        total = FHE.asEuint64(0);
        for (uint256 i = 0; i < amounts.length; i++) {
            total = FHE.add(total, amounts[i]);
        }
        FHE.allowPublic(total);

        batchId = ++s.nextBatchId;
        s.batchIdToTotalAmount[batchId] = total;
    }

    function verifyBatchTotal(uint256 batchId, uint64 claimedTotal, bytes calldata signature) internal view {
        Storage storage s = getStorage();
        bool valid = FHE.verifyDecryptResult(s.batchIdToTotalAmount[batchId], claimedTotal, signature);
        if (!valid) revert InvalidDecryptSignature();
    }

    function unwrapAndTrackClaim(address cToken, uint64 amount) internal returns (uint256 ctHash) {
        uint256[] memory before = _pendingClaimCtHashes(cToken);

        FHERC20Wrapper(cToken).unwrap(address(this), amount);

        FHERC20UnwrapClaim.Claim[] memory after_ = FHERC20Wrapper(cToken).getUserClaims(address(this));
        for (uint256 i = 0; i < after_.length; i++) {
            uint256 candidate = after_[i].ctHash;
            bool seenBefore = false;
            for (uint256 j = 0; j < before.length; j++) {
                if (before[j] == candidate) {
                    seenBefore = true;
                    break;
                }
            }
            if (!seenBefore) return candidate;
        }
        revert UnwrapClaimNotFound();
    }

    function _pendingClaimCtHashes(address cToken) private view returns (uint256[] memory hashes) {
        FHERC20UnwrapClaim.Claim[] memory claims = FHERC20Wrapper(cToken).getUserClaims(address(this));
        hashes = new uint256[](claims.length);
        for (uint256 i = 0; i < claims.length; i++) {
            hashes[i] = claims[i].ctHash;
        }
    }

    function settleUnwrapClaim(address cToken, uint256 ctHash, uint64 amount, bytes calldata signature) internal {
        FHERC20Wrapper wrapper = FHERC20Wrapper(cToken);
        wrapper.publishUnwrapDecryption(ctHash, amount, signature);
        wrapper.claimUnwrapped(ctHash);
    }

    function setMaxBorrowables(euint64 currentBalance, address sender) internal {
        Storage storage s = getStorage();

        address[] memory aaveAssets = s.aaveAssets;
        for (uint256 i = 0; i < aaveAssets.length; i++) {
            address asset = aaveAssets[i];

            (, uint256 ltv, , , , , , , , ) = s.aaveDataProvider.getReserveConfigurationData(asset);

            euint64 maxBorrowable = FHE.div(
                FHE.mul(currentBalance, FHE.asEuint64(uint64(ltv))),
                FHE.asEuint64(uint64(10000))
            );
            s.userMaxBorrowablePerAsset[sender][asset] = maxBorrowable;

            FHE.allow(maxBorrowable, sender);
            FHE.allowThis(maxBorrowable);
        }
    }
}
