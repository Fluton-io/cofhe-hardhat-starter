import { Contract } from "ethers";
import { DeployFunction } from "hardhat-deploy/types";
import { HardhatRuntimeEnvironment } from "hardhat/types";

import addresses from "../../config/addresses";
import { getSelectors } from "./getSelectors";
import { resolveAddressChainId } from "../../utils";

const FACET_NAMES = ["SupplyFacet", "WithdrawFacet", "BorrowFacet", "RepayFacet", "GetterFacet"] as const;

const func: DeployFunction = async function (hre: HardhatRuntimeEnvironment) {
  const { deployer } = await hre.getNamedAccounts();
  const chainId = await resolveAddressChainId(hre);
  const { deploy } = hre.deployments;

  if (!addresses[+chainId]) {
    throw new Error(`No addresses configured for chainId ${chainId}`);
  }

  console.log("Deploying with:", deployer, "on chainId:", chainId);

  const diamondDeployment = await deploy("Diamond", {
    from: deployer,
    args: [deployer],
    log: true,
  });
  console.log("Diamond deployed at:", diamondDeployment.address);

  const diamond = await hre.ethers.getContractAt("Diamond", diamondDeployment.address);

  for (const facetName of FACET_NAMES) {
    const facetDeployment = await deploy(facetName, { from: deployer, log: true });
    console.log(`${facetName} deployed at:`, facetDeployment.address);

    const facetContract = (await hre.ethers.getContractAt(facetName, facetDeployment.address)) as unknown as Contract;
    const cut = {
      facetAddress: facetDeployment.address,
      action: 0, // Add
      functionSelectors: getSelectors(facetContract),
    };

    console.log(`Performing ${facetName} diamondCut...`);
    await (await diamond.diamondCut([cut])).wait();
    console.log(`${facetName} cut completed.`);
  }

  const adminFacetDeployment = await deploy("AdminFacet", { from: deployer, log: true });
  console.log("AdminFacet deployed at:", adminFacetDeployment.address);
  const adminFacetContract = (await hre.ethers.getContractAt(
    "AdminFacet",
    adminFacetDeployment.address,
  )) as unknown as Contract;
  await (
    await diamond.diamondCut([
      { facetAddress: adminFacetDeployment.address, action: 0, functionSelectors: getSelectors(adminFacetContract) },
    ])
  ).wait();
  console.log("AdminFacet cut completed.");

  const loupeFacetDeployment = await deploy("DiamondLoupeFacet", { from: deployer, log: true });
  console.log("DiamondLoupeFacet deployed at:", loupeFacetDeployment.address);
  const loupeFacetContract = (await hre.ethers.getContractAt(
    "DiamondLoupeFacet",
    loupeFacetDeployment.address,
  )) as unknown as Contract;
  await (
    await diamond.diamondCut([
      { facetAddress: loupeFacetDeployment.address, action: 0, functionSelectors: getSelectors(loupeFacetContract) },
    ])
  ).wait();
  console.log("DiamondLoupeFacet cut completed.");

  const adminFacet = await hre.ethers.getContractAt("AdminFacet", diamondDeployment.address);

  const assets = [addresses[+chainId].AAVE_USDC, addresses[+chainId].AAVE_USDT, addresses[+chainId].AAVE_DAI];
  const cTokens = [
    (await hre.deployments.get("EAaveUSDC")).address,
    (await hre.deployments.get("EAaveUSDT")).address,
    (await hre.deployments.get("EAaveDAI")).address,
  ];

  console.log("Initializing encrypted balances...");
  await (await adminFacet.initMappings(deployer, assets)).wait();

  console.log("Setting cToken mapping...");
  await (await adminFacet.setCTokenAddress(assets, cTokens)).wait();
  console.log("CToken mapping set successfully.");

  console.log("Setting Aave Pool address...");
  await (
    await adminFacet.setAavePoolAddress(addresses[+chainId].AAVE_POOL, addresses[+chainId].AAVE_DATA_PROVIDER)
  ).wait();
  console.log("Aave Pool set successfully.");

  console.log("Setting request threshold...");
  await (await adminFacet.setRequestThreshold(1)).wait();
  console.log("Request threshold set successfully.");
};

export default func;
func.id = "deploy_aave_adapter_diamond";
func.tags = ["AaveAdapterDiamond"];
func.dependencies = ["AaveCTokens"];
