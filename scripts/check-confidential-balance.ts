import { ethers } from "hardhat";

async function main() {
  const [signer] = await ethers.getSigners();

  const tokenAddress = "0xe7a31dD47e96FE04ac2C8B3c703e637Ae1ad88d5";
  const confidentialAddress = "0x603A6e813040b23d948b591f79756B4BF7409938";

  const token = await ethers.getContractAt("MockERC20", tokenAddress);
  const confidentialToken = await ethers.getContractAt("ConfidentialERC20", confidentialAddress);

  const tokenSymbol = await token.symbol();
  const confSymbol = await confidentialToken.symbol();

  const underlyingBalance = await token.balanceOf(signer.address);
  const indicatedBalance = await confidentialToken.balanceOf(signer.address);

  console.log(`${tokenSymbol}: ${ethers.formatEther(underlyingBalance)}`);
  console.log(`${confSymbol}: ${ethers.formatEther(indicatedBalance)} (indicated)`);

  try {
    const userClaims = await confidentialToken.getUserClaims(signer.address);
    if (userClaims.length > 0) {
      console.log(`Claims: ${userClaims.length}`);
      for (let i = 0; i < userClaims.length; i++) {
        const claim = userClaims[i];
        const amount = claim.decrypted ? claim.decryptedAmount : claim.requestedAmount;
        console.log(`${ethers.formatEther(amount)} ${tokenSymbol} - ${claim.claimed ? "claimed" : "pending"}`);
      }
    }
  } catch (error) {
    console.log("No claims found");
  }
}

main().then(() => process.exit(0)).catch((error) => {
  console.error("Error:", error.message);
  process.exit(1);
});
