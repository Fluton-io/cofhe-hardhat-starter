import { expect } from "chai";
import hre from "hardhat";
import { Encryptable } from "@cofhe/sdk";
import addresses from "../../config/addresses";
import { resolveAddressChainId } from "../../utils";

const TASK_MANAGER_ADDRESS = "0xeA30c4B8b44078Bbf8a6ef5b9f1eC1626C7848D9";

// Aave V3 DataTypes.InterestRateMode: NONE = 0, STABLE = 1, VARIABLE = 2
export const VARIABLE_RATE_MODE = 2;

export type Fixture = {
  a: { [key: string]: string };
  deployer: any;
  user: any;
  other: any;
  diamondAddress: string;
};

/**
 * Deploys the adapter fixture (reused via hardhat-deploy's snapshot cache
 * across `it()` blocks) and opens the mock TaskManager's security zone.
 */
export async function deployAdapterFixture(): Promise<Fixture> {
  const { ethers, deployments } = hre;

  await deployments.fixture(["AaveCTokens", "AaveAdapterDiamond"]);

  const chainId = await resolveAddressChainId(hre);
  const a = (addresses as any)[chainId];

  const [deployer, user, other] = await ethers.getSigners();

  const tm = await ethers.getContractAt(
    ["function setSecurityZones(int32 minSZ, int32 maxSZ) external"],
    TASK_MANAGER_ADDRESS,
    deployer,
  );
  await (await tm.setSecurityZones(0, 0)).wait();

  const diamondDeployment = await deployments.get("Diamond");

  return { a, deployer, user, other, diamondAddress: diamondDeployment.address };
}

/** Impersonates the underlying ERC20's owner and mints `amount` to `to`. */
export async function mintUnderlying(assetAddress: string, to: string, amount: bigint) {
  const { ethers } = hre;
  const token = await ethers.getContractAt(
    ["function owner() view returns (address)", "function mint(address,uint256) external returns (bool)"],
    assetAddress,
  );
  const owner = await token.owner();
  await hre.network.provider.request({ method: "hardhat_impersonateAccount", params: [owner] });
  await hre.network.provider.request({ method: "hardhat_setBalance", params: [owner, "0x56BC75E2D63100000"] });
  const ownerSigner = await ethers.getSigner(owner);
  await (await (token.connect(ownerSigner) as any).mint(to, amount)).wait();
}

export async function underlyingBalanceOf(assetAddress: string, account: string): Promise<bigint> {
  const token = await hre.ethers.getContractAt(["function balanceOf(address) view returns (uint256)"], assetAddress);
  return token.balanceOf(account);
}

/** Mints underlying to `signer`, wraps it into the confidential cToken, and sets the diamond as operator. */
export async function mintAndWrap(signer: any, assetAddress: string, cTokenAddress: string, amount: bigint, operator: string) {
  const { ethers } = hre;
  await mintUnderlying(assetAddress, signer.address, amount);

  const underlying = await ethers.getContractAt(
    ["function approve(address,uint256) returns (bool)"],
    assetAddress,
    signer,
  );
  await (await underlying.approve(cTokenAddress, amount)).wait();

  const cToken = await ethers.getContractAt("eERC20", cTokenAddress, signer);
  await (await cToken.wrap(signer.address, amount)).wait();

  const farFuture = Math.floor(Date.now() / 1000) + 3600;
  await (await cToken.setOperator(operator, farFuture)).wait();

  return cToken;
}

/**
 * Some assets on the forked Aave testnet market have zero supplied liquidity,
 * which makes `pool.borrow` revert with an internal arithmetic panic. Mint the
 * underlying to `depositor` and supply it directly to Aave (bypassing the
 * confidential adapter) so there is real liquidity available to borrow against.
 */
export async function seedAaveLiquidity(depositor: any, assetAddress: string, poolAddress: string, amount: bigint) {
  const { ethers } = hre;
  await mintUnderlying(assetAddress, depositor.address, amount);

  const underlying = await ethers.getContractAt(
    ["function approve(address,uint256) returns (bool)"],
    assetAddress,
    depositor,
  );
  await (await underlying.approve(poolAddress, amount)).wait();

  const pool = await ethers.getContractAt(
    ["function supply(address asset, uint256 amount, address onBehalfOf, uint16 referralCode) external"],
    poolAddress,
    depositor,
  );
  await (await pool.supply(assetAddress, amount, depositor.address, 0)).wait();
}

