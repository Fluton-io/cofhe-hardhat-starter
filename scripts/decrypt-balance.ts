import { ethers } from "hardhat";

async function main() {
  const [signer] = await ethers.getSigners();

  // Contract addresses
  const tokenAddress = "0xe7a31dD47e96FE04ac2C8B3c703e637Ae1ad88d5";
  const confidentialAddress = "0x603A6e813040b23d948b591f79756B4BF7409938";

  // Get contracts
  const token = await ethers.getContractAt("MockERC20", tokenAddress);
  const confidentialToken = await ethers.getContractAt(
    "ConfidentialERC20",
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

  // Get encrypted balance if available
  try {
    const encBalance = await confidentialToken.encBalanceOf(signer.address);
    console.log(`Encrypted: ${encBalance}`);
  } catch (error) {
    console.log("Encrypted balance not accessible");
  }
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error("Error:", error.message);
    process.exit(1);
  });
