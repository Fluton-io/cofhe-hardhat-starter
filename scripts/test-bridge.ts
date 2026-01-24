import { ethers } from "hardhat";
import hre from "hardhat";
import { cofhejs, Encryptable } from "cofhejs/node";

async function main() {
  const [signer] = await ethers.getSigners();

  const confidentialTokenAddress = ethers.getAddress("0x92B7BE7B0f31d912f46fCD77EEb585034dc64d14");
  const bridgeAddress = ethers.getAddress("0x4aC1F5Fc409F794f12bE22d05f2EaBF650437979");

  // Bridge parameters
  const sender = ethers.getAddress(signer.address);
  const receiver = ethers.getAddress(signer.address);
  const relayer = ethers.getAddress(signer.address);
  const destinationChainId = 1; // Example destination chain

  const provider = new ethers.JsonRpcProvider("https://arb-sepolia.g.alchemy.com/v2/X-DloxDnihx5D3j28oyshSC43tYk-3T_");

  // Initialize cofhejs
  const initResult = await cofhejs.initializeWithEthers({
    ethersProvider: provider,
    ethersSigner: signer,
    environment: "TESTNET",
  });
  if (!initResult.success) {
    console.error("Failed to initialize cofhejs:", initResult.error);
    return;
  }

  // Get contracts
  const confidentialToken = await ethers.getContractAt(
    "contracts/ConfidentialERC20.sol:ConfidentialERC20",
    confidentialTokenAddress
  );
  const bridge = await ethers.getContractAt("CoFHEBridge", bridgeAddress);

  // Check initial balance
  const initialBalance = await confidentialToken.balanceOf(sender);
  console.log(`Initial balance: ${ethers.formatEther(initialBalance)} (indicated)`);

  // Amounts to bridge
  const inputAmount = ethers.parseEther("10");
  const outputAmount = ethers.parseEther("10");

  try {
    // Encrypt amounts
    const encInputResult = await cofhejs.encrypt([Encryptable.uint128(inputAmount)] as const);
    const encOutputResult = await cofhejs.encrypt([Encryptable.uint128(outputAmount)] as const);

    if (!encInputResult.success || !encOutputResult.success) {
      console.error("Failed to encrypt amounts");
      return;
    }

    const [encInputAmount] = await hre.cofhe.expectResultSuccess(encInputResult);
    const [encOutputAmount] = await hre.cofhe.expectResultSuccess(encOutputResult);

    const { name, version, chainId, verifyingContract } = await confidentialToken.eip712Domain();

    const nonce = await confidentialToken.nonces(sender);
    const getNowTimestamp = () => BigInt(Date.now()) / 1000n;
    const deadline = getNowTimestamp() + BigInt(24 * 60 * 60); // 24 hours

    const domain = {
      name,
      version,
      chainId,
      verifyingContract,
    };

    const types = {
      Permit: [
        { name: "owner", type: "address" },
        { name: "spender", type: "address" },
        { name: "value_hash", type: "uint256" },
        { name: "nonce", type: "uint256" },
        { name: "deadline", type: "uint256" },
      ],
    };

    const message = {
      owner: sender,
      spender: bridgeAddress,
      value_hash: encInputAmount.ctHash,
      nonce: nonce,
      deadline: deadline,
    };

    console.log("Signing permit...");
    const signature = await signer.signTypedData(domain, types, message);
    const { v, r, s } = ethers.Signature.from(signature);

    const permit = {
      owner: sender,
      spender: bridgeAddress,
      value_hash: encInputAmount.ctHash,
      deadline: deadline,
      v,
      r,
      s,
    };

    console.log("Creating bridge intent...");

    const tx = await bridge.connect(signer).bridge(
      sender,
      receiver,
      relayer,
      confidentialTokenAddress, // input token
      confidentialTokenAddress, // output token (same for testing)
      encInputAmount,
      encOutputAmount,
      destinationChainId,
      permit
    );

    console.log("Transaction submitted:", tx.hash);
    const receipt = await tx.wait();
    console.log("Transaction confirmed in block:", receipt?.blockNumber);

    // Get the intent ID from events
    const events = await bridge.queryFilter(bridge.filters.IntentCreated(), receipt?.blockNumber, receipt?.blockNumber);

    if (events.length > 0) {
      const intentEvent = events[0];
      console.log("Intent created with ID:", intentEvent.args?.intent.id);

      // Verify intent was stored
      const storedIntent = await bridge.getIntent(intentEvent.args?.intent.id);
      console.log("Stored intent verified:", storedIntent);
    }

    // Check balance after bridging
    const finalBalance = await confidentialToken.balanceOf(sender);
    console.log(`Final balance: ${ethers.formatEther(finalBalance)} (indicated)`);
    console.log(`Balance change: ${ethers.formatEther(finalBalance - initialBalance)} (indicated)`);

    console.log("\nBridge intent created successfully!");
  } catch (error: any) {
    console.error("Error creating bridge intent:", error.message);
    if (error.data) {
      console.error("Error data:", error.data);
    }
  }
}

if (require.main === module) {
  main()
    .then(() => process.exit(0))
    .catch((error) => {
      console.error(error);
      process.exit(1);
    });
}

export { main as testBridge };
