import { ethers } from "hardhat";
import hre from "hardhat";

async function main() {
  const [deployer] = await ethers.getSigners();
  console.log("Deploying FhenixBridge with account:", deployer.address);

  // Check if verification is requested
  const shouldVerify = process.env.VERIFY_CONTRACT === "true";

  // Deploy FhenixBridge
  const FhenixBridge = await ethers.getContractFactory("FhenixBridge");
  const bridge = await FhenixBridge.deploy();

  await bridge.waitForDeployment();
  const bridgeAddress = await bridge.getAddress();

  console.log("FhenixBridge deployed to:", bridgeAddress);

  const deployTx = bridge.deploymentTransaction();
  console.log("Transaction hash:", deployTx?.hash);

  // Verify contract if requested
  if (shouldVerify) {
    console.log("Verifying contract...");
    try {
      await hre.run("verify:verify", {
        address: bridgeAddress,
        constructorArguments: [],
      });
      console.log("Contract verified successfully");
    } catch (error: any) {
      if (error.message.toLowerCase().includes("already verified")) {
        console.log("Contract already verified");
      } else {
        console.error("Verification failed:", error.message);
      }
    }
  }

  return {
    bridge: bridgeAddress,
    deployer: deployer.address,
    transactionHash: deployTx?.hash,
    verified: shouldVerify,
  };
}

if (require.main === module) {
  main()
    .then(() => process.exit(0))
    .catch((error) => {
      console.error(error);
      process.exit(1);
    });
}

export { main as deployBridge };
