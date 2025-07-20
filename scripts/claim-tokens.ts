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

  // Check balances before claiming
  const publicBalance = await token.balanceOf(signer.address);
  console.log(`${tokenSymbol}: ${ethers.formatEther(publicBalance)}`);

  // Check pending claims
  try {
    const userClaims = await confidentialToken.getUserClaims(signer.address);
    if (userClaims.length > 0) {
      console.log(`Claims: ${userClaims.length}`);
      let totalClaimable = 0n;
      for (let i = 0; i < userClaims.length; i++) {
        const claim = userClaims[i];
        const amount = claim.decrypted
          ? claim.decryptedAmount
          : claim.requestedAmount;
        console.log(`${ethers.formatEther(amount)} ${tokenSymbol}`);
        if (!claim.claimed) {
          totalClaimable += amount;
        }
      }

      if (totalClaimable > 0n) {
        console.log(
          `Claimable: ${ethers.formatEther(totalClaimable)} ${tokenSymbol}`
        );

        const claimTx = await confidentialToken.claimAllDecrypted();
        console.log(`Transaction: ${claimTx.hash}`);

        const receipt = await claimTx.wait();
        console.log(`Block: ${receipt?.blockNumber}`);

        const newPublicBalance = await token.balanceOf(signer.address);
        const difference = newPublicBalance - publicBalance;
        console.log(
          `New ${tokenSymbol}: ${ethers.formatEther(newPublicBalance)}`
        );
        console.log(
          `Received: ${ethers.formatEther(difference)} ${tokenSymbol}`
        );
      } else {
        console.log("No claimable tokens");
      }
    } else {
      console.log("No claims found");
    }
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
