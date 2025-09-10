import { task } from "hardhat/config";
import addresses from "../../config/addresses";
import { EERC20, FhenixBridge } from "../../types";
import { cofhejs, Encryptable, FheTypes } from "cofhejs/node";
import { appendMetadataToInput, generateTransferFromPermit } from "../../utils";

task("fulfill", "Fulfill the intent")
  .addOptionalParam("signeraddress", "The address of the signer")
  .addOptionalParam("bridgeaddress", "The address of the bridge contract")
  .addOptionalParam("tokenaddress", "The address of the token contract")
  .setAction(async ({ signeraddress, bridgeaddress, tokenaddress }, hre) => {
    const { ethers, getChainId, deployments, getNamedAccounts, cofhe } = hre;
    const chainId = await getChainId();
    const signerAddress = signeraddress || (await getNamedAccounts()).user;
    const signer = await ethers.getSigner(signerAddress);

    if (!bridgeaddress) {
      const bridgeDeployment = await deployments.get("FhenixBridge");
      bridgeaddress = bridgeDeployment.address || addresses[+chainId].FhenixBridge; // Default to deployed bridge address
    }

    if (!tokenaddress) {
      const tokenDeployment = await deployments.get("eERC20");
      tokenaddress = tokenDeployment.address || addresses[+chainId].eUSDC; // Default to deployed
    }

    const bridgeContract = (await ethers.getContractAt(
      "FhenixBridge",
      bridgeaddress,
      signer
    )) as unknown as FhenixBridge;
    const tokenContract = (await ethers.getContractAt("eERC20", tokenaddress, signer)) as unknown as EERC20;

    await cofhe.expectResultSuccess(
      await cofhejs.initializeWithEthers({
        ethersProvider: ethers.provider,
        ethersSigner: signer,
        environment: "TESTNET",
      })
    );

    const bridgeCtHash = 17376560294053597410165502690530354946667925495160395570320934095374872012201n;

    // permit creation
    const encTransferCtHashWMetadata = appendMetadataToInput({
      ctHash: bridgeCtHash,
      securityZone: 0,
      utype: FheTypes.Uint128,
    });
    const permit = await generateTransferFromPermit({
      token: tokenContract,
      signer,
      owner: signer.address,
      spender: bridgeaddress,
      valueHash: encTransferCtHashWMetadata,
    });

    const intent = {
      sender: "0x9C3Ad2B5f00EC8e8564244EBa59692Dd5e57695b",
      receiver: "0x9C3Ad2B5f00EC8e8564244EBa59692Dd5e57695b",
      relayer: signer.address,
      inputToken: "0x353e69f463f78987917b5C2505eb7635B7200CFd",
      outputToken: "0x2Ce559C8836C17F2aaDB3E6eE1f976C58114E95A",
      inputAmount: 0n,
      outputAmount: bridgeCtHash,
      id: "123",
      originChainId: 421614,
      destinationChainId: 11155111,
      filledStatus: 0n,
      solverPaid: false,
      timeout: 0n,
    };

    // Wrapping tokens
    console.log(`Fulfilling intent on bridge ${bridgeaddress}...`);
    await bridgeContract[
      "fulfill((address,address,address,address,address,uint256,uint256,uint256,uint32,uint32,uint8,bool,uint256),uint256,(address,address,uint256,uint256,uint8,bytes32,bytes32))"
    ](intent, bridgeCtHash, permit);

    console.log(`Intent fulfilled successfully. 🤌`);
  });
