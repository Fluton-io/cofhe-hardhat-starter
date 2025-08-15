import { task } from "hardhat/config";
import addresses from "../../config/addresses";

task("mint-erc20", "Mint ERC20 tokens to a specified address")
  .addParam("to", "The address to mint tokens to")
  .addParam("amount", "The amount of tokens to mint (in ether units)")
  .addOptionalParam("tokenaddress", "The address of the ERC20 token contract")
  .addOptionalParam("signeraddress", "The address of the signer (token owner)")
  .setAction(async ({ to, amount, tokenaddress, signeraddress }, hre) => {
    const { ethers, deployments, getChainId, getNamedAccounts } = hre;
    const chainId = await getChainId();
    const signerAddress = signeraddress || (await getNamedAccounts()).deployer;
    const signer = await ethers.getSigner(signerAddress);

    let tokenAddr = tokenaddress;
    if (!tokenAddr) {
      // Try to get from addresses config first
      tokenAddr = addresses[+chainId]?.SimpleERC20;
      if (!tokenAddr) {
        try {
          // Then try to get from deployments
          const tokenDeployment = await deployments.get("SimpleERC20");
          tokenAddr = tokenDeployment.address;
        } catch {
          console.log(
            "Token address not found. Please provide --tokenaddress or deploy SimpleERC20 first"
          );
          return;
        }
      }
    }

    const tokenContract = await ethers.getContractAt(
      "SimpleERC20",
      tokenAddr,
      signer
    );

    // Convert amount to wei
    const amountInWei = ethers.parseEther(amount);

    console.log(`Minting ${amount} tokens to ${to}...`);
    console.log(`Token contract: ${tokenAddr}`);
    console.log(`Signer: ${signer.address}`);

    try {
      const tx = await tokenContract.mint(to, amountInWei);
      console.log(`Transaction hash: ${tx.hash}`);

      await tx.wait();
      console.log(`Successfully minted ${amount} tokens to ${to}`);

      // Check new balance
      const balance = await tokenContract.balanceOf(to);
      console.log(`New balance: ${ethers.formatEther(balance)} tokens`);
    } catch (error: any) {
      console.error("Minting failed:", error.message);
    }
  });
