import { task, types } from "hardhat/config";
import addresses from "../../config/addresses";
import { Encryptable } from "@cofhe/sdk";

task("aaveRepayRequest", "Submit a confidential repay request to the Aave adapter")
  .addOptionalParam("signeraddress", "The address of the signer")
  .addOptionalParam("diamondaddress", "Diamond contract address")
  .addOptionalParam("asset", "The underlying asset address (defaults to AAVE_USDC)")
  .addOptionalParam("amount", "The amount to repay, in cToken decimals", "1000000")
  .addOptionalParam("interestratemode", "Aave interest rate mode (2 = variable)", 2, types.int)
  .setAction(async ({ signeraddress, diamondaddress, asset, amount, interestratemode }, hre) => {
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

    const repayFacet = await ethers.getContractAt("RepayFacet", diamondaddress, signer);

    const tx = await repayFacet.repayRequest(asset, amountHash, interestratemode, proof);
    console.log(`repayRequest tx: ${tx.hash}`);
    await tx.wait();
    console.log("Repay request submitted.");
  });

task("aaveRepayUnwrap", "First finalize step for a repay batch: verify + unwrap the cToken total")
  .addOptionalParam("signeraddress", "The address of the signer")
  .addOptionalParam("diamondaddress", "Diamond contract address")
  .addParam("batchid", "The batch id to unwrap", undefined, types.string)
  .setAction(async ({ signeraddress, diamondaddress, batchid }, hre) => {
    const { ethers, deployments, getNamedAccounts, cofhe } = hre;
    const signerAddress = signeraddress || (await getNamedAccounts()).relayer;
    const signer = await ethers.getSigner(signerAddress);

    if (!diamondaddress) {
      diamondaddress = (await deployments.get("Diamond")).address;
    }

    const repayFacet = await ethers.getContractAt("RepayFacet", diamondaddress, signer);

    const events = await repayFacet.queryFilter(repayFacet.filters.RepayBatchFormed(undefined, batchid));
    if (events.length === 0) {
      throw new Error(`No RepayBatchFormed event found for batch ${batchid}`);
    }
    const ctHash = events[0].args.ctHash;

    const client = await cofhe.createClientWithBatteries(signer);
    const { decryptedValue, signature } = await client.decryptForTx(ctHash).withoutACP().execute();

    const tx = await repayFacet.unwrapRepayForFinalize(batchid, decryptedValue, signature);
    console.log(`unwrapForFinalize tx: ${tx.hash}`);
    await tx.wait();
    console.log("Repay batch unwrapped.");
  });

task("aaveRepayFinalize", "Second finalize step for a repay batch: settle the unwrap claim and repay Aave")
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

    const repayFacet = await ethers.getContractAt("RepayFacet", diamondaddress, signer);

    const events = await repayFacet.queryFilter(repayFacet.filters.RepayUnwrapped(batchid));
    if (events.length === 0) {
      throw new Error(`No RepayUnwrapped event found for batch ${batchid} - run aaveRepayUnwrap first`);
    }
    const unwrapCtHash = events[0].args.unwrapCtHash;

    const client = await cofhe.createClientWithBatteries(signer);
    const { decryptedValue, signature } = await client.decryptForTx(unwrapCtHash).withoutACP().execute();

    const tx = await repayFacet.finalizeRepayRequests(batchid, decryptedValue, signature);
    console.log(`finalizeRepayRequests tx: ${tx.hash}`);
    await tx.wait();
    console.log("Repay batch finalized.");
  });
