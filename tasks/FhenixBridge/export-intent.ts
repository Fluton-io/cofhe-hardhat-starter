import { task } from "hardhat/config";
import fs from "fs";
import path from "path";
import addresses from "../../config/addresses";
import { FhenixBridge } from "../../types";
import { cofhejs, FheTypes } from "cofhejs/node";

task("export-intent", "Export an intent from the bridge contract")
  .addParam("intentid", "The intentId to export")
  .addOptionalParam("bridgeaddress", "The address of the bridge contract ")
  .addOptionalParam("outfile", "The output JSON file path", "intent.json")
  .addOptionalParam(
    "signeraddress",
    "The address of the relayer (who has permission to decrypt)"
  )
  .setAction(
    async ({ intentid, bridgeaddress, outfile, signeraddress }, hre) => {
      const { ethers, deployments, getChainId, getNamedAccounts, cofhe } = hre;
      const chainId = await getChainId();
      const signerAddress = signeraddress || (await getNamedAccounts()).relayer;
      const signer = await ethers.getSigner(signerAddress);

      let bridgeAddr = bridgeaddress;
      if (!bridgeAddr) {
        bridgeAddr = addresses[+chainId]?.FhenixBridge;
        if (!bridgeAddr) {
          try {
            const bridgeDeployment = await deployments.get("FhenixBridge");
            bridgeAddr = bridgeDeployment.address;
          } catch {
            console.log(
              "Bridge address not found. Please provide --bridgeaddress or set it in config/addresses.ts"
            );
            return;
          }
        }
      }

      const bridgeContract = (await ethers.getContractAt(
        "FhenixBridge",
        bridgeAddr,
        signer
      )) as FhenixBridge;

      const intent = await bridgeContract.getIntent(intentid);
      console.log(`Intent: `, intent);
      if (!intent) {
        console.log(`Intent with id ${intentid} not found.`);
        return;
      }

      // Initialize cofhejs for unsealing
      await cofhe.expectResultSuccess(
        await cofhejs.initializeWithEthers({
          ethersProvider: ethers.provider,
          ethersSigner: signer,
          environment: "TESTNET",
        })
      );

      // Unseal the output amount (relayer has permission)
      console.log(`Unsealing output amount...`);
      const unsealResult = await cofhejs.unseal(
        intent.outputAmount,
        FheTypes.Uint128
      );

      if (!unsealResult.success) {
        console.error(
          `Failed to unseal output amount: ${unsealResult.error?.message}`
        );
        console.log(
          `Make sure the signer (${signer.address}) is the relayer with decrypt permissions.`
        );
        return;
      }

      const plainOutputAmount = unsealResult.data.toString();
      console.log(`Unsealed output amount: ${plainOutputAmount}`);

      // Convert BigInt/BigNumber fields to string for JSON serialization
      function replacer(key: string, value: any) {
        if (typeof value === "bigint") {
          return value.toString();
        }
        // ethers.BigNumber
        if (value && typeof value === "object" && value._isBigNumber) {
          return value.toString();
        }
        return value;
      }

      const exportObj = {
        intent,
        plainOutputAmount, // Plain text output amount for the solver
      };

      const outPath = path.resolve(process.cwd(), outfile);
      fs.writeFileSync(outPath, JSON.stringify(exportObj, replacer, 2));
      console.log(
        `Intent ${intentid} with plain output amount exported to ${outPath}`
      );
    }
  );
