import { expect } from "chai";
import hre from "hardhat";
import { Encryptable } from "@cofhe/sdk";
import addresses from "../../config/addresses";
import { resolveAddressChainId } from "../../utils";

describe("Aave adapter - Supply (Sepolia fork)", function () {
  this.timeout(180000);

  it("supplies AAVE_USDC through the confidential adapter and lands real funds in Aave", async function () {
    const { ethers, deployments } = hre;

    const TASK_MANAGER_ADDRESS = "0xeA30c4B8b44078Bbf8a6ef5b9f1eC1626C7848D9";

    await deployments.fixture(["AaveCTokens", "AaveAdapterDiamond"]);

    const chainId = await resolveAddressChainId(hre);
    const a = (addresses as any)[chainId];

    const [deployer, user] = await ethers.getSigners();

    const tm = await ethers.getContractAt(
      ["function setSecurityZones(int32 minSZ, int32 maxSZ) external"],
      TASK_MANAGER_ADDRESS,
      deployer,
    );
    await (await tm.setSecurityZones(0, 0)).wait();

    const usdc = await ethers.getContractAt(
      [
        "function owner() view returns (address)",
        "function mint(address,uint256) external returns (bool)",
        "function balanceOf(address) view returns (uint256)",
        "function approve(address,uint256) returns (bool)",
      ],
      a.AAVE_USDC,
    );

    const owner = await usdc.owner();
    await hre.network.provider.request({ method: "hardhat_impersonateAccount", params: [owner] });
    await hre.network.provider.request({ method: "hardhat_setBalance", params: [owner, "0x56BC75E2D63100000"] });
    const ownerSigner = await ethers.getSigner(owner);

    const supplyAmount = 1_000n * 10n ** 6n;
    await (await (usdc.connect(ownerSigner) as any).mint(user.address, supplyAmount)).wait();
    expect(await usdc.balanceOf(user.address)).to.equal(supplyAmount);
    console.log(`Funded user with ${supplyAmount} AAVE_USDC`);

    const eaUSDCDeployment = await deployments.get("EAaveUSDC");
    const diamondDeployment = await deployments.get("Diamond");
    const eaUSDC = await ethers.getContractAt("eERC20", eaUSDCDeployment.address, user);

    await (await (usdc.connect(user) as any).approve(eaUSDCDeployment.address, supplyAmount)).wait();
    await (await eaUSDC.wrap(user.address, supplyAmount)).wait();

    const farFuture = Math.floor(Date.now() / 1000) + 3600;
    await (await eaUSDC.setOperator(diamondDeployment.address, farFuture)).wait();
    console.log("Wrapped into confidential eaUSDC and approved the Diamond as operator");

    const client = await hre.cofhe.createClientWithBatteries(user);
    const [amountHash, proof] = await client
      .encryptInputs([Encryptable.uint64(supplyAmount.toString())])
      .setConsumingContract(diamondDeployment.address)
      .execute();

    const supplyFacet = await ethers.getContractAt("SupplyFacet", diamondDeployment.address, user);

    const requestReceipt = await (await supplyFacet.supplyRequest(a.AAVE_USDC, amountHash, 0, proof)).wait();
    const batchFormedEvent = requestReceipt!.logs
      .map((log: any) => {
        try {
          return supplyFacet.interface.parseLog(log);
        } catch {
          return null;
        }
      })
      .find((parsed: any) => parsed?.name === "SupplyBatchFormed");
    expect(batchFormedEvent, "SupplyBatchFormed not emitted - REQUEST_THRESHOLD not reached?").to.not.be.undefined;

    const batchId = batchFormedEvent!.args.batchId;
    const ctHash = batchFormedEvent!.args.ctHash;
    console.log(`Supply batch #${batchId} formed`);

    const { decryptedValue: batchTotal, signature: batchSig } = await client.decryptForTx(ctHash).withoutACP().execute();
    const unwrapReceipt = await (await supplyFacet.unwrapSupplyForFinalize(batchId, batchTotal, batchSig)).wait();
    const unwrappedEvent = unwrapReceipt!.logs
      .map((log: any) => {
        try {
          return supplyFacet.interface.parseLog(log);
        } catch {
          return null;
        }
      })
      .find((parsed: any) => parsed?.name === "SupplyUnwrapped");
    expect(unwrappedEvent, "SupplyUnwrapped not emitted").to.not.be.undefined;
    console.log(`Batch unwrapped: ${batchTotal}`);

    const unwrapCtHash = unwrappedEvent!.args.unwrapCtHash;
    const { decryptedValue: unwrappedAmount, signature: unwrapSig } = await client.decryptForTx(unwrapCtHash).withoutACP().execute();

    const pool = await ethers.getContractAt(
      [
        "function getReserveData(address) view returns (tuple(uint256,uint128,uint128,uint128,uint128,uint128,uint40,uint16,address,address,address,address,uint128,uint128,uint128))",
      ],
      a.AAVE_POOL,
    );
    const aTokenAddr = (await pool.getReserveData(a.AAVE_USDC))[8];
    const aToken = await ethers.getContractAt(["function balanceOf(address) view returns (uint256)"], aTokenAddr);
    const diamondATokenBefore = await aToken.balanceOf(diamondDeployment.address);

    const finalizeReceipt = await (await supplyFacet.finalizeSupplyRequests(batchId, unwrappedAmount, unwrapSig)).wait();
    const finalizedEvent = finalizeReceipt!.logs
      .map((log: any) => {
        try {
          return supplyFacet.interface.parseLog(log);
        } catch {
          return null;
        }
      })
      .find((parsed: any) => parsed?.name === "FinalizeSupplyRequest");
    expect(finalizedEvent, "FinalizeSupplyRequest not emitted").to.not.be.undefined;

    const diamondATokenAfter = await aToken.balanceOf(diamondDeployment.address);
    expect(diamondATokenAfter).to.be.greaterThan(diamondATokenBefore);
    console.log(`Supplied to Aave: Diamond's aUSDC balance ${diamondATokenBefore} -> ${diamondATokenAfter}`);

    const multiplier = finalizedEvent!.args.multiplier as bigint;
    const expectedScaledBalance = (supplyAmount * multiplier) / 1_000_000n;

    const getterFacet = await ethers.getContractAt("GetterFacet", diamondDeployment.address, user);
    const scaledBalanceHandle = await getterFacet.getSuppliedBalance(user.address, a.AAVE_USDC);
    const scaledBalanceCtHash = BigInt(scaledBalanceHandle as unknown as string);

    await hre.cofhe.mocks.expectPlaintext(scaledBalanceCtHash, expectedScaledBalance);
    console.log(`User's encrypted scaledBalances[AAVE_USDC] verified: ${expectedScaledBalance}`);
  });
});
