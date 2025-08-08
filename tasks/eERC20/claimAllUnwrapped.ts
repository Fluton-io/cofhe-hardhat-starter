import { task } from "hardhat/config";
import addresses from "../../config/addresses";
import { EERC20 } from "../../types";

task("claimAllUnwrapped", "Claim all pending unwrapped tokens")
  .addOptionalParam("signeraddress", "The address of the signer")
  .addOptionalParam("tokenaddress", "The address of the token contract")
  .setAction(async ({ signeraddress, tokenaddress }, hre) => {
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
      `Checking pending claims for ${signer.address} in token ${tokenaddress}`
    );

    try {
      // Get all user claims first
      const claims = await eTokenContract.getUserClaims(signer.address);

      if (claims.length === 0) {
        console.log(`No pending claims found for ${signer.address}`);
        return;
      }

      console.log(`Found ${claims.length} claim(s):`);

      let readyToClaim = 0;
      let totalClaimableAmount = BigInt(0);

      // Check status of each claim
      for (let i = 0; i < claims.length; i++) {
        const claim = claims[i];
        console.log(
          `  Claim ${i + 1}: ${claim.decrypted ? "Ready" : "Pending"} | ${
            claim.claimed ? "Already claimed" : "Unclaimed"
          } | Amount: ${claim.decryptedAmount.toString()}`
        );

        if (claim.decrypted && !claim.claimed) {
          readyToClaim++;
          totalClaimableAmount += BigInt(claim.decryptedAmount.toString());
        }
      }

      if (readyToClaim === 0) {
        console.log(`No claims are ready to be claimed.`);
        return;
      }

      console.log(
        `\nReady to claim ${readyToClaim} claim(s) totaling ${totalClaimableAmount.toString()} tokens`
      );

      // Get current ERC20 balance before claiming
      const underlyingTokenAddress = await eTokenContract.erc20();
      const underlyingTokenContract = await ethers.getContractAt(
        "IERC20",
        underlyingTokenAddress,
        signer
      );
      const balanceBefore = await underlyingTokenContract.balanceOf(
        signer.address
      );

      console.log(`Current ERC20 balance: ${balanceBefore.toString()}`);
      console.log(`Claiming all unwrapped tokens...`);

      // Claim all unwrapped tokens
      const claimTx = await eTokenContract.claimAllUnwrapped();
      await claimTx.wait();

      console.log(`Successfully claimed all unwrapped tokens!`);
      console.log(`Transaction hash: ${claimTx.hash}`);

      // Check final balance
      const balanceAfter = await underlyingTokenContract.balanceOf(
        signer.address
      );
      const amountClaimed = balanceAfter - balanceBefore;

      console.log(`Final ERC20 balance: ${balanceAfter.toString()}`);
      console.log(`Total amount claimed: ${amountClaimed.toString()}`);

      // Verify no more pending claims
      const remainingClaims = await eTokenContract.getUserClaims(
        signer.address
      );
      console.log(`Remaining pending claims: ${remainingClaims.length}`);
    } catch (error) {
      console.log(`Error claiming unwrapped tokens: ${error}`);
    }
  });
