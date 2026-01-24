import hre from "hardhat";
import networks from "../config/networks";
import { CoFHEBridge } from "../types/contracts";

async function main() {
  const { getChainId, getNamedAccounts, ethers, switchNetwork } = hre;
  const chainId = await getChainId();
  const { deployer } = await getNamedAccounts();

  for (const network of networks) {
    await switchNetwork(network.id);
    const contractAddress = network.contracts.defaultBridge.address;

    if (!contractAddress) {
      console.log(`No CoFHEBridge address for network ${network.name}, skipping...`);
      continue;
    }

    const signer = await ethers.getSigner(deployer);

    const bridgeContract = (await ethers.getContractAt(
      "CoFHEBridge",
      contractAddress,
      signer
    )) as unknown as CoFHEBridge;

    const thisNetwork = networks.filter((net) => net.chainId === network.chainId);

    for (const otherNetwork of thisNetwork) {
      const tx1 = await bridgeContract.setChainIdToEid(otherNetwork.chainId, otherNetwork.layerzeroEid);

      console.log(
        `setChainIdToEid called on ${network.name} bridge for chainId ${otherNetwork.chainId} with eid ${otherNetwork.layerzeroEid}`
      );
      console.log(`Transaction hash: ${tx1.hash}`);
      await tx1.wait();
      console.log(`setChainIdToEid completed successfully on ${network.name}. 🤌`);

      const tx2 = await bridgeContract.setPeer(
        otherNetwork.layerzeroEid,
        ethers.zeroPadValue(otherNetwork.contracts.defaultBridge.address, 32)
      );
      console.log(
        `setPeer called on ${network.name} bridge for eid ${otherNetwork.layerzeroEid} with peer bridge address ${otherNetwork.contracts.defaultBridge.address}`
      );
      console.log(`Transaction hash: ${tx2.hash}`);
      await tx2.wait();
      console.log(`setPeer completed successfully on ${network.name}. 🤌`);
    }
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
