import { expect } from "chai";
import hre from "hardhat";
import {
  createClient,
  deployAdapterFixture,
  encryptAmount,
  findEvent,
  mintAndWrap,
  supplyFlow,
} from "./helpers";

describe("Aave adapter - AdminFacet (Sepolia fork)", function (this: Mocha.Suite) {
  this.timeout(180000);

  it("restricts every admin function to the diamond owner", async function () {
    const { ethers } = hre;
    const { a, user, diamondAddress } = await deployAdapterFixture();

    const adminFacetAsUser = await ethers.getContractAt(
      "AdminFacet",
      diamondAddress,
      user,
    );

    await expect(
      adminFacetAsUser.setCTokenAddress([a.AAVE_USDC], [a.AAVE_USDC]),
    ).to.be.revertedWith("AdminFacet: Not owner");

    await expect(
      adminFacetAsUser.setAavePoolAddress(a.AAVE_POOL, a.AAVE_DATA_PROVIDER),
    ).to.be.revertedWith("AdminFacet: Not owner");

    await expect(adminFacetAsUser.setRequestThreshold(5)).to.be.revertedWith(
      "AdminFacet: Not owner",
    );

    await expect(
      adminFacetAsUser.initMappings(user.address, [a.AAVE_USDC]),
    ).to.be.revertedWith("AdminFacet: Not owner");
  });

  it("lets the owner reconfigure the request threshold and reflects it in batching behavior", async function () {
    const { ethers, deployments } = hre;
    const { a, deployer, user, diamondAddress } = await deployAdapterFixture();

    const adminFacet = await ethers.getContractAt(
      "AdminFacet",
      diamondAddress,
      deployer,
    );
    await (await adminFacet.setRequestThreshold(2)).wait();

    const eaUSDCDeployment = await deployments.get("EAaveUSDC");
    const supplyAmount = 100n * 10n ** 6n;
    await mintAndWrap(
      user,
      a.AAVE_USDC,
      eaUSDCDeployment.address,
      supplyAmount,
      diamondAddress,
    );

    // With threshold=2, a single request must not form a batch.
    const client = await createClient(user);
    const { handle, proof } = await encryptAmount(
      client,
      diamondAddress,
      supplyAmount,
    );
    const supplyFacet = await ethers.getContractAt(
      "SupplyFacet",
      diamondAddress,
      user,
    );
    const receipt = await (
      await supplyFacet.supplyRequest(a.AAVE_USDC, handle, 0, proof)
    ).wait();
    const batchFormed = findEvent(
      receipt,
      supplyFacet.interface,
      "SupplyBatchFormed",
    );
    expect(
      batchFormed,
      "raising REQUEST_THRESHOLD to 2 should stop a lone request from forming a batch",
    ).to.be.undefined;

    // Restoring threshold=1 and supplying a *different* asset should now go
    // through end-to-end on a single request (using a different asset so this
    // doesn't interact with the still-pending, unmatched USDC request above).
    await (await adminFacet.setRequestThreshold(1)).wait();
    const eaUSDTDeployment = await deployments.get("EAaveUSDT");
    await mintAndWrap(
      user,
      a.AAVE_USDT,
      eaUSDTDeployment.address,
      supplyAmount,
      diamondAddress,
    );
    const { finalized } = await supplyFlow({
      user,
      diamondAddress,
      assetAddress: a.AAVE_USDT,
      amount: supplyAmount,
    });
    expect(
      finalized,
      "FinalizeSupplyRequest not emitted after restoring threshold=1",
    ).to.not.be.undefined;
  });

  it("does not overwrite an already-initialized user balance when initMappings is called again", async function () {
    const { ethers, deployments } = hre;
    const { a, deployer, user, diamondAddress } = await deployAdapterFixture();

    const eaUSDCDeployment = await deployments.get("EAaveUSDC");
    const supplyAmount = 250n * 10n ** 6n;
    await mintAndWrap(
      user,
      a.AAVE_USDC,
      eaUSDCDeployment.address,
      supplyAmount,
      diamondAddress,
    );
    const { multiplier } = await supplyFlow({
      user,
      diamondAddress,
      assetAddress: a.AAVE_USDC,
      amount: supplyAmount,
    });
    if (multiplier === undefined) {
      throw new Error("Expected supply multiplier to be defined");
    }
    const expectedScaledBalance = (supplyAmount * multiplier) / 1_000_000n;

    const getterFacet = await ethers.getContractAt(
      "GetterFacet",
      diamondAddress,
      user,
    );
    await hre.cofhe.mocks.expectPlaintext(
      BigInt(
        (await getterFacet.getSuppliedBalance(
          user.address,
          a.AAVE_USDC,
        )) as unknown as string,
      ),
      expectedScaledBalance,
    );

    // Re-running initMappings for the same user/asset must be a no-op given the
    // `isInitialized` guard, not reset their real (nonzero) supplied balance to 0.
    const adminFacet = await ethers.getContractAt(
      "AdminFacet",
      diamondAddress,
      deployer,
    );
    await (await adminFacet.initMappings(user.address, [a.AAVE_USDC])).wait();

    await hre.cofhe.mocks.expectPlaintext(
      BigInt(
        (await getterFacet.getSuppliedBalance(
          user.address,
          a.AAVE_USDC,
        )) as unknown as string,
      ),
      expectedScaledBalance,
    );
    console.log(
      `initMappings re-call left the existing scaled balance untouched: ${expectedScaledBalance}`,
    );
  });
});
