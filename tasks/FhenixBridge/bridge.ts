import { task } from "hardhat/config";
import addresses from "../../config/addresses";
import { EERC20, FhenixBridge } from "../../types";
import { cofhejs, Encryptable } from "cofhejs/node";
import { generateTransferFromPermit, appendMetadataToInput } from "../../utils";

task("bridge", "Bridge eERC20 tokens to FHEVM")
  .addOptionalParam("signeraddress", "The address of the signer")
  .addOptionalParam("bridgeaddress", "The address of the bridge contract")
  .addOptionalParam("receiveraddress", "receiver address")
  .addOptionalParam("relayeraddress", "relayer address")
  .addOptionalParam("inputtokenaddress", "The address of the input token contract")
  .addOptionalParam("outputtokenaddress", "The address of the output token contract")
  .addOptionalParam("inputamount", "amount to bridge", "1000000") // 1 eERC20
  .addOptionalParam("outputamount", "amount intended to receive on the destination chain", "1000000") // 1 eERC20
  .addOptionalParam("destinationchainid", "destination chain id")
  .setAction(
    async (
      {
        signeraddress,
        bridgeaddress,
        receiveraddress,
        relayeraddress,
        inputtokenaddress,
        outputtokenaddress,
        inputamount,
        outputamount,
        destinationchainid,
      },
      hre
    ) => {
      const { ethers, deployments, getChainId, getNamedAccounts, cofhe } = hre;
      const chainId = await getChainId();
      const signerAddress = signeraddress || (await getNamedAccounts()).user;
      const signer = await ethers.getSigner(signerAddress);

      if (!inputtokenaddress) {
        const tokenDeployment = await deployments.get("eERC20");
        inputtokenaddress = tokenDeployment.address || addresses[+chainId].eUSDC; // Default to deployed
      }

      if (!bridgeaddress) {
        const bridgeDeployment = await deployments.get("FhenixBridge");
        bridgeaddress = bridgeDeployment.address || addresses[+chainId].FhenixBridge; // Default to deployed bridge address
      }

      if (!destinationchainid) {
        destinationchainid = chainId === "11155111" ? "421614" : "11155111"; // Default to current chain ID
      }

      if (!outputtokenaddress) {
        if (addresses[+destinationchainid] === undefined) {
          throw new Error(
            `Please either provide the output token address or ensure the destination chain ID ${destinationchainid} is defined in addresses.ts`
          );
        }
        outputtokenaddress = addresses[+destinationchainid].eUSDC; // Default to deployed output token address
      }

      if (!receiveraddress) {
        receiveraddress = signerAddress; // Default to signer address
      }

      if (!relayeraddress) {
        relayeraddress = (await getNamedAccounts()).relayer; // Default to relayer address
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

      const encTransferResult = await cofhejs.encrypt([
        Encryptable.uint64(inputamount),
        Encryptable.uint64(outputamount),
        Encryptable.uint32(destinationchainid),
      ] as const);
      const [encTransferInput, encTransferOutput, encTransferDestination] = await hre.cofhe.expectResultSuccess(
        encTransferResult
      );

      const tx = await bridgeContract.bridge(
        signerAddress,
        signerAddress,
        relayeraddress,
        inputtokenaddress,
        outputtokenaddress,
        encTransferInput,
        encTransferOutput,
        encTransferDestination
      );

      console.log(
        `Bridging ${inputamount} eERC20 tokens from ${signerAddress} to ${receiveraddress} to chain ${destinationchainid}`
      );
      console.log(`Transaction hash: ${tx.hash}`);
      console.log("cthash: ", encTransferOutput.ctHash);
      await tx.wait();
      console.log(`Bridging completed successfully. 🤌`);
    }
  );
