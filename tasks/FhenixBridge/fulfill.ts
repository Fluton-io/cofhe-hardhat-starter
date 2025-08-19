import { task } from "hardhat/config";
import { FhenixBridge } from "../../types";
import { generateTransferFromPermit, appendMetadataToInput } from "../../utils";
import { EERC20 } from "../../types";
import { createTaskHelper } from "../../utils/taskHelper";
import { cofhejs, Encryptable } from "cofhejs/node";

task("fulfill", "Fulfill a bridge intent on the destination chain")
  .addOptionalParam("signeraddress", "The address of the relayer (msg.sender)")
  .addOptionalParam("bridgeaddress", "The address of the bridge contract")
  .addOptionalParam(
    "outputamount",
    "Amount to transfer to the receiver (plain, will be encrypted, overrides intent if provided)"
  )
  .setAction(async ({ signeraddress, bridgeaddress, outputamount }, hre) => {
    const fs = require("fs");
    const path = require("path");
    const { ethers, deployments, getChainId, getNamedAccounts, cofhe } = hre;

    const signerAddress = signeraddress || (await getNamedAccounts()).relayer;
    const signer = await ethers.getSigner(signerAddress);

    // Create task helper
    const taskHelper = await createTaskHelper(hre, signeraddress);

    // Auto-resolve bridge address
    const bridgeAddr =
      bridgeaddress || (await taskHelper.getContractAddress("FhenixBridge"));

    const bridgeContract = (await ethers.getContractAt(
      "FhenixBridge",
      bridgeAddr,
      signer
    )) as unknown as FhenixBridge;

    const intentPath = path.resolve(process.cwd(), "intent.json");
    if (!fs.existsSync(intentPath)) {
      console.log(`Intent file not found: ${intentPath}`);
      return;
    }

    const intentJson = JSON.parse(fs.readFileSync(intentPath, "utf8"));
    const intentArr = intentJson.intent;
    const plainOutputAmount = intentJson.plainOutputAmount;

    if (!Array.isArray(intentArr) || intentArr.length < 13) {
      console.log(
        "intent.intent must be an array of at least 13 elements (see contract struct order)"
      );
      return;
    }
    if (!plainOutputAmount) {
      console.log("No plainOutputAmount found in intent.json");
      return;
    }

    // Map array to struct fields (see FhenixBridge.Intent struct)
    const intent = {
      sender: intentArr[0],
      receiver: intentArr[1],
      relayer: intentArr[2],
      inputToken: intentArr[3],
      outputToken: intentArr[4],
      inputAmount: intentArr[5],
      outputAmount: intentArr[6],
      id: intentArr[7],
      originChainId: intentArr[8],
      destinationChainId: intentArr[9],
      filledStatus: intentArr[10],
      solverPaid: intentArr[11],
      timeout: intentArr[12],
    };

    console.log(
      "Ensuring relayer has sufficient eERC20 balance for fulfillment"
    );

    // Ensure relayer has sufficient eERC20 balance for fulfillment
    await taskHelper.ensureEErc20Balance(plainOutputAmount, intent.outputToken);

    // Initialize cofhejs for encryption
    await cofhe.expectResultSuccess(
      await cofhejs.initializeWithEthers({
        ethersProvider: ethers.provider,
        ethersSigner: signer,
        environment: "TESTNET",
      })
    );

    // Encrypt the plain output amount for permit creation
    const encOutputResult = await cofhejs.encrypt([
      Encryptable.uint128(plainOutputAmount),
    ] as const);
    const [encOutputAmount] = await hre.cofhe.expectResultSuccess(
      encOutputResult
    );

    // permit creation for output token
    const outputTokenContract = (await ethers.getContractAt(
      "eERC20",
      intent.outputToken,
      signer
    )) as unknown as EERC20;

    const permit = await generateTransferFromPermit({
      token: outputTokenContract,
      signer,
      owner: signer.address,
      spender: bridgeAddr,
      valueHash: encOutputAmount.ctHash,
    });

    // Call fulfill
    const tx = await bridgeContract.fulfill(intent, permit);
    console.log(`Transaction hash: ${tx.hash}`);
    await tx.wait();
    console.log(`Fulfill completed successfully`);
  });
