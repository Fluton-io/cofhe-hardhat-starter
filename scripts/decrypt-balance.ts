import { ethers } from "hardhat";
import { cofhejs, FheTypes } from "cofhejs/node";

async function main() {
  const [signer] = await ethers.getSigners();

  // Contract addresses
  const tokenAddress = "0xe7a31dD47e96FE04ac2C8B3c703e637Ae1ad88d5";
  const confidentialAddress = "0xa2871A8cDB68BecCD53B01Ec07AC913c96590538";

  const provider = new ethers.JsonRpcProvider(
    "https://arb-sepolia.g.alchemy.com/v2/X-DloxDnihx5D3j28oyshSC43tYk-3T_"
  );

  // Initialize cofhejs using the Ethers initializer
  const initResult = await cofhejs.initializeWithEthers({
    ethersProvider: provider,
    ethersSigner: signer,
  });

  if (!initResult.success) {
    console.error("Failed to initialize cofhejs:", initResult.error);
    return;
  }

  // Get contracts
  const token = await ethers.getContractAt("MockERC20", tokenAddress);
  const confidentialToken = await ethers.getContractAt(
    "contracts/ConfidentialERC20.sol:ConfidentialERC20",
    confidentialAddress
  );

  const tokenSymbol = await token.symbol();
  const confSymbol = await confidentialToken.symbol();

  // Check current balances
  const publicBalance = await token.balanceOf(signer.address);
  const indicatedBalance = await confidentialToken.balanceOf(signer.address);

  console.log(`${tokenSymbol}: ${ethers.formatEther(publicBalance)}`);
  console.log(
    `${confSymbol}: ${ethers.formatEther(indicatedBalance)} (indicated)`
  );

  try {
    console.log("Attempting to decrypt actual balance...");

    const permitResult = await cofhejs.createPermit({
      type: "self",
      issuer: signer.address,
    });

    if (!permitResult.success) {
      console.error("Failed to create permit:", permitResult.error);
      return;
    }

    const permissionResult = cofhejs.getPermission();
    if (!permissionResult.success) {
      console.error("Failed to get permission:", permissionResult.error);
      return;
    }

    const permission = permissionResult.data;

    const sealedBalance = await confidentialToken.encBalanceOf(
      signer.address,
      permission
    );
    console.log(`Sealed balance: ${sealedBalance}`);

    const sealedBalanceBigInt =
      typeof sealedBalance === "string" ? BigInt(sealedBalance) : sealedBalance;

    const unsealResult = await cofhejs.unseal(
      sealedBalanceBigInt,
      FheTypes.Uint128
    );

    if (!unsealResult.success) {
      console.error("Failed to unseal balance:", unsealResult.error);
    } else {
      const decryptedBalance = unsealResult.data;
      // decryptedBalance should be a bigint for Uint128
      console.log(
        `${confSymbol} (decrypted): ${ethers.formatEther(decryptedBalance)}`
      );
    }
  } catch (error: any) {
    console.log("Decryption failed:", error.message);
  }
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error("Error:", error.message);
    process.exit(1);
  });
