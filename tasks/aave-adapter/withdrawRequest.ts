import { task, types } from "hardhat/config";
import addresses from "../../config/addresses";
import { Encryptable } from "@cofhe/sdk";

task("aaveWithdrawRequest", "Submit a confidential withdraw request to the Aave adapter")
  .addOptionalParam("signeraddress", "The address of the signer")
  .addOptionalParam("diamondaddress", "Diamond contract address")
  .addOptionalParam("asset", "The underlying asset address (defaults to AAVE_USDC)")
  .addOptionalParam("amount", "The amount to withdraw, in cToken decimals", "1000000")
  .setAction(async ({ signeraddress, diamondaddress, asset, amount }, hre) => {
    const { ethers, getChainId, deployments, getNamedAccounts, cofhe } = hre;
    const chainId = await getChainId();
    const signerAddress = signeraddress || (await getNamedAccounts()).user;
    const signer = await ethers.getSigner(signerAddress);

    if (!diamondaddress) {
      diamondaddress = (await deployments.get("Diamond")).address;
    }
    if (!asset) {
      asset = addresses[+chainId].AAVE_USDC;
    }

    const client = await cofhe.createClientWithBatteries(signer);

    const [amountHash, proof] = await client
      .encryptInputs([Encryptable.uint64(amount)])
      .setConsumingContract(diamondaddress)
      .execute();

    const withdrawFacet = await ethers.getContractAt("WithdrawFacet", diamondaddress, signer);

    const tx = await withdrawFacet.withdrawRequest(asset, amountHash, proof);
    console.log(`withdrawRequest tx: ${tx.hash}`);
    await tx.wait();
    console.log("Withdraw request submitted.");
  });

task("aaveWithdrawFinalize", "Finalize a withdraw batch: verify the total, withdraw from Aave, and distribute it")
  .addOptionalParam("signeraddress", "The address of the signer")
  .addOptionalParam("diamondaddress", "Diamond contract address")
  .addParam("batchid", "The batch id to finalize", undefined, types.string)
  .setAction(async ({ signeraddress, diamondaddress, batchid }, hre) => {
    const { ethers, deployments, getNamedAccounts, cofhe } = hre;
    const signerAddress = signeraddress || (await getNamedAccounts()).relayer;
    const signer = await ethers.getSigner(signerAddress);

    if (!diamondaddress) {
      diamondaddress = (await deployments.get("Diamond")).address;
    }

    const withdrawFacet = await ethers.getContractAt("WithdrawFacet", diamondaddress, signer);

    const events = await withdrawFacet.queryFilter(withdrawFacet.filters.WithdrawBatchFormed(undefined, batchid));
    if (events.length === 0) {
      throw new Error(`No WithdrawBatchFormed event found for batch ${batchid}`);
    }
    const ctHash = events[0].args.ctHash;

    const client = await cofhe.createClientWithBatteries(signer);
    const { decryptedValue, signature } = await client.decryptForTx(ctHash).withoutACP().execute();

    const tx = await withdrawFacet.finalizeWithdrawRequests(batchid, decryptedValue, signature);
    console.log(`finalizeWithdrawRequests tx: ${tx.hash}`);
    await tx.wait();
    console.log("Withdraw batch finalized.");
  });
