import { task, types } from "hardhat/config";
import addresses from "../../config/addresses";
import { Encryptable } from "@cofhe/sdk";
import { getCofheClient } from "../../utils/cofheClient";
import { recentFromBlock } from "../../utils";

task("aaveBorrowRequest", "Submit a confidential borrow request to the Aave adapter")
  .addOptionalParam("signeraddress", "The address of the signer")
  .addOptionalParam("diamondaddress", "Diamond contract address")
  .addOptionalParam("asset", "The underlying asset address (defaults to AAVE_USDC)")
  .addOptionalParam("amount", "The amount to borrow, in cToken decimals", "1000000")
  .addOptionalParam("interestratemode", "Aave interest rate mode (2 = variable)", 2, types.int)
  .addOptionalParam("referralcode", "Aave referral code", 0, types.int)
  .setAction(async ({ signeraddress, diamondaddress, asset, amount, interestratemode, referralcode }, hre) => {
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

    const borrowFacet = await ethers.getContractAt("BorrowFacet", diamondaddress, signer);

    const tx = await borrowFacet.borrowRequest(asset, amountHash, interestratemode, referralcode, proof);
    console.log(`borrowRequest tx: ${tx.hash}`);
    await tx.wait();
    console.log("Borrow request submitted.");
  });

task("aaveBorrowFinalize", "Finalize a borrow batch: verify the total, borrow from Aave, and distribute it")
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

    const borrowFacet = await ethers.getContractAt("BorrowFacet", diamondaddress, signer);

    const events = await borrowFacet.queryFilter(
      borrowFacet.filters.BorrowBatchFormed(undefined, batchid),
      await recentFromBlock(hre),
    );
    if (events.length === 0) {
      throw new Error(`No BorrowBatchFormed event found for batch ${batchid}`);
    }
    const ctHash = events[0].args.ctHash;

    const client = await getCofheClient(hre, signer);
    const { decryptedValue, signature } = await client.decryptForTx(ctHash).withoutACP().execute();

    const tx = await borrowFacet.finalizeBorrowRequests(batchid, decryptedValue, signature);
    console.log(`finalizeBorrowRequests tx: ${tx.hash}`);
    await tx.wait();
    console.log("Borrow batch finalized.");
  });
