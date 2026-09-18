import { expect } from "chai";
import hre from "hardhat";
import { deployAdapterFixture } from "./helpers";

const EXPECTED_FACETS = [
  "SupplyFacet",
  "WithdrawFacet",
  "BorrowFacet",
  "RepayFacet",
  "GetterFacet",
  "AdminFacet",
  "DiamondLoupeFacet",
] as const;

describe("Aave adapter - Diamond / DiamondLoupeFacet (Sepolia fork)", function () {
  this.timeout(180000);

  it("exposes every deployed facet and its selectors consistently through the loupe", async function () {
    const { ethers, deployments } = hre;
    const { diamondAddress } = await deployAdapterFixture();

    const loupe = await ethers.getContractAt(
      "DiamondLoupeFacet",
      diamondAddress,
    );

    const facetAddresses: string[] = await loupe.facetAddresses();
    expect(facetAddresses.length).to.equal(EXPECTED_FACETS.length);

    for (const facetName of EXPECTED_FACETS) {
      const facetDeployment = await deployments.get(facetName);
      expect(
        facetAddresses.map((addr) => addr.toLowerCase()),
        `${facetName} should be registered in the diamond`,
      ).to.include(facetDeployment.address.toLowerCase());

      const facetContract = await ethers.getContractAt(
        facetName,
        facetDeployment.address,
      );
      const expectedSelectors = facetContract.interface.fragments
        .filter((f: any) => f.type === "function")
        .map((f: any) => facetContract.interface.getFunction(f.name)!.selector);

      const registeredSelectors: string[] = await loupe.facetFunctionSelectors(
        facetDeployment.address,
      );
      expect(
        new Set(registeredSelectors),
        `selectors registered for ${facetName}`,
      ).to.deep.equal(new Set(expectedSelectors));

      for (const selector of expectedSelectors) {
        expect(
          (await loupe.facetAddress(selector)).toLowerCase(),
          `facetAddress(${selector})`,
        ).to.equal(facetDeployment.address.toLowerCase());
      }
    }

    const facets = await loupe.facets();
    expect(facets.length).to.equal(EXPECTED_FACETS.length);
    const totalSelectorsFromFacets = facets.reduce(
      (sum: number, f: any) => sum + f.functionSelectors.length,
      0,
    );
    const totalSelectorsFromDirectCalls = await Promise.all(
      facetAddresses.map((addr) => loupe.facetFunctionSelectors(addr)),
    ).then((lists) => lists.reduce((sum, l) => sum + l.length, 0));
    expect(totalSelectorsFromFacets).to.equal(totalSelectorsFromDirectCalls);

    // An unregistered selector should resolve to the zero address.
    expect(await loupe.facetAddress("0xdeadbeef")).to.equal(ethers.ZeroAddress);
  });

  it("restricts diamondCut to the contract owner", async function () {
    const { ethers } = hre;
    const { user, diamondAddress } = await deployAdapterFixture();

    const diamondAsUser = await ethers.getContractAt(
      "Diamond",
      diamondAddress,
      user,
    );
    await expect(diamondAsUser.diamondCut([])).to.be.revertedWith(
      "LibDiamond: Must be contract owner",
    );
  });

  it("lets the owner add a new facet via diamondCut and immediately routes calls to it", async function () {
    const { ethers } = hre;
    const { deployer, diamondAddress } = await deployAdapterFixture();

    // Deploy a second, independent DiamondLoupeFacet instance purely as a
    // harmless "new facet" to cut in - reuses an already-compiled contract so
    // this doesn't need a bespoke test-only contract.
    const NewFacet = await ethers.getContractFactory(
      "DiamondLoupeFacet",
      deployer,
    );
    const newFacet = await NewFacet.deploy();
    await newFacet.waitForDeployment();
    const newFacetAddress = await newFacet.getAddress();

    const diamond = await ethers.getContractAt(
      "Diamond",
      diamondAddress,
      deployer,
    );
    const loupeBefore = await ethers.getContractAt(
      "DiamondLoupeFacet",
      diamondAddress,
    );

    // Remove the existing DiamondLoupeFacet's selectors, then add them back
    // pointing at the freshly deployed facet instance - this exercises Remove
    // and Add in one diamondCut call and proves the switch actually routes calls.
    const existingSelectors: string[] = Array.from(
      await loupeBefore.facetFunctionSelectors(
        (await hre.deployments.get("DiamondLoupeFacet")).address,
      ),
    );

    await (
      await diamond.diamondCut([
        {
          facetAddress: ethers.ZeroAddress,
          action: 2 /* Remove */,
          functionSelectors: existingSelectors,
        },
      ])
    ).wait();

    // Loupe calls should now fail to route since no facet owns those selectors.
    const brokenLoupe = await ethers.getContractAt(
      "DiamondLoupeFacet",
      diamondAddress,
    );
    await expect(brokenLoupe.facetAddresses()).to.be.reverted;

    await (
      await diamond.diamondCut([
        {
          facetAddress: newFacetAddress,
          action: 0 /* Add */,
          functionSelectors: existingSelectors,
        },
      ])
    ).wait();

    const restoredLoupe = await ethers.getContractAt(
      "DiamondLoupeFacet",
      diamondAddress,
    );
    const addrs = await restoredLoupe.facetAddresses();
    expect(addrs.map((a: string) => a.toLowerCase())).to.include(
      newFacetAddress.toLowerCase(),
    );
    expect(await restoredLoupe.facetAddress(existingSelectors[0])).to.equal(
      newFacetAddress,
    );
  });
});
