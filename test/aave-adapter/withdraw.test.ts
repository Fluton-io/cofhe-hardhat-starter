import { expect } from "chai";
import hre from "hardhat";
import { createClient, deployAdapterFixture, encryptAmount, findEvent, mintAndWrap, supplyFlow, withdrawFlow } from "./helpers";

describe("Aave adapter - Withdraw (Sepolia fork)", function () {
  this.timeout(180000);

  it("withdraws a partial amount, returning cUSDC to the user and reducing the encrypted scaled balance", async function () {
    const { ethers, deployments } = hre;
    const { a, user, diamondAddress } = await deployAdapterFixture();

    const eaUSDCDeployment = await deployments.get("EAaveUSDC");
    const supplyAmount = 1_000n * 10n ** 6n;
    await mintAndWrap(user, a.AAVE_USDC, eaUSDCDeployment.address, supplyAmount, diamondAddress);

    const { multiplier } = await supplyFlow({
      user,
      diamondAddress,
      assetAddress: a.AAVE_USDC,
      amount: supplyAmount,
    });
    const suppliedScaledBalance = (supplyAmount * multiplier) / 1_000_000n;

    const eaUSDC = await ethers.getContractAt("eERC20", eaUSDCDeployment.address, user);
    // The whole minted amount was transferred to the diamond as collateral during supply,
    // so the user's confidential eaUSDC balance should be back to 0 before withdrawing.
    await hre.cofhe.mocks.expectPlaintext(
      BigInt((await eaUSDC.confidentialBalanceOf(user.address)) as unknown as string),
      0n,
    );

    const withdrawAmount = suppliedScaledBalance / 2n;
    const { finalized } = await withdrawFlow({
      user,
      diamondAddress,
      assetAddress: a.AAVE_USDC,
      amount: withdrawAmount,
    });
    expect(finalized, "FinalizeWithdrawRequest not emitted").to.not.be.undefined;

    const cBalanceAfterHandle = await eaUSDC.confidentialBalanceOf(user.address);
    await hre.cofhe.mocks.expectPlaintext(BigInt(cBalanceAfterHandle as unknown as string), withdrawAmount);
    console.log(`User's confidential eaUSDC balance verified: ${withdrawAmount}`);

    const getterFacet = await ethers.getContractAt("GetterFacet", diamondAddress, user);
    const scaledBalanceHandle = await getterFacet.getSuppliedBalance(user.address, a.AAVE_USDC);
    const expectedRemaining = suppliedScaledBalance - withdrawAmount;
    await hre.cofhe.mocks.expectPlaintext(BigInt(scaledBalanceHandle as unknown as string), expectedRemaining);
    console.log(`Remaining encrypted scaledBalances[AAVE_USDC] verified: ${expectedRemaining}`);
  });

  it("clamps a withdrawal that exceeds the available scaled balance down to zero and reverts on finalize", async function () {
    const { ethers, deployments } = hre;
    const { a, user, diamondAddress } = await deployAdapterFixture();

    const eaUSDCDeployment = await deployments.get("EAaveUSDC");
    const supplyAmount = 1_000n * 10n ** 6n;
    await mintAndWrap(user, a.AAVE_USDC, eaUSDCDeployment.address, supplyAmount, diamondAddress);

    const { multiplier } = await supplyFlow({
      user,
      diamondAddress,
      assetAddress: a.AAVE_USDC,
      amount: supplyAmount,
    });
    const suppliedScaledBalance = (supplyAmount * multiplier) / 1_000_000n;

    // Request far more than the user actually has supplied - LibWithdrawRequest
    // should clamp `safeAmount` to 0 rather than allow an over-withdrawal.
    const overdrawnAmount = suppliedScaledBalance * 10n;

    const client = await createClient(user);
    const { handle, proof } = await encryptAmount(client, diamondAddress, overdrawnAmount);
    const withdrawFacet = await ethers.getContractAt("WithdrawFacet", diamondAddress, user);
    const requestReceipt = await (await withdrawFacet.withdrawRequest(a.AAVE_USDC, handle, proof)).wait();

    const batchFormed = findEvent(requestReceipt, withdrawFacet.interface, "WithdrawBatchFormed");
    expect(batchFormed, "WithdrawBatchFormed not emitted").to.not.be.undefined;

    const { decryptedValue: batchTotal, signature } = await client
      .decryptForTx(batchFormed!.args.ctHash)
      .withoutACP()
      .execute();
    expect(batchTotal, "clamped withdraw batch total should decrypt to 0").to.equal(0n);

    // The clamped batch total is 0, so finalize must revert with AmountIsZero.
    await expect(withdrawFacet.finalizeWithdrawRequests(batchFormed!.args.batchId, batchTotal, signature)).to.be
      .reverted;
  }).timeout(180000);
});
