import { task } from "hardhat/config";
import addresses from "../../config/addresses";
import { CoFHEBridge } from "../../types";

task("setChainIdToEid", "Set chain ID to Eid mapping on CoFHE Bridge")
  .addOptionalParam("signeraddress", "The address of the signer")
  .addOptionalParam("bridgeaddress", "The address of the bridge contract")
  .addOptionalParam("chainid", "The chain ID to set the Eid for")
  .addOptionalParam("eid", "The endpoint ID")
  .setAction(async ({ signeraddress, bridgeaddress, chainid, eid }, hre) => {
    const { ethers, deployments, getChainId, getNamedAccounts, cofhe } = hre;
    const chainId = await getChainId();
    const signerAddress = signeraddress || (await getNamedAccounts()).deployer;
    const signer = await ethers.getSigner(signerAddress);

    if (!bridgeaddress) {
      const bridgeDeployment = await deployments.getOrNull("CoFHEBridge");
      bridgeaddress = bridgeDeployment?.address || addresses[+chainId].CoFHEBridge; // Default to deployed bridge address
    }

    const bridgeContract = (await ethers.getContractAt("CoFHEBridge", bridgeaddress, signer)) as unknown as CoFHEBridge;

    const tx = await bridgeContract.setChainIdToEid(chainid, eid);

    console.log(
      `setChainIdToEid called with chainId ${chainid} and eid ${eid} by signer ${signerAddress} on bridge ${bridgeaddress}`
    );
    console.log(`Transaction hash: ${tx.hash}`);
    await tx.wait();
    console.log(`setChainIdToEid completed successfully. 🤌`);
  });
