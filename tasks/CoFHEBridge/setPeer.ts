import { task } from "hardhat/config";
import addresses from "../../config/addresses";
import { CoFHEBridge } from "../../types";
import { zeroPadValue } from "ethers";

task("setPeer", "set peer bridge on CoFHE Bridge")
  .addOptionalParam("signeraddress", "The address of the signer")
  .addOptionalParam("bridgeaddress", "The address of the bridge contract")
  .addOptionalParam("eid", "The endpoint ID to set the peer for")
  .addOptionalParam("peerbridgeaddress", "The peer bridge address")
  .setAction(async ({ signeraddress, bridgeaddress, eid, peerbridgeaddress }, hre) => {
    const { ethers, deployments, getChainId, getNamedAccounts, cofhe } = hre;
    const chainId = await getChainId();
    const signerAddress = signeraddress || (await getNamedAccounts()).deployer;
    const signer = await ethers.getSigner(signerAddress);

    if (!bridgeaddress) {
      const bridgeDeployment = await deployments.getOrNull("CoFHEBridge");
      bridgeaddress = bridgeDeployment?.address || addresses[+chainId].CoFHEBridge; // Default to deployed bridge address
    }

    const bridgeContract = (await ethers.getContractAt("CoFHEBridge", bridgeaddress, signer)) as unknown as CoFHEBridge;

    const tx = await bridgeContract.setPeer(eid, zeroPadValue(peerbridgeaddress, 32));

    console.log(
      `setPeer called with eid ${eid} and peer bridge address ${peerbridgeaddress} by signer ${signerAddress} on bridge ${bridgeaddress}`
    );
    console.log(`Transaction hash: ${tx.hash}`);
    await tx.wait();
    console.log(`setPeer completed successfully. 🤌`);
  });
