import { ethers } from "hardhat";
import hre from "hardhat";
import { FheTypes } from "@cofhe/sdk";

async function main() {
  const [signer] = await ethers.getSigners();

  // Contract addresses
  const tokenAddress = "0xe7a31dD47e96FE04ac2C8B3c703e637Ae1ad88d5";
  const confidentialAddress = "0x92B7BE7B0f31d912f46fCD77EEb585034dc64d14";

  const client = await hre.cofhe.createClientWithBatteries(signer);

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

    const sealedBalance = await confidentialToken.encBalanceOf(signer.address);
    console.log(`Sealed balance: ${sealedBalance}`);

    const decryptedBalance = await client.decryptForView(sealedBalance, FheTypes.Uint128).withACP().execute();

    console.log(`${confSymbol} (decrypted): ${ethers.formatEther(decryptedBalance)}`);
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
