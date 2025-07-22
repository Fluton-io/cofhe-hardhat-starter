import { ethers } from "hardhat";
import { Contract } from "ethers";

interface DeploymentConfig {
  underlyingToken: string;
  symbolOverride?: string;
  verify?: boolean;
}

async function deployConfidentialERC20(config: DeploymentConfig) {
  const [deployer] = await ethers.getSigners();
  console.log(`Deployer: ${deployer.address}`);

  // Validate the underlying token
  try {
    const underlyingToken = await ethers.getContractAt(
      "IERC20Metadata",
      config.underlyingToken
    );

    const name = await underlyingToken.name();
    const symbol = await underlyingToken.symbol();
    console.log(`Token: ${name} (${symbol})`);
  } catch (error) {
    console.error(`Invalid ERC20 token at ${config.underlyingToken}`);
    throw error;
  }

  // Check if already wrapped
  try {
    // Try to check if it has FHERC20-specific functions
    const testContract = await ethers.getContractAt(
      "contracts/ConfidentialERC20.sol:ConfidentialERC20",
      config.underlyingToken
    );
    await testContract.erc20();
    console.log("Error: Token already wrapped");
    throw new Error("Cannot wrap already wrapped tokens");
  } catch (error: any) {
    if (error.message.includes("Cannot wrap already wrapped")) {
      throw error;
    }
  }

  // Deploy ConfidentialERC20
  const ConfidentialERC20 = await ethers.getContractFactory(
    "contracts/ConfidentialERC20.sol:ConfidentialERC20"
  );
  const confidentialToken = await ConfidentialERC20.deploy(
    config.underlyingToken,
    config.symbolOverride || ""
  );

  await confidentialToken.waitForDeployment();
  const confidentialAddress = await confidentialToken.getAddress();
  console.log(`ConfidentialERC20: ${confidentialAddress}`);

  const deployTx = confidentialToken.deploymentTransaction();
  console.log(`Transaction: ${deployTx?.hash}`);

  const confToken = await ethers.getContractAt(
    "contracts/ConfidentialERC20.sol:ConfidentialERC20",
    confidentialAddress
  );
  const confName = await confToken.name();
  const confSymbol = await confToken.symbol();

  console.log(`${confName} (${confSymbol}): ${confidentialAddress}`);

  return {
    confidentialToken: confidentialAddress,
    underlyingToken: config.underlyingToken,
    deployer: deployer.address,
    transactionHash: deployTx?.hash,
  };
}

async function main() {
  // Configuration - modify these values for your deployment
  const config: DeploymentConfig = {
    underlyingToken: process.env.UNDERLYING_TOKEN_ADDRESS || "",
    symbolOverride: process.env.SYMBOL_OVERRIDE || "", // Optional: custom symbol
    verify: process.env.VERIFY_CONTRACT === "true", // Set to verify contract
  };

  // Validate required parameters
  if (!config.underlyingToken) {
    console.error(
      "Error: UNDERLYING_TOKEN_ADDRESS environment variable is required"
    );
    process.exit(1);
  }

  if (!ethers.isAddress(config.underlyingToken)) {
    console.error(`Error: Invalid address format: ${config.underlyingToken}`);
    process.exit(1);
  }

  try {
    const result = await deployConfidentialERC20(config);
    console.log(`Confidential Token: ${result.confidentialToken}`);
    console.log(`Underlying Token: ${result.underlyingToken}`);
    console.log(`Transaction: ${result.transactionHash}`);
  } catch (error: any) {
    console.error("Error:", error.message);
    process.exit(1);
  }
}

// Handle both direct execution and imports
if (require.main === module) {
  main()
    .then(() => process.exit(0))
    .catch((error) => {
      console.error(error);
      process.exit(1);
    });
}

export { deployConfidentialERC20, DeploymentConfig };
