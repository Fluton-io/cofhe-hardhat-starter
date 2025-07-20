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
  const underlyingBalance = await token.balanceOf(signer.address);
  console.log(`${tokenSymbol}: ${ethers.formatEther(underlyingBalance)}`);

  // Get tokens from faucet if needed
  const amountToWrap = ethers.parseEther("1000");
  if (underlyingBalance < amountToWrap) {
    const amountToMint = amountToWrap * 2n;
    const faucetTx = await token.faucet(amountToMint);
    console.log(`Faucet: ${faucetTx.hash}`);
    await faucetTx.wait();

    const newBalance = await token.balanceOf(signer.address);
    console.log(`New ${tokenSymbol}: ${ethers.formatEther(newBalance)}`);
  }

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
