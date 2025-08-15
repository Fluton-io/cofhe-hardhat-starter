import { task } from "hardhat/config";
import addresses from "../../config/addresses";
import { FhenixBridge } from "../../types";
import { cofhejs, Encryptable } from "cofhejs/node";
import { generateTransferFromPermit, appendMetadataToInput } from "../../utils";
import { EERC20 } from "../../types";
import { createTaskHelper } from "../../utils/taskHelper";

task("bridge", "Bridge eERC20 tokens to FHEVM")
  .addOptionalParam("signeraddress", "The address of the signer")
  .addOptionalParam("bridgeaddress", "The address of the bridge contract")
  .addOptionalParam("receiveraddress", "receiver address")
  .addOptionalParam("relayeraddress", "relayer address")
  .addOptionalParam(
    "inputtokenaddress",
    "The address of the input token contract"
  )
  .addOptionalParam(
    "outputtokenaddress",
    "The address of the output token contract"
  )
  .addOptionalParam("inputamount", "amount to bridge", "100000000000000000000") // 100 eERC20
  .addOptionalParam(
    "outputamount",
    "amount intended to receive on the destination chain",
    "100000000000000000000"
  ) // 100 eERC20
  .addOptionalParam("destinationchainid", "destination chain id", "11155111")
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

      const signerAddress = signeraddress || (await getNamedAccounts()).user;
      console.log(`Using signer: ${signerAddress}`);
      const signer = await ethers.getSigner(signerAddress);

      // Create task helper
      const taskHelper = await createTaskHelper(hre, signeraddress);

      // Auto-resolve contract addresses
      const bridgeAddr =
        bridgeaddress || (await taskHelper.getContractAddress("FhenixBridge"));
      const inputTokenAddr =
        inputtokenaddress ||
        (await taskHelper.getContractAddress("eTEST_TOKEN"));

      // Auto-resolve account addresses
      const receiverAddr = receiveraddress || signerAddress;
      const relayerAddr =
        relayeraddress || (await taskHelper.getAccountAddress("relayer"));

      // Auto-resolve output token address
      let outputTokenAddr = outputtokenaddress;
      if (!outputTokenAddr) {
        if (!addresses[+destinationchainid]?.eTEST_TOKEN) {
          throw new Error(
            `Output token address not provided and destination chain ${destinationchainid} not configured in addresses.ts`
          );
        }
        outputTokenAddr = addresses[+destinationchainid].eTEST_TOKEN;
      }

      // Ensure sufficient eERC20 balance (auto-mint and wrap if needed)
      await taskHelper.ensureEErc20Balance(inputamount, inputTokenAddr);

      const bridgeContract = (await ethers.getContractAt(
        "FhenixBridge",
        bridgeAddr,
        signer
      )) as FhenixBridge;
      const tokenContract = (await ethers.getContractAt(
        "eERC20",
        inputTokenAddr,
        signer
      )) as unknown as EERC20;

      await cofhe.expectResultSuccess(
        await cofhejs.initializeWithEthers({
          ethersProvider: ethers.provider,
          ethersSigner: signer,
          environment: "TESTNET",
        })
      );

      const encTransferResult = await cofhejs.encrypt([
        Encryptable.uint128(inputamount),
        Encryptable.uint128(outputamount),
      ] as const);
      const [encTransferInput, encTransferOutput] =
        await hre.cofhe.expectResultSuccess(encTransferResult);

      // permit creation
      const encTransferCtHashWMetadata =
        appendMetadataToInput(encTransferInput);
      const permit = await generateTransferFromPermit({
        token: tokenContract,
        signer,
        owner: signer.address,
        spender: bridgeAddr,
        valueHash: encTransferCtHashWMetadata,
      });

      console.log(`Executing bridge transaction...`);
      const tx = await bridgeContract.bridge(
        signerAddress,
        receiverAddr,
        relayerAddr,
        inputTokenAddr,
        outputTokenAddr,
        encTransferInput,
        encTransferOutput,
        destinationchainid,
        permit
      );

      console.log(`Transaction hash: ${tx.hash}`);
      await tx.wait();
      console.log(`Bridge completed successfully`);
    }
  );
