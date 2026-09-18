import { DeployFunction } from "hardhat-deploy/types";
import { HardhatRuntimeEnvironment } from "hardhat/types";

import addresses from "../../config/addresses";
import { resolveAddressChainId } from "../../utils";

const RESERVES = [
  { assetKey: "AAVE_USDC", deploymentName: "EAaveUSDC", symbol: "eaUSDC" },
  { assetKey: "AAVE_USDT", deploymentName: "EAaveUSDT", symbol: "eaUSDT" },
  { assetKey: "AAVE_DAI", deploymentName: "EAaveDAI", symbol: "eaDAI" },
] as const;

const func: DeployFunction = async function (hre: HardhatRuntimeEnvironment) {
  const { deployer } = await hre.getNamedAccounts();
  const chainId = await resolveAddressChainId(hre);
  const { deploy } = hre.deployments;

  if (!addresses[+chainId]) {
    throw new Error(`No addresses configured for chainId ${chainId}`);
  }

  for (const { assetKey, deploymentName, symbol } of RESERVES) {
    const underlying = addresses[+chainId][assetKey];
    if (!underlying) {
      throw new Error(`Missing ${assetKey} address for chainId ${chainId}`);
    }

    const deployed = await deploy(deploymentName, {
      contract: "eERC20",
      from: deployer,
      args: [underlying, symbol],
      log: true,
    });

    console.log(`${deploymentName} (wraps ${assetKey} @ ${underlying}):`, deployed.address);
  }
};

export default func;
func.id = "deploy_aave_ctokens";
func.tags = ["AaveCTokens"];
