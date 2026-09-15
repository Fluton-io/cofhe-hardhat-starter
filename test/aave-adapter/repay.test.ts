import { expect } from "chai";
import hre from "hardhat";
import {
  borrowFlow,
  deployAdapterFixture,
  mintAndWrap,
  repayFlow,
  seedAaveLiquidity,
  supplyFlow,
} from "./helpers";

describe("Aave adapter - Repay (Sepolia fork)", function (this: Mocha.Suite) {
  this.timeout(420000);

  it("borrows USDT then repays the received principal via the confidential adapter", async function () {
    const { ethers, deployments } = hre;
    const { a, deployer, user, diamondAddress } = await deployAdapterFixture();

    const eaUSDCDeployment = await deployments.get("EAaveUSDC");
    const eaUSDTDeployment = await deployments.get("EAaveUSDT");

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
    if (supplyMultiplier === undefined) {
      throw new Error("Supply multiplier was not returned");
    }
    const suppliedScaledBalance =
      (supplyAmount * supplyMultiplier) / 1_000_000n;

    const dataProvider = await ethers.getContractAt(
      [
        "function getReserveConfigurationData(address) view returns (uint256,uint256 ltv,uint256,uint256,uint256,bool,bool,bool,bool,bool)",
      ],
      a.AAVE_DATA_PROVIDER,
    );
    const getterFacet = await ethers.getContractAt(
      "GetterFacet",
      diamondAddress,
      user,
    );
    const usdtLtv = (
      (await dataProvider.getReserveConfigurationData(a.AAVE_USDT)) as any
    )[1] as bigint;
    const borrowAmount = (suppliedScaledBalance * usdtLtv) / 10000n / 2n;

    await borrowFlow({
      user,
      diamondAddress,
      assetAddress: a.AAVE_USDT,
      amount: borrowAmount,
    });

    const scaledDebtBeforeRepayHandle = await getterFacet.getScaledDebt(
      user.address,
      a.AAVE_USDT,
    );
    const scaledDebtBeforeRepay = await hre.cofhe.mocks.getPlaintext(
      BigInt(scaledDebtBeforeRepayHandle as unknown as string),
    );

    // eaUSDT was minted 1:1 to the user by the borrow - set the diamond as operator
    // so the repay flow's confidentialTransferFrom can pull it back.
    const eaUSDT = await ethers.getContractAt(
      "eERC20",
      eaUSDTDeployment.address,
      user,
    );
    const farFuture = Math.floor(Date.now() / 1000) + 3600;
    await (await eaUSDT.setOperator(diamondAddress, farFuture)).wait();

    expect(
      scaledDebtBeforeRepay,
      "expected a nonzero scaled debt after borrowing",
    ).to.be.gt(0n);

    // Repay exactly the principal the user received (accrued interest since the
    // borrow means the *real* debt is now slightly higher than this, but the
    // user only ever holds the principal in confidential eaUSDT, so this is the
    // largest amount that won't get short-changed by the balance clamp inside
    // FHERC20's confidentialTransferFrom).
    const { finalized } = await repayFlow({
      user,
      diamondAddress,
      assetAddress: a.AAVE_USDT,
      amount: borrowAmount,
    });
    expect(finalized, "FinalizeRepayRequest not emitted").to.not.be.undefined;

    // The exact post-repay scaledDebt depends on how much interest accrued
    // between borrow and repay (LibRepayRequest's multiplier is derived from
    // Aave's own before/after scaled debt at finalize time), so rather than
    // re-deriving that by hand, just assert the debt meaningfully decreased.
    const scaledDebtHandle = await getterFacet.getScaledDebt(
      user.address,
      a.AAVE_USDT,
    );
    const scaledDebtAfterRepay = await hre.cofhe.mocks.getPlaintext(
      BigInt(scaledDebtHandle as unknown as string),
    );
    expect(
      scaledDebtAfterRepay,
      "repay should have reduced the user's encrypted scaledDebts",
    ).to.be.lt(scaledDebtBeforeRepay);
    console.log(
      `User's encrypted scaledDebts[AAVE_USDT] verified: ${scaledDebtBeforeRepay} -> ${scaledDebtAfterRepay}`,
    );

    await hre.cofhe.mocks.expectPlaintext(
      BigInt(
        (await eaUSDT.confidentialBalanceOf(user.address)) as unknown as string,
      ),
      0n,
    );
    console.log(
      "User's confidential eaUSDT balance verified back to 0 after repay",
    );
  });
});