export async function createClient(signer: any) {
  return hre.cofhe.createClientWithBatteries(signer);
}

export async function encryptAmount(client: any, diamondAddress: string, amount: bigint) {
  const [handle, proof] = await client
    .encryptInputs([Encryptable.uint64(amount.toString())])
    .setConsumingContract(diamondAddress)
    .execute();
  return { handle, proof };
}

export function findEvent(receipt: any, iface: any, name: string) {
  return receipt!.logs
    .map((log: any) => {
      try {
        return iface.parseLog(log);
      } catch {
        return null;
      }
    })
    .find((parsed: any) => parsed?.name === name);
}

/** Runs a full supply request -> unwrap -> finalize cycle. Assumes REQUEST_THRESHOLD requests worth of `amount` form a batch immediately. */
export async function supplyFlow(opts: {
  user: any;
  diamondAddress: string;
  assetAddress: string;
  amount: bigint;
  referralCode?: number;
}) {
  const { ethers } = hre;
  const client = await createClient(opts.user);
  const { handle, proof } = await encryptAmount(client, opts.diamondAddress, opts.amount);

  const supplyFacet = await ethers.getContractAt("SupplyFacet", opts.diamondAddress, opts.user);
  const requestReceipt = await (
    await supplyFacet.supplyRequest(opts.assetAddress, handle, opts.referralCode ?? 0, proof)
  ).wait();

  const batchFormed = findEvent(requestReceipt, supplyFacet.interface, "SupplyBatchFormed");
  if (!batchFormed) throw new Error("SupplyBatchFormed not emitted - REQUEST_THRESHOLD not reached?");

  const batchId = batchFormed.args.batchId;
  const ctHash = batchFormed.args.ctHash;

  const { decryptedValue: batchTotal, signature: batchSig } = await client.decryptForTx(ctHash).withoutACP().execute();
  const unwrapReceipt = await (await supplyFacet.unwrapSupplyForFinalize(batchId, batchTotal, batchSig)).wait();
  const unwrapped = findEvent(unwrapReceipt, supplyFacet.interface, "SupplyUnwrapped");
  expect(unwrapped, "SupplyUnwrapped not emitted").to.not.be.undefined;

  const { decryptedValue: unwrappedAmount, signature: unwrapSig } = await client
    .decryptForTx(unwrapped!.args.unwrapCtHash)
    .withoutACP()
    .execute();

  const finalizeReceipt = await (
    await supplyFacet.finalizeSupplyRequests(batchId, unwrappedAmount, unwrapSig)
  ).wait();
  const finalized = findEvent(finalizeReceipt, supplyFacet.interface, "FinalizeSupplyRequest");
  expect(finalized, "FinalizeSupplyRequest not emitted").to.not.be.undefined;

  return {
    batchFormed,
    batchId,
    batchTotal,
    unwrapped,
    finalized,
    multiplier: finalized!.args.multiplier as bigint,
    finalizeReceipt,
  };
}

/** Runs a full withdraw request -> finalize cycle (no unwrap step). */
export async function withdrawFlow(opts: { user: any; diamondAddress: string; assetAddress: string; amount: bigint }) {
  const { ethers } = hre;
  const client = await createClient(opts.user);
  const { handle, proof } = await encryptAmount(client, opts.diamondAddress, opts.amount);

  const withdrawFacet = await ethers.getContractAt("WithdrawFacet", opts.diamondAddress, opts.user);
  const requestReceipt = await (await withdrawFacet.withdrawRequest(opts.assetAddress, handle, proof)).wait();

  const requested = findEvent(requestReceipt, withdrawFacet.interface, "WithdrawRequested");
  const batchFormed = findEvent(requestReceipt, withdrawFacet.interface, "WithdrawBatchFormed");
  if (!batchFormed) throw new Error("WithdrawBatchFormed not emitted - REQUEST_THRESHOLD not reached?");

  const batchId = batchFormed.args.batchId;
  const ctHash = batchFormed.args.ctHash;
  const { decryptedValue: batchTotal, signature } = await client.decryptForTx(ctHash).withoutACP().execute();

  const finalizeReceipt = await (await withdrawFacet.finalizeWithdrawRequests(batchId, batchTotal, signature)).wait();
  const finalized = findEvent(finalizeReceipt, withdrawFacet.interface, "FinalizeWithdrawRequest");

  return { requested, batchFormed, batchId, batchTotal, finalized, finalizeReceipt };
}

