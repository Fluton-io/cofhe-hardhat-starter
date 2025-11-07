import { task } from "hardhat/config";
import addresses from "../../config/addresses";
import { FhenixBridge } from "../../types";
import { cofhejs, Encryptable } from "cofhejs/node";

task("fulfill", "Fulfill the intent")
  .addOptionalParam("signeraddress", "The address of the signer")
  .addOptionalParam("bridgeaddress", "The address of the bridge contract")
  .addOptionalParam("tokenaddress", "The address of the token contract")
  .setAction(async ({ signeraddress, bridgeaddress, tokenaddress }, hre) => {
    const { ethers, getChainId, deployments, getNamedAccounts, cofhe } = hre;
    const chainId = await getChainId();
    const signerAddress = signeraddress || (await getNamedAccounts()).relayer;
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

    await cofhe.expectResultSuccess(
      await cofhejs.initializeWithEthers({
        ethersProvider: ethers.provider,
        ethersSigner: signer,
        environment: "TESTNET",
      })
    );

    const [encTransferInput] = await hre.cofhe.expectResultSuccess(
      await cofhejs.encrypt([Encryptable.uint64(100000n)] as const)
    );

    const bridgeCtHash = 9524551590556872445629768055789978187614811716166253886930162958328290280704n;

    const intent = {
      sender: "0x9C3Ad2B5f00EC8e8564244EBa59692Dd5e57695b",
      receiver: "0x9C3Ad2B5f00EC8e8564244EBa59692Dd5e57695b",
      relayer: signer.address,
      inputToken: "0x353e69f463f78987917b5C2505eb7635B7200CFd",
      outputToken: "0xb5F8102CF5CFD8E9593F2b3c4Ed55C2D90FD36DF",
      inputAmount: 76116566624115202630813867930347678809611165829529072392409309097160980694272n,
      outputAmount: bridgeCtHash,
      id: 4254351541969520240672908906812373447451030031104081795679195401304766009574n,
      originChainId: 11155111,
      destinationChainId: 21127701653695456104613444739534183004666464154949482736628618357727134024704n,
      filledStatus: 0n,
      solverPaid: false,
      timeout: 1762561260n,
    };

    // Wrapping tokens
    console.log(`Fulfilling intent on bridge ${bridgeaddress}...`);
    await bridgeContract[
      "fulfill((address,address,address,address,address,uint256,uint256,uint256,uint32,uint256,uint8,bool,uint256),(uint256,uint8,uint8,bytes))"
    ](intent, encTransferInput);

    console.log(`Intent fulfilled successfully. 🤌`);
  });
