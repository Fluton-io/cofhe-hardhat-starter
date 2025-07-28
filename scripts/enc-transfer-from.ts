import { ethers } from "hardhat";
import hre from "hardhat";
import { cofhejs, Encryptable } from "cofhejs/node";

async function main() {
  const [signer] = await ethers.getSigners();

  const owner = signer;
  const spender = signer;

  // Contract addresses
  const confidentialAddress = "0x38F2411515D947f4835832d00CA3D403448c389d";

  const recipientAddress = "0x490e37e4023577436776DE92A8e1CDBF1D74226d";
  const provider = new ethers.JsonRpcProvider(
    "https://arb-sepolia.g.alchemy.com/v2/X-DloxDnihx5D3j28oyshSC43tYk-3T_"
  );

  // Initialize cofhejs using the Ethers initializer
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
    confidentialAddress
  );

  const confSymbol = await confidentialToken.symbol();

  // Check current balances
  const ownerBalance = await confidentialToken.balanceOf(owner.address);
  const recipientBalance = await confidentialToken.balanceOf(recipientAddress);

  console.log("=== Initial Balances ===");
  console.log(
    `Owner ${confSymbol}: ${ethers.formatEther(ownerBalance)} (indicated)`
  );
  console.log(
    `Recipient ${confSymbol}: ${ethers.formatEther(
      recipientBalance
    )} (indicated)`
  );

  // Amount to transfer
  const transferAmount = ethers.parseEther("50");

  console.log(`\n=== Initiating encTransferFrom ===`);
  console.log(`Amount: ${ethers.formatEther(transferAmount)} ${confSymbol}`);
  console.log(`From: ${owner.address}`);
  console.log(`To: ${recipientAddress}`);

  try {
    // Encrypt the transfer amount using cofhejs
    const encTransferResult = await cofhejs.encrypt([
      Encryptable.uint128(transferAmount),
    ] as const);

    if (!encTransferResult.success) {
      console.error(
        "Failed to encrypt transfer amount:",
        encTransferResult.error
      );
      return;
    }

    const [encTransferInput] = await hre.cofhe.expectResultSuccess(
      encTransferResult
    );

    // Generate permit
    const { name, version, chainId, verifyingContract } =
      await confidentialToken.eip712Domain();

    const nonce = await confidentialToken.nonces(owner.address);
    const getNowTimestamp = () => BigInt(Date.now()) / 1000n;
    const deadline = getNowTimestamp() + BigInt(24 * 60 * 60);

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
      owner: owner.address,
      spender: spender.address,
      value_hash: encTransferInput.ctHash,
      nonce: nonce,
      deadline: deadline,
    };

    const signature = await owner.signTypedData(domain, types, message);
    const { v, r, s } = ethers.Signature.from(signature);

    const permit = {
      owner: owner.address,
      spender: spender.address,
      value_hash: encTransferInput.ctHash,
      deadline: deadline,
      v,
      r,
      s,
    };

    // Execute the transfer
    const transferTx = await (confidentialToken as any)
      .connect(spender)
      .encTransferFrom(
        owner.address,
        recipientAddress,
        encTransferInput,
        permit
      );

    console.log(`Transaction: ${transferTx.hash}`);

    // Check final balances
    const finalOwnerBalance = await confidentialToken.balanceOf(owner.address);
    const finalRecipientBalance = await confidentialToken.balanceOf(
      recipientAddress
    );

    console.log("\n=== Final Balances ===");
    console.log(
      `Owner ${confSymbol}: ${ethers.formatEther(
        finalOwnerBalance
      )} (indicated)`
    );
    console.log(
      `Recipient ${confSymbol}: ${ethers.formatEther(
        finalRecipientBalance
      )} (indicated)`
    );

    // Check if nonce was incremented
    const newNonce = await confidentialToken.nonces(owner.address);
    console.log(`\nNonce: ${nonce} → ${newNonce}`);

    console.log("\n✅ encTransferFrom completed successfully!");
  } catch (error: any) {
    console.error("Error:", error.message);
  }
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error("Error:", error.message);
    process.exit(1);
  });
