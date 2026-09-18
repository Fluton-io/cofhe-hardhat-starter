import { task } from "hardhat/config";
import addresses from "../../config/addresses";
import { FheTypes } from "@cofhe/sdk";
import { getCofheClient } from "../../utils/cofheClient";

task("aaveGetSuppliedBalance", "Get user's supplied (scaled) balance from the Aave adapter")
  .addOptionalParam("signeraddress", "Signer address")
  .addOptionalParam("diamondaddress", "Diamond contract address")
  .addOptionalParam("asset", "Underlying asset address (defaults to AAVE_USDC)")
  .addOptionalParam("address", "User address (defaults to signer)")
  .setAction(async ({ signeraddress, diamondaddress, asset, address }, hre) => {
    const { ethers, getChainId, deployments, getNamedAccounts } = hre;
    const chainId = await getChainId();
    const signerAddress = signeraddress || (await getNamedAccounts()).user;
    const signer = await ethers.getSigner(signerAddress);

    if (!diamondaddress) diamondaddress = (await deployments.get("Diamond")).address;
    if (!asset) asset = addresses[+chainId].AAVE_USDC;
    if (!address) address = signer.address;

    const adapter = await ethers.getContractAt("GetterFacet", diamondaddress, signer);
    const encryptedBalance = await adapter.getSuppliedBalance(address, asset);

    const client = await getCofheClient(hre, signer);
    const scaledBalance = await client.decryptForView(encryptedBalance, FheTypes.Uint64).withACP().execute();

    console.log("Scaled supplied balance:", scaledBalance.toString());
  });

task("aaveGetBorrowedBalance", "Get user's real (interest-accrued) borrowed balance from the Aave adapter")
  .addOptionalParam("signeraddress", "Signer address")
  .addOptionalParam("diamondaddress", "Diamond contract address")
  .addOptionalParam("asset", "Underlying asset address (defaults to AAVE_USDC)")
  .addOptionalParam("address", "User address (defaults to signer)")
  .setAction(async ({ signeraddress, diamondaddress, asset, address }, hre) => {
    const { ethers, getChainId, deployments, getNamedAccounts } = hre;
    const chainId = await getChainId();
    const signerAddress = signeraddress || (await getNamedAccounts()).user;
    const signer = await ethers.getSigner(signerAddress);

    if (!diamondaddress) diamondaddress = (await deployments.get("Diamond")).address;
    if (!asset) asset = addresses[+chainId].AAVE_USDC;
    if (!address) address = signer.address;

    const adapter = await ethers.getContractAt("GetterFacet", diamondaddress, signer);
    const encryptedBalance = await adapter.getBorrowedBalance.staticCall(address, asset);

    const client = await getCofheClient(hre, signer);
    const borrowedBalance = await client.decryptForView(encryptedBalance, FheTypes.Uint64).withACP().execute();

    console.log("Real borrowed balance:", borrowedBalance.toString());
  });

task("aaveGetMaxBorrowable", "Get user's max borrowable amount from the Aave adapter")
  .addOptionalParam("signeraddress", "Signer address")
  .addOptionalParam("diamondaddress", "Diamond contract address")
  .addOptionalParam("asset", "Underlying asset address (defaults to AAVE_USDC)")
  .addOptionalParam("address", "User address (defaults to signer)")
  .setAction(async ({ signeraddress, diamondaddress, asset, address }, hre) => {
    const { ethers, getChainId, deployments, getNamedAccounts } = hre;
    const chainId = await getChainId();
    const signerAddress = signeraddress || (await getNamedAccounts()).user;
    const signer = await ethers.getSigner(signerAddress);

    if (!diamondaddress) diamondaddress = (await deployments.get("Diamond")).address;
    if (!asset) asset = addresses[+chainId].AAVE_USDC;
    if (!address) address = signer.address;

    const adapter = await ethers.getContractAt("GetterFacet", diamondaddress, signer);
    const encryptedMax = await adapter.getMaxBorrowable(address, asset);

    const client = await getCofheClient(hre, signer);
    const maxBorrowable = await client.decryptForView(encryptedMax, FheTypes.Uint64).withACP().execute();

    console.log("Max borrowable amount:", maxBorrowable.toString());
  });

task("aaveGetScaledDebt", "Get user's scaled debt from the Aave adapter")
  .addOptionalParam("signeraddress", "Signer address")
  .addOptionalParam("diamondaddress", "Diamond contract address")
  .addOptionalParam("asset", "Underlying asset address (defaults to AAVE_USDC)")
  .addOptionalParam("address", "User address (defaults to signer)")
  .setAction(async ({ signeraddress, diamondaddress, asset, address }, hre) => {
    const { ethers, getChainId, deployments, getNamedAccounts } = hre;
    const chainId = await getChainId();
    const signerAddress = signeraddress || (await getNamedAccounts()).user;
    const signer = await ethers.getSigner(signerAddress);

    if (!diamondaddress) diamondaddress = (await deployments.get("Diamond")).address;
    if (!asset) asset = addresses[+chainId].AAVE_USDC;
    if (!address) address = signer.address;

    const adapter = await ethers.getContractAt("GetterFacet", diamondaddress, signer);
    const encryptedDebt = await adapter.getScaledDebt(address, asset);

    const client = await getCofheClient(hre, signer);
    const scaledDebt = await client.decryptForView(encryptedDebt, FheTypes.Uint64).withACP().execute();

    console.log("Scaled debt:", scaledDebt.toString());
  });
