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

  const constructorArguments = ["1000000000000000000000000000000000"];

  const deployed = await deploy("AAVEToken", {
    from: deployer,
    args: constructorArguments,
    log: true,
  });

  console.log(`ERC20 contract: `, deployed.address);

  const verificationArgs = {
    address: deployed.address,
    contract: "contracts/token/ERC20.sol:AAVEToken",
    constructorArguments,
  };

  console.info("\nSubmitting verification request on scanner...");
  await sleep(30000); // wait for arbiscan to index the contract
  await hre.run("verify:verify", verificationArgs);
};

export default func;
func.id = "deploy_ERC20"; // id required to prevent reexecution
func.tags = ["ERC20"];
