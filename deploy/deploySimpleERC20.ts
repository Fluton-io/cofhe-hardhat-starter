import { HardhatRuntimeEnvironment } from "hardhat/types";
import { DeployFunction } from "hardhat-deploy/types";

const func: DeployFunction = async function (hre: HardhatRuntimeEnvironment) {
  const { deployments, getNamedAccounts } = hre;
  const { deploy } = deployments;

  const { deployer } = await getNamedAccounts();

  // Token configuration
  const tokenName = "Test Token";
  const tokenSymbol = "TEST";
  const tokenDecimals = 18;
  const initialSupply = hre.ethers.parseEther("1000000"); // 1M tokens

  console.log(`Deploying SimpleERC20 with deployer: ${deployer}`);

  const simpleERC20 = await deploy("SimpleERC20", {
    from: deployer,
    args: [tokenName, tokenSymbol, tokenDecimals, initialSupply],
    log: true,
    deterministicDeployment: false,
  });

  console.log(`SimpleERC20 deployed to: ${simpleERC20.address}`);
  console.log(
    `Initial supply: ${hre.ethers.formatEther(initialSupply)} ${tokenSymbol}`
  );
  console.log(`Minted to deployer: ${deployer}`);

  // Verify contract if on a live network
  if (hre.network.name !== "hardhat" && hre.network.name !== "localhost") {
    try {
      await hre.run("verify:verify", {
        address: simpleERC20.address,
        constructorArguments: [
          tokenName,
          tokenSymbol,
          tokenDecimals,
          initialSupply,
        ],
      });
      console.log("Contract verified on Etherscan");
    } catch (error) {
      console.log("Verification failed:", error);
    }
  }

  return true;
};

func.id = "deploy_simple_erc20";
func.tags = ["SimpleERC20"];
func.dependencies = [];

export default func;
