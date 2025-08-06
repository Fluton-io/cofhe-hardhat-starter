import { DeployFunction } from "hardhat-deploy/types";
import { HardhatRuntimeEnvironment } from "hardhat/types";

import addresses from "../config/addresses";
import { sleep } from "../utils";

const func: DeployFunction = async function (hre: HardhatRuntimeEnvironment) {
  const { deployer } = await hre.getNamedAccounts();
  const chainId = await hre.getChainId();
  const { deploy } = hre.deployments;

  console.log(deployer, chainId);

  if (!addresses[+chainId]) {
    throw new Error(`No addresses found for chainId ${chainId}`);
  }

  const constructorArguments = [addresses[+chainId].USDC, "eUSDC"];

  const deployed = await deploy("eERC20", {
    from: deployer,
    args: constructorArguments,
    log: true,
  });

  console.log(`eERC20 contract: `, deployed.address);

  const verificationArgs = {
    address: deployed.address,
    contract: "contracts/token/eERC20.sol:eERC20",
    constructorArguments,
  };

  console.info("\nSubmitting verification request on Arbiscan...");
  await sleep(30000); // wait for arbiscan to index the contract
  await hre.run("verify:verify", verificationArgs);
};

export default func;
func.id = "deploy_eERC20"; // id required to prevent reexecution
func.tags = ["eERC20"];
