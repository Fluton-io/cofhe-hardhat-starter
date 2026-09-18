import { task } from "hardhat/config";
import addresses from "../../config/addresses";
import { EERC20 } from "../../types";
import { getCofheClient } from "../../utils/cofheClient";

task("unwrap", "Unwrap your eERC20 into ERC20")
  .addOptionalParam("signeraddress", "The address of the signer")
  .addOptionalParam("tokenaddress", "The address of the token contract")
  .addOptionalParam("to", "The address to send the unwrapped tokens")
  .addOptionalParam("amount", "The amount of tokens to unwrap", "1000000")
  .setAction(async ({ signeraddress, tokenaddress, to, amount }, hre) => {
    const { ethers, getChainId, deployments, getNamedAccounts } = hre;
    const chainId = await getChainId();
    const signerAddress = signeraddress || (await getNamedAccounts()).user;
    const signer = await ethers.getSigner(signerAddress);

    if (!to) {
      to = signer.address;
    }

    if (!tokenaddress) {
      const tokenDeployment = await deployments.getOrNull("eERC20");
      tokenaddress = tokenDeployment?.address || addresses[+chainId].eUSDC; // Default to deployed
    }

    const eTokenContract = (await ethers.getContractAt("eERC20", tokenaddress, signer)) as unknown as EERC20;

    // Unwrapping tokens
    console.log(`Unwrapping ${amount} tokens from ${signer.address} to ${to} in token ${tokenaddress}`);
    await (await eTokenContract.unwrap(to, amount)).wait();

    const client = await getCofheClient(hre, signer);

    const pendingClaims = (await eTokenContract.getUserClaims(to)).filter((claim) => !claim.claimed);

    console.log(`Publishing decrypt results for ${pendingClaims.length} pending claim(s)...`);
    for (const claim of pendingClaims) {
      const { decryptedValue, signature } = await client.decryptForTx(claim.ctHash).withoutACP().execute();
      await (
        await eTokenContract.publishUnwrapDecryption(claim.ctHash, decryptedValue, signature)
      ).wait();
    }

    await (await eTokenContract.claimAllUnwrapped()).wait();

    console.log(`Unwrapped ${amount} of tokens from ${signer.address} to ${to} in token ${tokenaddress}`);
  });
