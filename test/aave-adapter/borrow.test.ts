import { expect } from "chai";
import hre from "hardhat";
import {
  borrowFlow,
  createClient,
  deployAdapterFixture,
  encryptAmount,
  findEvent,
  mintAndWrap,
  seedAaveLiquidity,
  supplyFlow,
} from "./helpers";

describe("Aave adapter - Borrow (Sepolia fork)", function () {
  this.timeout(180000);

  it("supplies USDC as collateral, then borrows USDT against it", async function () {
    const { ethers, deployments } = hre;
    const { a, deployer, user, diamondAddress } = await deployAdapterFixture();

    const eaUSDCDeployment = await deployments.get("EAaveUSDC");
    const eaUSDTDeployment = await deployments.get("EAaveUSDT");

    // The forked testnet Aave market has ~0 USDT liquidity supplied - seed some
    // directly (outside the confidential adapter) so there is something to borrow.
    await seedAaveLiquidity(
      deployer,
      a.AAVE_USDT,
      a.AAVE_POOL,
      1_000_000n * 10n ** 6n,
    );

    const supplyAmount = 1_000n * 10n ** 6n;
    await mintAndWrap(
      user,
      a.AAVE_USDC,
      eaUSDCDeployment.address,
      supplyAmount,
      diamondAddress,
    );
    const { multiplier: supplyMultiplier } = await supplyFlow({
      user,
      diamondAddress,
      assetAddress: a.AAVE_USDC,
      amount: supplyAmount,
    });
    const suppliedScaledBalance =
      (supplyAmount * supplyMultiplier) / 1_000_000n;

    // setMaxBorrowables derives maxBorrowable[asset] = updatedCollateralBalance * ltv[asset] / 10000
    // for every registered Aave asset - replicate that here to know the expected borrow ceiling.
    const dataProvider = await ethers.getContractAt(
      [
        "function getReserveConfigurationData(address) view returns (uint256,uint256 ltv,uint256,uint256,uint256,bool,bool,bool,bool,bool)",
      ],
      a.AAVE_DATA_PROVIDER,
    );
    const usdtConfig = await dataProvider.getReserveConfigurationData(
      a.AAVE_USDT,
    );
    const usdtLtv = usdtConfig[1] as bigint;
    const expectedMaxBorrowable = (suppliedScaledBalance * usdtLtv) / 10000n;

    const getterFacet = await ethers.getContractAt(
      "GetterFacet",
      diamondAddress,
      user,
    );
    const maxBorrowableHandle = await getterFacet.getMaxBorrowable(
      user.address,
      a.AAVE_USDT,
    );
    await hre.cofhe.mocks.expectPlaintext(
      BigInt(maxBorrowableHandle as unknown as string),
      expectedMaxBorrowable,
    );
    console.log(
      `Max borrowable USDT after supplying collateral verified: ${expectedMaxBorrowable}`,
    );
    expect(
      expectedMaxBorrowable > 0n,
      "expected a nonzero max borrowable amount",
    ).to.be.true;

    // FinalizeBorrowRequest doesn't emit the debt-token multiplier (unlike supply's
    // FinalizeSupplyRequest), so derive it independently from the variable debt
    // token's scaledBalanceOf(diamond) before/after, mirroring LibBorrowRequest's math.
    const pool = await ethers.getContractAt(
      [
        "function getReserveData(address) view returns (tuple(uint256,uint128,uint128,uint128,uint128,uint128,uint40,uint16,address,address,address,address,uint128,uint128,uint128))",
      ],
      a.AAVE_POOL,
    );
    const debtTokenAddr = (await pool.getReserveData(a.AAVE_USDT))[10];
    const debtToken = await ethers.getContractAt(
      ["function scaledBalanceOf(address) view returns (uint256)"],
      debtTokenAddr,
    );
    const debtBefore = (await debtToken.scaledBalanceOf(
      diamondAddress,
    )) as bigint;

    const borrowAmount = expectedMaxBorrowable / 2n;
    const { finalized } = await borrowFlow({
      user,
      diamondAddress,
      assetAddress: a.AAVE_USDT,
      amount: borrowAmount,
    });
    expect(finalized, "FinalizeBorrowRequest not emitted").to.not.be.undefined;

    const debtAfter = (await debtToken.scaledBalanceOf(
      diamondAddress,
    )) as bigint;
    const borrowMultiplier =
      (debtAfter - debtBefore) / (borrowAmount / 1_000_000n);
    const expectedScaledDebt = (borrowAmount * borrowMultiplier) / 1_000_000n;

    const eaUSDT = await ethers.getContractAt(
      "eERC20",
      eaUSDTDeployment.address,
      user,
    );
    await hre.cofhe.mocks.expectPlaintext(
      BigInt(
        (await eaUSDT.confidentialBalanceOf(user.address)) as unknown as string,
      ),
      borrowAmount,
    );
    console.log(
      `User received ${borrowAmount} confidential eaUSDT from the borrow`,
    );

    const scaledDebtHandle = await getterFacet.getScaledDebt(
      user.address,
      a.AAVE_USDT,
    );
    await hre.cofhe.mocks.expectPlaintext(
      BigInt(scaledDebtHandle as unknown as string),
      expectedScaledDebt,
    );
    console.log(
      `User's encrypted scaledDebts[AAVE_USDT] verified: ${expectedScaledDebt}`,
    );
  });

  it("clamps a borrow request exceeding the user's max borrowable amount down to zero and reverts on finalize", async function () {
    const { ethers, deployments } = hre;
    const { a, user, diamondAddress } = await deployAdapterFixture();

    const eaUSDCDeployment = await deployments.get("EAaveUSDC");
    const supplyAmount = 1_000n * 10n ** 6n;
    await mintAndWrap(
      user,
      a.AAVE_USDC,
      eaUSDCDeployment.address,
      supplyAmount,
      diamondAddress,
    );
    await supplyFlow({
      user,
      diamondAddress,
      assetAddress: a.AAVE_USDC,
      amount: supplyAmount,
    });

    // Ask for way more than any plausible LTV-derived max borrowable amount.
    const excessiveAmount = supplyAmount * 1000n;

    const client = await createClient(user);
    const { handle, proof } = await encryptAmount(
      client,
      diamondAddress,
      excessiveAmount,
    );
    const borrowFacet = await ethers.getContractAt(
      "BorrowFacet",
      diamondAddress,
      user,
    );
    const requestReceipt = await (
      await borrowFacet.borrowRequest(a.AAVE_USDT, handle, 2, 0, proof)
    ).wait();

    const batchFormed = findEvent(
      requestReceipt,
      borrowFacet.interface,
      "BorrowBatchFormed",
    );
    expect(batchFormed, "BorrowBatchFormed not emitted").to.not.be.undefined;

    const { decryptedValue: batchTotal, signature } = await client
      .decryptForTx(batchFormed!.args.ctHash)
      .withoutACP()
      .execute();
    expect(
      batchTotal,
      "clamped borrow batch total should decrypt to 0",
    ).to.equal(0n);

    await expect(
      borrowFacet.finalizeBorrowRequests(
        batchFormed!.args.batchId,
        batchTotal,
        signature,
      ),
    ).to.be.reverted;
  }).timeout(180000);
});