/** Runs a full borrow request -> finalize cycle (no unwrap step). */
export async function borrowFlow(opts: {
  user: any;
  diamondAddress: string;
  assetAddress: string;
  amount: bigint;
  interestRateMode?: number;
  referralCode?: number;
}) {
  const { ethers } = hre;
  const client = await createClient(opts.user);
  const { handle, proof } = await encryptAmount(client, opts.diamondAddress, opts.amount);

  const borrowFacet = await ethers.getContractAt("BorrowFacet", opts.diamondAddress, opts.user);
  const requestReceipt = await (
    await borrowFacet.borrowRequest(
      opts.assetAddress,
      handle,
      opts.interestRateMode ?? VARIABLE_RATE_MODE,
      opts.referralCode ?? 0,
      proof,
    )
  ).wait();

  const requested = findEvent(requestReceipt, borrowFacet.interface, "BorrowRequested");
  const batchFormed = findEvent(requestReceipt, borrowFacet.interface, "BorrowBatchFormed");
  if (!batchFormed) throw new Error("BorrowBatchFormed not emitted - REQUEST_THRESHOLD not reached?");

  const batchId = batchFormed.args.batchId;
  const ctHash = batchFormed.args.ctHash;
  const { decryptedValue: batchTotal, signature } = await client.decryptForTx(ctHash).withoutACP().execute();

  const finalizeReceipt = await (await borrowFacet.finalizeBorrowRequests(batchId, batchTotal, signature)).wait();
  const finalized = findEvent(finalizeReceipt, borrowFacet.interface, "FinalizeBorrowRequest");

  return { requested, batchFormed, batchId, batchTotal, finalized, finalizeReceipt };
}

/** Runs a full repay request -> unwrap -> finalize cycle. */
export async function repayFlow(opts: {
  user: any;
  diamondAddress: string;
  assetAddress: string;
  amount: bigint;
  interestRateMode?: number;
}) {
  const { ethers } = hre;
  const client = await createClient(opts.user);
  const { handle, proof } = await encryptAmount(client, opts.diamondAddress, opts.amount);

  const repayFacet = await ethers.getContractAt("RepayFacet", opts.diamondAddress, opts.user);
  const requestReceipt = await (
    await repayFacet.repayRequest(opts.assetAddress, handle, opts.interestRateMode ?? VARIABLE_RATE_MODE, proof)
  ).wait();

  const requested = findEvent(requestReceipt, repayFacet.interface, "RepayRequested");
  const batchFormed = findEvent(requestReceipt, repayFacet.interface, "RepayBatchFormed");
  if (!batchFormed) throw new Error("RepayBatchFormed not emitted - REQUEST_THRESHOLD not reached?");

  const batchId = batchFormed.args.batchId;
  const ctHash = batchFormed.args.ctHash;
  const { decryptedValue: batchTotal, signature: batchSig } = await client.decryptForTx(ctHash).withoutACP().execute();
  const unwrapReceipt = await (await repayFacet.unwrapRepayForFinalize(batchId, batchTotal, batchSig)).wait();
  const unwrapped = findEvent(unwrapReceipt, repayFacet.interface, "RepayUnwrapped");
  expect(unwrapped, "RepayUnwrapped not emitted").to.not.be.undefined;

  const { decryptedValue: unwrappedAmount, signature: unwrapSig } = await client
    .decryptForTx(unwrapped!.args.unwrapCtHash)
    .withoutACP()
    .execute();

  const finalizeReceipt = await (await repayFacet.finalizeRepayRequests(batchId, unwrappedAmount, unwrapSig)).wait();
  const finalized = findEvent(finalizeReceipt, repayFacet.interface, "FinalizeRepayRequest");

  return { requested, batchFormed, batchId, unwrapped, finalized, finalizeReceipt };
}
