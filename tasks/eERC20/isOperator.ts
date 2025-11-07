import { task } from "hardhat/config";
import { EERC20 } from "../../types";
import addresses from "../../config/addresses";

task("isOperator", "Check if an address is an operator for eERC20 tokens")
  .addOptionalParam("signeraddress", "The address of the signer")
  .addOptionalParam("tokenaddress", "The address of the token contract")
  .addOptionalParam("holderaddress", "The address of the holder")
  .addOptionalParam("spenderaddress", "The address of the spender.")
  .setAction(async ({ signeraddress, tokenaddress, holderaddress, spenderaddress }, hre) => {
    const { ethers, deployments, getChainId, getNamedAccounts } = hre;
    const chainId = await getChainId();
    const signerAddress = signeraddress || (await getNamedAccounts()).user;
    const signer = await ethers.getSigner(signerAddress);

    if (!tokenaddress) {
      const tokenDeployment = await deployments.get("eERC20");
      tokenaddress = tokenDeployment.address || addresses[+chainId].eUSDC; // Default to deployed
    }

    if (!spenderaddress) {
      const bridgeDeployment = await deployments.get("FhenixBridge");
      spenderaddress = bridgeDeployment.address || addresses[+chainId].FhenixBridge; // Default to deployed bridge address
    }

    if (!holderaddress) {
      holderaddress = signerAddress; // Default to user address
    }

    const tokenContract = (await ethers.getContractAt("eERC20", tokenaddress, signer)) as unknown as EERC20;

    const isOperator = await tokenContract.isOperator(holderaddress, spenderaddress);

    console.log(`Is ${spenderaddress} an operator for ${holderaddress} in token ${tokenaddress}?`, isOperator);
  });
