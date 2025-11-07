import { task } from "hardhat/config";
import addresses from "../../config/addresses";
import { EERC20 } from "../../types";
import { sleep } from "../../utils";

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
      const tokenDeployment = await deployments.get("eERC20");
      tokenaddress = tokenDeployment.address || addresses[+chainId].eUSDC; // Default to deployed
    }

    const eTokenContract = (await ethers.getContractAt("eERC20", tokenaddress, signer)) as unknown as EERC20;

    // Unwrapping tokens
    console.log(`Unwrapping ${amount} tokens from ${signer.address} to ${to} in token ${tokenaddress}`);
    await eTokenContract.unwrap(to, amount);

    console.log("waiting for decryption...");
    await sleep(30000); // Wait for 30 seconds to allow for decryption to complete
    await eTokenContract.claimAllUnwrapped();

    console.log(`Unwrapped ${amount} of tokens from ${signer.address} to ${to} in token ${tokenaddress}`);
  });
