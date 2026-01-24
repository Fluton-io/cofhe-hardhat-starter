import { task } from "hardhat/config";
import addresses from "../../config/addresses";
import { EERC20 } from "../../types";
import { cofhejs, FheTypes } from "cofhejs/node";

task("balanceOf", "Get user balance")
  .addOptionalParam("signeraddress", "The address of the signer")
  .addOptionalParam("tokenaddress", "The address of the token contract")
  .addOptionalParam("useraddress", "The address of the user")
  .setAction(async ({ signeraddress, tokenaddress, useraddress }, hre) => {
    const { ethers, getChainId, getNamedAccounts, deployments, cofhe } = hre;
    const chainId = await getChainId();
    const userAddress = useraddress || (await getNamedAccounts()).deployer;
    const signerAddress = signeraddress || (await getNamedAccounts()).deployer;
    const signer = await ethers.getSigner(signerAddress);

    if (!addresses[+chainId]) {
      throw new Error("Chain ID not supported");
    }

    if (!tokenaddress) {
      const tokenDeployment = await deployments.getOrNull("eERC20");
      tokenaddress = tokenDeployment?.address || addresses[+chainId].eUSDC; // Default to deployed
    }

    const tokenContract = (await ethers.getContractAt("eERC20", tokenaddress, signer)) as unknown as EERC20;
    const encryptedBalance = await tokenContract.confidentialBalanceOf(userAddress);
    const indicatedBalance = await tokenContract.balanceOf(userAddress);

    console.log(
      `Encrypted Balance of ${userAddress} in token ${tokenaddress} on chain ${chainId} is`,
      encryptedBalance.toString()
    );
    console.log(
      `Indicated Balance of ${userAddress} in token ${tokenaddress} on chain ${chainId} is`,
      indicatedBalance.toString()
    );

    await cofhe.expectResultSuccess(
      await cofhejs.initializeWithEthers({
        ethersProvider: ethers.provider,
        ethersSigner: signer,
        environment: "TESTNET",
      })
    );
    const unsealedBalance = await cofhe.expectResultSuccess(await cofhejs.unseal(encryptedBalance, FheTypes.Uint64));

    console.log(
      `Unsealed Balance of ${userAddress} in token ${tokenaddress} on chain ${chainId} is`,
      unsealedBalance.toString()
    );
  });
