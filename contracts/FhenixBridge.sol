// SPDX-License-Identifier: UNLICENSED
pragma solidity ^0.8.25;

import "@openzeppelin/contracts/access/Ownable2Step.sol";
import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import "@openzeppelin/contracts/utils/Pausable.sol";
import "@fhenixprotocol/cofhe-contracts/FHE.sol";
import {IFHERC20} from "./token/interfaces/IFHERC20.sol";

// Union IBC packet structure
struct IBCPacket {
    uint32 sourceChannelId;
    uint32 destinationChannelId;
    bytes data;
    uint64 timeoutHeight;
    uint64 timeoutTimestamp;
}

// Interface for Union IBC Module to receive packets
interface IIBCModuleRecv {
    function onRecvPacket(
        address caller,
        IBCPacket calldata packet,
        address relayer,
        bytes calldata relayerMsg
    ) external returns (bytes memory);
}

error MsgValueDoesNotMatchInputAmount();
error UnauthorizedRelayer();
error IntentNotFound();
error IntentAlreadyFilled();
error SolverAlreadyPaid();
error InvalidAddress();
error InvalidToken();
error InvalidChainId();

contract FhenixBridge is
    Ownable2Step,
    ReentrancyGuard,
    Pausable,
    IIBCModuleRecv
{
    enum FilledStatus {
        NOT_FILLED,
        FILLED
    }

    struct Intent {
        address sender;
        address receiver;
        address relayer;
        address inputToken;
        address outputToken;
        euint64 inputAmount;
        euint64 outputAmount;
        uint256 id;
        uint32 originChainId;
        euint32 destinationChainId;
        FilledStatus filledStatus;
        bool solverPaid;
        uint256 timeout;
    }

    // Store the original InEuint64 values for transfers
    mapping(uint256 intentId => InEuint64) public inputAmountTransfer;
    mapping(uint256 intentId => InEuint64) public outputAmountTransfer;

    mapping(uint256 intentId => Intent) public intents;
    mapping(uint256 intentId => bool exists) public doesIntentExist;
    mapping(address => bool) public authorizedRelayers;

    event IntentCreated(
        address indexed sender,
        address indexed relayer,
        Intent intent
    );
    event IntentFulfilled(
        address indexed sender,
        address indexed relayer,
        Intent intent
    );
    event IntentRepaid(
        address indexed sender,
        address indexed relayer,
        Intent intent
    );
    event RelayerAuthorizationChanged(address indexed relayer, bool authorized);

    constructor() Ownable(msg.sender) {}

    function bridge(
        address _sender,
        address _receiver,
        address _relayer,
        address _inputToken,
        address _outputToken,
        InEuint64 calldata _encInputAmount,
        InEuint64 calldata _encOutputAmount,
        InEuint32 calldata _destinationChainId
    ) public nonReentrant whenNotPaused {
        // Input validation
        if (
            _sender == address(0) ||
            _receiver == address(0) ||
            _relayer == address(0)
        ) {
            revert InvalidAddress();
        }
        if (_inputToken == address(0) || _outputToken == address(0)) {
            revert InvalidToken();
        }

        euint64 encInputAmount = FHE.asEuint64(_encInputAmount);
        euint64 encOutputAmount = FHE.asEuint64(_encOutputAmount);
        euint32 destinationChainId = FHE.asEuint32(_destinationChainId);

        // Allow relayer to decrypt the amounts
        FHE.allow(encInputAmount, _relayer);
        FHE.allow(encOutputAmount, _relayer);
        FHE.allow(destinationChainId, _relayer);

        FHE.allow(encInputAmount, _inputToken);

        // Transfer input amount from user to bridge contract using permit
        IFHERC20(_inputToken).confidentialTransferFrom(
            msg.sender,
            address(this),
            encInputAmount
        );

        uint256 id = uint256(
            keccak256(
                abi.encodePacked(
                    _sender,
                    _receiver,
                    _relayer,
                    _inputToken,
                    _outputToken,
                    destinationChainId,
                    block.timestamp,
                    block.number // Add block number for better uniqueness
                )
            )
        );

        Intent memory intent = Intent({
            sender: _sender,
            receiver: _receiver,
            relayer: _relayer,
            inputToken: _inputToken,
            outputToken: _outputToken,
            inputAmount: encInputAmount,
            outputAmount: encOutputAmount,
            id: id,
            originChainId: uint32(block.chainid),
            destinationChainId: destinationChainId,
            filledStatus: FilledStatus.NOT_FILLED,
            solverPaid: false,
            timeout: block.timestamp + 24 hours
        });

        intents[id] = intent;
        doesIntentExist[id] = true;

        // Store original amounts for transfers
        inputAmountTransfer[id] = _encInputAmount;
        outputAmountTransfer[id] = _encOutputAmount;

        emit IntentCreated(_sender, _relayer, intent);
    }

    function fulfill(
        Intent memory intent,
        InEuint64 calldata _outputAmount
    ) public nonReentrant whenNotPaused {
        if (intent.relayer != msg.sender) {
            revert UnauthorizedRelayer();
        }

        // Check if this intent already exists and is filled on THIS chain
        if (
            doesIntentExist[intent.id] &&
            intents[intent.id].filledStatus == FilledStatus.FILLED
        ) {
            revert IntentAlreadyFilled();
        }

        euint64 encOutputAmount = FHE.asEuint64(_outputAmount);

        FHE.allow(encOutputAmount, intent.outputToken);

        IFHERC20(intent.outputToken).confidentialTransferFrom(
            intent.relayer, // solver
            intent.receiver, // user's receiver address
            encOutputAmount // Use provided InEuint64 for transfer
        );

        intents[intent.id] = intent;
        intents[intent.id].filledStatus = FilledStatus.FILLED;
        doesIntentExist[intent.id] = true;

        emit IntentFulfilled(intent.sender, intent.relayer, intent);
    }

    function fulfill(
        Intent memory intent,
        euint64 _outputAmount
    ) public nonReentrant whenNotPaused {
        if (intent.relayer != msg.sender) {
            revert UnauthorizedRelayer();
        }

        // Check if this intent already exists and is filled on THIS chain
        if (
            doesIntentExist[intent.id] &&
            intents[intent.id].filledStatus == FilledStatus.FILLED
        ) {
            revert IntentAlreadyFilled();
        }

        FHE.allowTransient(_outputAmount, intent.relayer);
        FHE.allow(_outputAmount, intent.outputToken);

        IFHERC20(intent.outputToken).confidentialTransferFrom(
            intent.relayer, // solver
            intent.receiver, // user's receiver address
            _outputAmount // Use provided InEuint64 for transfer
        );

        intents[intent.id] = intent;
        intents[intent.id].filledStatus = FilledStatus.FILLED;
        doesIntentExist[intent.id] = true;

        emit IntentFulfilled(intent.sender, intent.relayer, intent);
    }

    function repayRelayer(uint256 intentId) external onlyOwner nonReentrant {
        if (!doesIntentExist[intentId]) {
            revert IntentNotFound();
        }

        Intent storage intent = intents[intentId];

        if (intent.solverPaid) {
            revert SolverAlreadyPaid();
        }

        IFHERC20(intent.inputToken).confidentialTransfer(
            intent.relayer,
            inputAmountTransfer[intentId]
        );

        intent.solverPaid = true;
        emit IntentRepaid(intent.sender, intent.relayer, intent);
    }

    function claimTimeout(uint256 intentId) external nonReentrant {
        if (!doesIntentExist[intentId]) {
            revert IntentNotFound();
        }

        Intent storage intent = intents[intentId];

        require(
            msg.sender == intent.relayer,
            "Only designated solver can claim"
        );
        require(block.timestamp > intent.timeout, "Timeout not reached");
        require(!intent.solverPaid, "Solver already paid");

        // Transfer the input amount to the solver
        IFHERC20(intent.inputToken).confidentialTransfer(
            intent.relayer,
            inputAmountTransfer[intentId]
        );

        intent.solverPaid = true;
        emit IntentRepaid(intent.sender, intent.relayer, intent);
    }

    function withdraw(
        address tokenAddress,
        InEuint64 calldata _encryptedAmount
    ) public onlyOwner nonReentrant {
        // Validate token address
        if (tokenAddress == address(0)) {
            revert InvalidToken();
        }
        // Transfer confidential tokens from contract to owner
        IFHERC20(tokenAddress).confidentialTransfer(
            msg.sender,
            _encryptedAmount
        );
    }

    function getIntent(uint256 intentId) external view returns (Intent memory) {
        return intents[intentId];
    }

    function setRelayerAuthorization(
        address relayer,
        bool authorized
    ) external onlyOwner {
        if (relayer == address(0)) {
            revert InvalidAddress();
        }
        authorizedRelayers[relayer] = authorized;
        emit RelayerAuthorizationChanged(relayer, authorized);
    }

    // Emergency pause functions
    function pause() external onlyOwner {
        _pause();
    }

    function unpause() external onlyOwner {
        _unpause();
    }

    // Union IBC callback - called by Union relayers after cross-chain fulfillment verification
    function onRecvPacket(
        address /*caller*/,
        IBCPacket calldata packet,
        address /*relayer*/,
        bytes calldata /*relayerMsg*/
    ) external override returns (bytes memory) {
        require(authorizedRelayers[msg.sender], "Unauthorized relayer");

        (uint256 intentId, bool fulfillmentVerified) = abi.decode(
            packet.data,
            (uint256, bool)
        );

        if (!doesIntentExist[intentId]) {
            revert IntentNotFound();
        }

        Intent storage intent = intents[intentId];

        if (fulfillmentVerified && !intent.solverPaid) {
            IFHERC20(intent.inputToken).confidentialTransfer(
                intent.relayer,
                inputAmountTransfer[intentId]
            );

            intent.solverPaid = true;
            emit IntentRepaid(intent.sender, intent.relayer, intent);

            return abi.encode("success");
        }

        return abi.encode("failed");
    }
}
