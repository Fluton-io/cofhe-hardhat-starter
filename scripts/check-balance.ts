import { ethers } from "hardhat";

async function checkBalance() {
  const [deployer] = await ethers.getSigners();
  const balance = await ethers.provider.getBalance(deployer.address);
  const network = await ethers.provider.getNetwork();

  console.log(`Address: ${deployer.address}`);
  console.log(`Balance: ${ethers.formatEther(balance)} ETH`);
  console.log(`Network: ${network.name} (${network.chainId})`);

  if (Number(ethers.formatEther(balance)) < 0.01) {
    console.log("Low balance - consider getting more ETH from faucet");
  }
}

checkBalance()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error("Error:", error.message);
    process.exit(1);
  });
