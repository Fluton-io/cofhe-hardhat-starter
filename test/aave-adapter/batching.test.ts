import { expect } from "chai";
import hre from "hardhat";
import { createClient, deployAdapterFixture, encryptAmount, findEvent, mintAndWrap } from "./helpers";

/**
 * Exercises LibSupplyRequest's request-matching / batch-forming logic directly
 * (REQUEST_THRESHOLD raised above 1), instead of the single-request-per-batch
 * shortcut the other lifecycle tests rely on. Covers:
 *  - a request sitting unmatched until enough same-asset requests arrive
 *  - matching being scoped to the requested asset (an unrelated asset's pending
 *    request must not be swept into someone else's batch)
 *  - the swap-and-pop removal in `_tryFormBatch` leaving a surviving pending
 *    request intact for a later batch
 */
describe("Aave adapter - multi-request batching (Sepolia fork)", function () {
  this.timeout(300000);

  it("only forms a batch once REQUEST_THRESHOLD matching-asset requests arrive, and preserves unrelated pending requests", async function () {
    const { ethers, deployments } = hre;
    const { a, deployer, user, other, diamondAddress } = await deployAdapterFixture();

    const adminFacet = await ethers.getContractAt("AdminFacet", diamondAddress, deployer);
    await (await adminFacet.setRequestThreshold(2)).wait();

    const eaUSDCDeployment = await deployments.get("EAaveUSDC");
    const eaUSDTDeployment = await deployments.get("EAaveUSDT");
    const supplyFacetAsUser = await ethers.getContractAt("SupplyFacet", diamondAddress, user);
    const supplyFacetAsOther = await ethers.getContractAt("SupplyFacet", diamondAddress, other);
    const userClient = await createClient(user);
    const otherClient = await createClient(other);

    // 1) other supplies USDT first - alone, shouldn't form a batch (threshold=2).
    const usdtAmount1 = 300n * 10n ** 6n;
    await mintAndWrap(other, a.AAVE_USDT, eaUSDTDeployment.address, usdtAmount1, diamondAddress);
    {
      const { handle, proof } = await encryptAmount(otherClient, diamondAddress, usdtAmount1);
      const receipt = await (await supplyFacetAsOther.supplyRequest(a.AAVE_USDT, handle, 0, proof)).wait();
      expect(findEvent(receipt, supplyFacetAsOther.interface, "SupplyBatchFormed"), "USDT batch should not form yet")
        .to.be.undefined;
    }

    // 2) user supplies USDC - a different asset, also shouldn't form a batch yet,
    // and must not accidentally match against other's pending USDT request.
    const usdcAmount1 = 500n * 10n ** 6n;
    await mintAndWrap(user, a.AAVE_USDC, eaUSDCDeployment.address, usdcAmount1, diamondAddress);
    {
      const { handle, proof } = await encryptAmount(userClient, diamondAddress, usdcAmount1);
      const receipt = await (await supplyFacetAsUser.supplyRequest(a.AAVE_USDC, handle, 0, proof)).wait();
      expect(findEvent(receipt, supplyFacetAsUser.interface, "SupplyBatchFormed"), "USDC batch should not form yet")
        .to.be.undefined;
    }

    // 3) other supplies USDC too - this is the 2nd USDC request, so it should
    // form a batch of exactly the two USDC requests (not touching the pending USDT one).
    const usdcAmount2 = 300n * 10n ** 6n;
    await mintAndWrap(other, a.AAVE_USDC, eaUSDCDeployment.address, usdcAmount2, diamondAddress);
    const { handle: usdcHandle2, proof: usdcProof2 } = await encryptAmount(otherClient, diamondAddress, usdcAmount2);
    const usdcRequestReceipt = await (await supplyFacetAsOther.supplyRequest(a.AAVE_USDC, usdcHandle2, 0, usdcProof2)).wait();
    const usdcBatchFormed = findEvent(usdcRequestReceipt, supplyFacetAsOther.interface, "SupplyBatchFormed");
    expect(usdcBatchFormed, "USDC batch should form on the 2nd matching request").to.not.be.undefined;
    expect(usdcBatchFormed!.args.reserve).to.equal(a.AAVE_USDC);
    expect(usdcBatchFormed!.args.requestCount).to.equal(2n);

    const { decryptedValue: usdcBatchTotal, signature: usdcBatchSig } = await otherClient
      .decryptForTx(usdcBatchFormed!.args.ctHash)
      .withoutACP()
      .execute();
    expect(usdcBatchTotal, "USDC batch total should be the sum of both USDC requests").to.equal(usdcAmount1 + usdcAmount2);

    // Finalize the USDC batch (unwrap -> finalize) and confirm both suppliers got credited.
    const unwrapReceipt = await (
      await supplyFacetAsOther.unwrapSupplyForFinalize(usdcBatchFormed!.args.batchId, usdcBatchTotal, usdcBatchSig)
    ).wait();
    const unwrapped = findEvent(unwrapReceipt, supplyFacetAsOther.interface, "SupplyUnwrapped");
    expect(unwrapped, "SupplyUnwrapped not emitted").to.not.be.undefined;
    const { decryptedValue: unwrappedAmount, signature: unwrapSig } = await otherClient
      .decryptForTx(unwrapped!.args.unwrapCtHash)
      .withoutACP()
      .execute();
    const finalizeReceipt = await (
      await supplyFacetAsOther.finalizeSupplyRequests(usdcBatchFormed!.args.batchId, unwrappedAmount, unwrapSig)
    ).wait();
    const finalized = findEvent(finalizeReceipt, supplyFacetAsOther.interface, "FinalizeSupplyRequest");
    expect(finalized, "FinalizeSupplyRequest not emitted").to.not.be.undefined;

    const multiplier = finalized!.args.multiplier as bigint;
    const getterFacet = await ethers.getContractAt("GetterFacet", diamondAddress, user);
    await hre.cofhe.mocks.expectPlaintext(
      BigInt((await getterFacet.getSuppliedBalance(user.address, a.AAVE_USDC)) as unknown as string),
      (usdcAmount1 * multiplier) / 1_000_000n,
    );
    await hre.cofhe.mocks.expectPlaintext(
      BigInt((await getterFacet.getSuppliedBalance(other.address, a.AAVE_USDC)) as unknown as string),
      (usdcAmount2 * multiplier) / 1_000_000n,
    );
    console.log("Both USDC suppliers credited proportionally to their own request amount");

    // 4) The pending USDT request from step 1 must have survived the swap-and-pop
    // removal of the two USDC entries. A second USDT request should now form
    // *its own* batch containing exactly the original request plus this new one.
    const usdtAmount2 = 150n * 10n ** 6n;
    await mintAndWrap(user, a.AAVE_USDT, eaUSDTDeployment.address, usdtAmount2, diamondAddress);
    const { handle: usdtHandle2, proof: usdtProof2 } = await encryptAmount(userClient, diamondAddress, usdtAmount2);
    const usdtRequestReceipt = await (await supplyFacetAsUser.supplyRequest(a.AAVE_USDT, usdtHandle2, 0, usdtProof2)).wait();
    const usdtBatchFormed = findEvent(usdtRequestReceipt, supplyFacetAsUser.interface, "SupplyBatchFormed");
    expect(usdtBatchFormed, "USDT batch should form once its 2nd request arrives").to.not.be.undefined;
    expect(usdtBatchFormed!.args.reserve).to.equal(a.AAVE_USDT);
    expect(usdtBatchFormed!.args.requestCount).to.equal(2n);

    const { decryptedValue: usdtBatchTotal } = await userClient
      .decryptForTx(usdtBatchFormed!.args.ctHash)
      .withoutACP()
      .execute();
    expect(
      usdtBatchTotal,
      "USDT batch total should combine the original pending request with the new one",
    ).to.equal(usdtAmount1 + usdtAmount2);
    console.log("Swap-and-pop correctly preserved the earlier pending USDT request across the intervening USDC batch");
  });
});
