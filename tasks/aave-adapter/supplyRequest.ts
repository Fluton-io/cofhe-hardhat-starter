import { task, types } from "hardhat/config";
import addresses from "../../config/addresses";
import { Encryptable } from "@cofhe/sdk";
import { getCofheClient } from "../../utils/cofheClient";
import { recentFromBlock } from "../../utils";

task("aaveSupplyRequest", "Submit a confidential supply request to the Aave adapter")
  .addOptionalParam("signeraddress", "The address of the signer")
  .addOptionalParam("diamondaddress", "Diamond contract address")
  .addOptionalParam("asset", "The underlying asset address (defaults to AAVE_USDC)")
  .addOptionalParam("amount", "The amount to supply, in cToken decimals", "1000000")
  .addOptionalParam("referralcode", "Aave referral code", 0, types.int)
  .setAction(async ({ signeraddress, diamondaddress, asset, amount, referralcode }, hre) => {
    const { ethers, getChainId, deployments, getNamedAccounts } = hre;
    const chainId = await getChainId();
    const signerAddress = signeraddress || (await getNamedAccounts()).user;
    const signer = await ethers.getSigner(signerAddress);

    if (!diamondaddress) {
      diamondaddress = (await deployments.get("Diamond")).address;
    }
    if (!asset) {
      asset = addresses[+chainId].AAVE_USDC;
    }

    const client = await getCofheClient(hre, signer);

    const [amountHash, proof] = await client
      .encryptInputs([Encryptable.uint64(amount)])
      .setConsumingContract(diamondaddress)
      .execute();

    const supplyFacet = await ethers.getContractAt("SupplyFacet", diamondaddress, signer);

    const tx = await supplyFacet.supplyRequest(asset, amountHash, referralcode, proof);
    console.log(`supplyRequest tx: ${tx.hash}`);
    await tx.wait();
    console.log("Supply request submitted.");
  });

task("aaveSupplyUnwrap", "First finalize step for a supply batch: verify + unwrap the cToken total")
  .addOptionalParam("signeraddress", "The address of the signer")
  .addOptionalParam("diamondaddress", "Diamond contract address")
  .addParam("batchid", "The batch id to unwrap", undefined, types.string)
  .setAction(async ({ signeraddress, diamondaddress, batchid }, hre) => {
    const { ethers, deployments, getNamedAccounts } = hre;
    const signerAddress = signeraddress || (await getNamedAccounts()).relayer;
    const signer = await ethers.getSigner(signerAddress);

    if (!diamondaddress) {
      diamondaddress = (await deployments.get("Diamond")).address;
    }

    const supplyFacet = await ethers.getContractAt("SupplyFacet", diamondaddress, signer);

    const events = await supplyFacet.queryFilter(
      supplyFacet.filters.SupplyBatchFormed(undefined, batchid),
      await recentFromBlock(hre),
    );
    if (events.length === 0) {
      throw new Error(`No SupplyBatchFormed event found for batch ${batchid}`);
    }
    const ctHash = events[0].args.ctHash;

    const client = await getCofheClient(hre, signer);
    const { decryptedValue, signature } = await client.decryptForTx(ctHash).withoutACP().execute();

    const tx = await supplyFacet.unwrapSupplyForFinalize(batchid, decryptedValue, signature);
    console.log(`unwrapForFinalize tx: ${tx.hash}`);
    await tx.wait();
    console.log("Supply batch unwrapped.");
  });

task("aaveSupplyFinalize", "Second finalize step for a supply batch: settle the unwrap claim and supply into Aave")
  .addOptionalParam("signeraddress", "The address of the signer")
  .addOptionalParam("diamondaddress", "Diamond contract address")
  .addParam("batchid", "The batch id to finalize", undefined, types.string)
  .setAction(async ({ signeraddress, diamondaddress, batchid }, hre) => {
    const { ethers, deployments, getNamedAccounts } = hre;
    const signerAddress = signeraddress || (await getNamedAccounts()).relayer;
    const signer = await ethers.getSigner(signerAddress);

    if (!diamondaddress) {
      diamondaddress = (await deployments.get("Diamond")).address;
    }

    const supplyFacet = await ethers.getContractAt("SupplyFacet", diamondaddress, signer);

    const events = await supplyFacet.queryFilter(supplyFacet.filters.SupplyUnwrapped(batchid), await recentFromBlock(hre));
    if (events.length === 0) {
      throw new Error(`No SupplyUnwrapped event found for batch ${batchid} - run aaveSupplyUnwrap first`);
    }
    const unwrapCtHash = events[0].args.unwrapCtHash;

    const client = await getCofheClient(hre, signer);
    const { decryptedValue, signature } = await client.decryptForTx(unwrapCtHash).withoutACP().execute();

    const tx = await supplyFacet.finalizeSupplyRequests(batchid, decryptedValue, signature);
    console.log(`finalizeSupplyRequests tx: ${tx.hash}`);
    await tx.wait();
    console.log("Supply batch finalized.");
  });
