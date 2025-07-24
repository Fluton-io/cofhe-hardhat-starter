import { ethers } from "hardhat";

async function main() {
  const [signer] = await ethers.getSigners();

  // Contract addresses
  const tokenAddress = "0xe7a31dD47e96FE04ac2C8B3c703e637Ae1ad88d5";
  const confidentialAddress = "0x92B7BE7B0f31d912f46fCD77EEb585034dc64d14";

  // Get contracts
  const token = await ethers.getContractAt("MockERC20", tokenAddress);
  const confidentialToken = await ethers.getContractAt(
    "contracts/ConfidentialERC20.sol:ConfidentialERC20",
    confidentialAddress
  );

  const tokenSymbol = await token.symbol();
  const confSymbol = await confidentialToken.symbol();

  // Check current balances
  const underlyingBalance = await token.balanceOf(signer.address);
  console.log(`${tokenSymbol}: ${ethers.formatEther(underlyingBalance)}`);

  const amountToWrap = ethers.parseEther("100");

  // Approve and wrap tokens
  const approveTx = await token.approve(confidentialAddress, amountToWrap);
  console.log(`Approve: ${approveTx.hash}`);
  await approveTx.wait();

  const wrapTx = await confidentialToken.encrypt(signer.address, amountToWrap);
  console.log(`Wrap: ${wrapTx.hash}`);
  await wrapTx.wait();

  // Check final balances
  const finalUnderlyingBalance = await token.balanceOf(signer.address);
  const finalConfidentialBalance = await confidentialToken.balanceOf(
    signer.address
  );
  console.log(
    `Final ${tokenSymbol}: ${ethers.formatEther(finalUnderlyingBalance)}`
  );
  console.log(
    `Final ${confSymbol}: ${ethers.formatEther(finalConfidentialBalance)}`
  );
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error("Error:", error.message);
    process.exit(1);
  });
