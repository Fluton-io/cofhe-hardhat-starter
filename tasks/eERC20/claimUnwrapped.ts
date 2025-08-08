import { task } from "hardhat/config";
import addresses from "../../config/addresses";
import { EERC20 } from "../../types";

task("claimUnwrapped", "Claim a specific unwrapped amount using ctHash")
  .addOptionalParam("signeraddress", "The address of the signer")
  .addOptionalParam("tokenaddress", "The address of the token contract")
  .addParam("cthash", "The ctHash of the unwrapped amount to claim")
  .setAction(async ({ signeraddress, tokenaddress, cthash }, hre) => {
    const { ethers, getChainId, deployments, getNamedAccounts } = hre;
    const chainId = await getChainId();
    const signerAddress = signeraddress || (await getNamedAccounts()).user;
    const signer = await ethers.getSigner(signerAddress);

    if (!tokenaddress) {
      const tokenDeployment = await deployments.get("eERC20");
      tokenaddress = tokenDeployment.address || addresses[+chainId].eUSDC; // Default to deployed
    }

    // Get eToken contract
    const eTokenContract = (await ethers.getContractAt(
      "eERC20",
      tokenaddress,
      signer
    )) as unknown as EERC20;

    console.log(
      `Checking claim for ctHash: ${cthash} in token ${tokenaddress}`
    );

    try {
      // First, check if the claim exists and get its details
      const claim = await eTokenContract.getClaim(cthash);

      // Validate claim status
      if (claim.claimed) {
        console.log(`This claim has already been processed`);
        return;
      }

      if (!claim.decrypted) {
        console.log(
          `Claim is not yet decrypted. Please wait for FHE decryption to complete.`
        );
        return;
      }

      if (claim.to === "0x0000000000000000000000000000000000000000") {
        console.log(`Claim not found. Please check the ctHash is correct.`);
        return;
      }

      // Get current ERC20 balance before claiming
      const underlyingTokenAddress = await eTokenContract.erc20();
      const underlyingTokenContract = await ethers.getContractAt(
        "IERC20",
        underlyingTokenAddress,
        signer
      );
      const balanceBefore = await underlyingTokenContract.balanceOf(claim.to);

      console.log(
        `Current ERC20 balance of ${claim.to}: ${balanceBefore.toString()}`
      );
      console.log(`Claiming ${claim.decryptedAmount.toString()} tokens...`);

      // Claim the specific unwrapped tokens
      const claimTx = await eTokenContract.claimUnwrapped(cthash);
      await claimTx.wait();

      console.log(`Successfully claimed unwrapped tokens!`);
      console.log(`Transaction hash: ${claimTx.hash}`);

      // Check final balance and verify the claim
      const balanceAfter = await underlyingTokenContract.balanceOf(claim.to);
      const amountClaimed = balanceAfter - balanceBefore;

      console.log(
        `Final ERC20 balance of ${claim.to}: ${balanceAfter.toString()}`
      );
      console.log(`Amount claimed: ${amountClaimed.toString()}`);

      // Verify the claim is now marked as claimed
      const updatedClaim = await eTokenContract.getClaim(cthash);
      console.log(`Claim status updated: ${updatedClaim.claimed}`);
    } catch (error) {
      console.log(`Error claiming unwrapped tokens: ${error}`);
    }
  });
