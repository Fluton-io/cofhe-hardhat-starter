import { task } from "hardhat/config";
import addresses from "../../config/addresses";
import { EERC20 } from "../../types";

task("wrap", "Wrap your erc20 into eERC20")
  .addOptionalParam("signeraddress", "The address of the signer")
  .addOptionalParam("tokenaddress", "The address of the token contract")
  .addOptionalParam("to", "The address to send the wrapped tokens")
  .addOptionalParam(
    "amount",
    "The amount of tokens to wrap",
    "10000000000000000000"
  )
  .setAction(async ({ signeraddress, tokenaddress, to, amount }, hre) => {
    const { ethers, getChainId, deployments, getNamedAccounts } = hre;
    const chainId = await getChainId();
    const signerAddress = signeraddress || (await getNamedAccounts()).user;
    const signer = await ethers.getSigner(signerAddress);

    if (!to) {
      to = signer.address;
    }

    if (!tokenaddress) {
      tokenaddress = addresses[+chainId].eTEST_TOKEN; // Default to deployed
    }

    // Approval check
    const eTokenContract = (await ethers.getContractAt(
      "eERC20",
      tokenaddress,
      signer
    )) as unknown as EERC20;
    const tokenAddress = await eTokenContract.erc20();
    const tokenContract = await ethers.getContractAt(
      "IERC20",
      tokenAddress,
      signer
    );
    const allowance = await tokenContract.allowance(
      signer.address,
      tokenaddress
    );

    if (allowance < amount) {
      console.log(`Approving ${amount} tokens for wrapping...`);
      const approveTx = await tokenContract.approve(tokenaddress, amount);
      await approveTx.wait();
      console.log(`Approved ${amount} tokens for wrapping.`);
    } else {
      console.log(
        `Sufficient allowance already exists: ${allowance.toString()}`
      );
    }

    // Wrapping tokens
    console.log(
      `Wrapping ${amount} tokens from ${signer.address} to ${to} in token ${tokenaddress}`
    );
    await eTokenContract.wrap(to, amount);

    console.log(
      `Wrapped ${amount} of tokens from ${signer.address} to ${to} in token ${tokenaddress}`
    );
  });
