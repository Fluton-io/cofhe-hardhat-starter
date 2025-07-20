import { ethers } from "hardhat";

async function main() {
  const [signer] = await ethers.getSigners();

  const tokenAddress = "0xe7a31dD47e96FE04ac2C8B3c703e637Ae1ad88d5";
  const confidentialAddress = "0x603A6e813040b23d948b591f79756B4BF7409938";

  const token = await ethers.getContractAt("MockERC20", tokenAddress);
  const confidentialToken = await ethers.getContractAt(
    "ConfidentialERC20",
    confidentialAddress
  );

  const tokenSymbol = await token.symbol();
  const confSymbol = await confidentialToken.symbol();

  const publicBalance = await token.balanceOf(signer.address);
  const indicatedBalance = await confidentialToken.balanceOf(signer.address);
  console.log(`${tokenSymbol}: ${ethers.formatEther(publicBalance)}`);
  console.log(`${confSymbol}: ${ethers.formatEther(indicatedBalance)}`);

  const unwrapAmount = ethers.parseEther("100");

  try {
    const unwrapTx = await confidentialToken.decrypt(
      signer.address,
      unwrapAmount
    );
    console.log(`Transaction: ${unwrapTx.hash}`);

    const receipt = await unwrapTx.wait();
    console.log(`Block: ${receipt?.blockNumber}`);

    const userClaims = await confidentialToken.getUserClaims(signer.address);
    if (userClaims.length > 0) {
      console.log(`Claims: ${userClaims.length}`);
    }

    const newPublicBalance = await token.balanceOf(signer.address);
    const newIndicatedBalance = await confidentialToken.balanceOf(
      signer.address
    );
    console.log(`New ${tokenSymbol}: ${ethers.formatEther(newPublicBalance)}`);
    console.log(
      `New ${confSymbol}: ${ethers.formatEther(newIndicatedBalance)}`
    );
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
