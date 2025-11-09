// SPDX-License-Identifier: UNLICENSED
pragma solidity ^0.8.25;

import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import {FHE, euint64} from "@fhenixprotocol/cofhe-contracts/FHE.sol";
import {IFHERC20} from "./token/interfaces/IFHERC20.sol";

contract SolverRegistry is ReentrancyGuard {
    IFHERC20 public immutable registryToken;
    uint256 public immutable REGISTRATION_AMOUNT; // Example registration amount to be staked

    mapping(address => bool) private registeredSolvers;
    mapping(address => euint64) private pendingRegistrations;

    event SolverRegistered(address indexed solver);
    event SolverUnregistered(address indexed solver);

    constructor(address _registryToken, uint256 _registrationFee) {
        registryToken = IFHERC20(_registryToken);
        REGISTRATION_AMOUNT = _registrationFee; // Example fee initialization
    }

    function registerSolver(
        address solver,
        address sponsor
    ) external nonReentrant {
        require(!registeredSolvers[solver], "Solver already registered");
        // Transfer registration fee from sponsor to this contract
        require(
            registryToken.transferFrom(
                sponsor,
                address(this),
                REGISTRATION_AMOUNT
            ),
            "Registration fee transfer failed"
        );

        // Transfer input amount from user to contract using permit
        euint64 transferred = IFHERC20(registryToken).confidentialTransferFrom(
            sponsor,
            address(this),
            FHE.asEuint64(REGISTRATION_AMOUNT)
        );
        FHE.decrypt(transferred);
        pendingRegistrations[solver] = transferred;
    }

    function finalizeRegistration(address solver) external nonReentrant {
        (uint64 registrationValue, bool registrationReady) = FHE
            .getDecryptResultSafe(pendingRegistrations[solver]);
        require(registrationReady, "Registration not yet decrypted");
        require(
            registrationValue >= REGISTRATION_AMOUNT,
            "Insufficient registration value"
        );
        registeredSolvers[solver] = true;
        emit SolverRegistered(solver);
    }

    function unregisterSolver(address solver) external nonReentrant {
        require(registeredSolvers[solver], "Solver not registered");
        registeredSolvers[solver] = false;
        emit SolverUnregistered(solver);
    }

    function isSolverRegistered(address solver) external view returns (bool) {
        return registeredSolvers[solver];
    }
}
