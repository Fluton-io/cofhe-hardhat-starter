import { task } from "hardhat/config";
import addresses from "../../config/addresses";
import { EERC20 } from "../../types";

task("unwrap", "Unwrap your eERC20 into erc20")
  .addOptionalParam("signeraddress", "The address of the signer")
  .addOptionalParam("tokenaddress", "The address of the token contract")
  .addOptionalParam("to", "The address to send the unwrapped tokens")
  .addOptionalParam(
    "amount",
    "The amount of tokens to unwrap",
    "1000000000000000000"
  )
  .addOptionalParam(
    "autoclaim",
    "Automatically claim all unwrapped tokens after unwrapping",
    "true"
  )
  .setAction(
    async ({ signeraddress, tokenaddress, to, amount, autoclaim }, hre) => {
      const { ethers, getChainId, deployments, getNamedAccounts } = hre;
      const chainId = await getChainId();
      const signerAddress = signeraddress || (await getNamedAccounts()).user;
      const signer = await ethers.getSigner(signerAddress);

      if (!to) {
        to = signer.address;
      }

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

      // Check encrypted balance before unwrapping
      const encryptedBalance = await eTokenContract.encBalanceOf(
        signer.address
      );
      const indicatedBalance = await eTokenContract.balanceOf(signer.address);

      console.log(`Current encrypted balance: ${encryptedBalance.toString()}`);
      console.log(`Current indicated balance: ${indicatedBalance.toString()}`);

      // Unwrap tokens
      console.log(`Unwrapping ${amount} tokens`);

      const unwrapTx = await eTokenContract.unwrap(to, amount);
      await unwrapTx.wait();

      console.log(`Successfully unwrapped ${amount} tokens`);
      console.log(`Transaction hash: ${unwrapTx.hash}`);

      // Auto-claim unwrapped tokens if requested
      if (autoclaim === "true") {
        console.log(`Auto-claiming all unwrapped tokens...`);

        // Wait a moment for the unwrap transaction to be fully processed
        console.log(`Waiting 3 seconds for unwrap to be processed...`);
        await new Promise((resolve) => setTimeout(resolve, 3000));

        try {
          // Check if there are any claims to process first
          const claims = await eTokenContract.getUserClaims(to);

          if (claims.length === 0) {
            console.log(`No pending claims found`);
            return;
          }

          console.log(`Found ${claims.length} claim(s)`);

          // Check if any claims are ready (decrypted and not claimed)
          let readyToClaim = 0;
          for (const claim of claims) {
            if (claim.decrypted && !claim.claimed) {
              readyToClaim++;
            }
          }

          console.log(`${readyToClaim} claim(s) ready to be processed`);

          if (readyToClaim === 0) {
            console.log(`No claims are ready yet.`);
            return;
          }

          const claimTx = await eTokenContract.claimAllUnwrapped();
          await claimTx.wait();

          console.log(`Successfully claimed all unwrapped tokens!`);
          console.log(`Claim transaction hash: ${claimTx.hash}`);

          // Check the underlying ERC20 balance to confirm
          const underlyingTokenAddress = await eTokenContract.erc20();
          const underlyingTokenContract = await ethers.getContractAt(
            "IERC20",
            underlyingTokenAddress,
            signer
          );
          const finalBalance = await underlyingTokenContract.balanceOf(to);
          console.log(`Final ERC20 balance: ${finalBalance.toString()}`);
        } catch (error) {
          console.log(`Error during auto-claim: ${error}`);
        }
      }
    }
  );
