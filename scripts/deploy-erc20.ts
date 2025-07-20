import { ethers } from "hardhat";

async function main() {
  const [deployer] = await ethers.getSigners();
  console.log(`Deployer: ${deployer.address}`);

  // Deploy MockERC20 token
  const MockERC20 = await ethers.getContractFactory("MockERC20");
  const token = await MockERC20.deploy(
    "Test Token",
    "TEST",
    18,
    ethers.parseEther("1000000")
  );

  await token.waitForDeployment();
  const tokenAddress = await token.getAddress();

  const deployTx = token.deploymentTransaction();
  console.log(`Transaction: ${deployTx?.hash}`);
  console.log(`Token: ${await token.name()} (${await token.symbol()})`);
  console.log(`Address: ${tokenAddress}`);

  return {
    token: tokenAddress,
    deployer: deployer.address,
    transactionHash: deployTx?.hash,
  };
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error("Error:", error.message);
    process.exit(1);
  });
