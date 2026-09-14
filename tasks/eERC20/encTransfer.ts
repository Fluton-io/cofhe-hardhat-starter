import { task } from "hardhat/config";
import addresses from "../../config/addresses";
import { EERC20 } from "../../types";
import { Encryptable } from "@cofhe/sdk";

task("encTransfer", "Transfer eERC20 tokens to another address")
  .addOptionalParam("signeraddress", "The address of the signer")
  .addOptionalParam("tokenaddress", "The address of the token contract")
  .addOptionalParam("to", "The address to send the wrapped tokens")
  .addOptionalParam("amount", "The amount of tokens to transfer", "1000000")
  .setAction(async ({ signeraddress, tokenaddress, to, amount }, hre) => {
    const { ethers, getChainId, deployments, getNamedAccounts, cofhe } = hre;
    const chainId = await getChainId();
    const signerAddress = signeraddress || (await getNamedAccounts()).user;
    const signer = await ethers.getSigner(signerAddress);

    if (!to) {
      to = (await getNamedAccounts()).relayer; // Default to relayer address
    }

    if (!tokenaddress) {
      const tokenDeployment = await deployments.getOrNull("eERC20");
      tokenaddress = tokenDeployment?.address || addresses[+chainId].eUSDC; // Default to deployed
    }

    const client = await cofhe.createClientWithBatteries(signer);

    const [amountHash, proof] = await client
      .encryptInputs([Encryptable.uint64(amount)])
      .setConsumingContract(tokenaddress)
      .execute();

    const eTokenContract = (await ethers.getContractAt("eERC20", tokenaddress, signer)) as unknown as EERC20;

    // Execute the transfer
    const transferTx = await eTokenContract["confidentialTransfer(address,bytes32,bytes)"](to, amountHash, proof);

    console.log(`Transaction: ${transferTx.hash}`);
  });
