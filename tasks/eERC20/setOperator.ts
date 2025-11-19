import { task, types } from "hardhat/config";
import { EERC20 } from "../../types";
import addresses from "../../config/addresses";

task("setOperator", "Set an operator for eERC20 tokens")
  .addOptionalParam("signeraddress", "The address of the signer")
  .addOptionalParam("tokenaddress", "The address of the token contract")
  .addOptionalParam("spenderaddress", "The address of the spender.")
  .addOptionalParam(
    "timestamp",
    "The timestamp for the operator",
    Math.floor(Date.now() / 1000) + 60 * 60 * 24 * 365,
    types.int
  )
  .setAction(async ({ signeraddress, tokenaddress, spenderaddress, timestamp }, hre) => {
    const { ethers, deployments, getChainId, getNamedAccounts } = hre;
    const chainId = await getChainId();
    const signerAddress = signeraddress || (await getNamedAccounts()).user;
    const signer = await ethers.getSigner(signerAddress);

    if (!tokenaddress) {
      const tokenDeployment = await deployments.getOrNull("eERC20");
      tokenaddress = tokenDeployment?.address || addresses[+chainId].eUSDC; // Default to deployed
    }

    if (!spenderaddress) {
      const bridgeDeployment = await deployments.getOrNull("FhenixBridge");
      spenderaddress = bridgeDeployment?.address || addresses[+chainId].FhenixBridge; // Default to deployed bridge address
    }

    const tokenContract = (await ethers.getContractAt("eERC20", tokenaddress, signer)) as unknown as EERC20;

    await tokenContract.setOperator(spenderaddress, timestamp);

    console.log(`Operator set successfully.`);
  });
