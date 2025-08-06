import { task } from "hardhat/config";
import addresses from "../../config/addresses";
import { FhenixBridge } from "../../types";
import { cofhejs, Encryptable } from "cofhejs/node";
import { generateTransferFromPermit, appendMetadataToInput } from "../../utils";
import { EERC20 } from "../../types/contracts/token/eERC20.sol";

task("bridge", "Bridge cERC20 tokens to FHEVM")
  .addOptionalParam("signeraddress", "The address of the signer")
  .addOptionalParam("bridgeaddress", "The address of the bridge contract")
  .addOptionalParam("receiveraddress", "receiver address")
  .addOptionalParam("relayeraddress", "relayer address")
  .addOptionalParam("inputtokenaddress", "The address of the input token contract")
  .addOptionalParam("outputtokenaddress", "The address of the output token contract")
  .addOptionalParam("inputamount", "amount to bridge", "1000000") // 1 cERC20
  .addOptionalParam("outputamount", "amount intended to receive on the destination chain", "1000000") // 1 cERC20
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

      if (!outputtokenaddress) {
        if (addresses[+destinationchainid] === undefined) {
          throw new Error(
            `Please either provide the output token address or ensure the destination chain ID ${destinationchainid} is defined in addresses.ts`
          );
        }
        outputtokenaddress = addresses[+destinationchainid].cUSDC; // Default to deployed output token address
      }

      if (!receiveraddress) {
        receiveraddress = signerAddress; // Default to signer address
      }

      if (!relayeraddress) {
        relayeraddress = (await getNamedAccounts()).relayer; // Default to relayer address
      }

      const bridgeContract = (await ethers.getContractAt("FhenixBridge", bridgeaddress, signer)) as FhenixBridge;
      const tokenContract = (await ethers.getContractAt("eERC20", inputtokenaddress, signer)) as unknown as EERC20;

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
      const [encTransferInput, encTransferOutput] = await hre.cofhe.expectResultSuccess(encTransferResult);

      // permit creation
      const encTransferCtHashWMetadata = appendMetadataToInput(encTransferInput);
      const permit = await generateTransferFromPermit({
        token: tokenContract,
        signer,
        owner: signer.address,
        spender: bridgeaddress,
        valueHash: encTransferCtHashWMetadata,
      });

      console.log(permit.value_hash, encTransferInput.ctHash);

      const tx = await bridgeContract.bridge(
        signerAddress,
        signerAddress,
        relayeraddress,
        inputtokenaddress,
        outputtokenaddress,
        encTransferInput,
        encTransferOutput,
        destinationchainid,
        permit
      );

      console.log(
        `Bridging ${inputamount} cERC20 tokens from ${signerAddress} to ${receiveraddress} on chain ${destinationchainid}`
      );
      console.log(`Transaction hash: ${tx.hash}`);
      await tx.wait();
      console.log(`Bridging completed successfully. 🤌`);
    }
  );
