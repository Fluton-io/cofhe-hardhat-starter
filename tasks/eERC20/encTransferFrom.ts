import { task } from "hardhat/config";
import addresses from "../../config/addresses";
import { EERC20 } from "../../types";
import { cofhejs, Encryptable } from "cofhejs/node";

task("encTransferFrom", "Transfer eERC20 tokens to another address")
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
      const tokenDeployment = await deployments.get("eERC20");
      tokenaddress = tokenDeployment.address || addresses[+chainId].eUSDC; // Default to deployed
    }

    await cofhe.expectResultSuccess(
      await cofhejs.initializeWithEthers({
        ethersProvider: ethers.provider,
        ethersSigner: signer,
        environment: "TESTNET",
      })
    );

    const encTransferResult = await cofhejs.encrypt([Encryptable.uint64(amount)] as const);

    if (!encTransferResult.success) {
      console.error("Failed to encrypt transfer amount:", encTransferResult.error);
      return;
    }

    const [encTransferInput] = await hre.cofhe.expectResultSuccess(encTransferResult);

    // Generate permit
    const eTokenContract = (await ethers.getContractAt("eERC20", tokenaddress, signer)) as unknown as EERC20;

    // Execute the transfer
    const transferTx = await eTokenContract["confidentialTransferFrom(address,address,(uint256,uint8,uint8,bytes))"](
      signer.address,
      to,
      encTransferInput
    );

    console.log(`Transaction: ${transferTx.hash}`);
  });
