import { task } from "hardhat/config";
import addresses from "../../config/addresses";
import { EERC20 } from "../../types";
import { cofhejs, Encryptable } from "cofhejs/node";

task("encTransferFrom", "Transfer eERC20 tokens to another address")
  .addOptionalParam("signeraddress", "The address of the signer")
  .addOptionalParam("tokenaddress", "The address of the token contract")
  .addOptionalParam("to", "The address to send the wrapped tokens")
  .addOptionalParam("amount", "The amount of tokens to wrap", "1000000000000000000")
  .setAction(async ({ signeraddress, tokenaddress, to, amount }, hre) => {
    const { ethers, getChainId, deployments, getNamedAccounts, cofhe } = hre;
    const chainId = await getChainId();
    const signerAddress = signeraddress || (await getNamedAccounts()).user;
    const signer = await ethers.getSigner(signerAddress);

    if (!to) {
      to = signer.address;
    }

    if (!tokenaddress) {
      const tokenDeployment = await deployments.get("eERC20");
      tokenaddress = tokenDeployment.address || addresses[+chainId].eUSDC; // Default to deployed
    }

    await cofhe.expectResultSuccess(
      await cofhejs.initializeWithEthers({
        ethersProvider: ethers.provider,
        ethersSigner: signer,
        environment: "TESTNET",
      })
    );

    const encTransferResult = await cofhejs.encrypt([Encryptable.uint128(amount)] as const);

    if (!encTransferResult.success) {
      console.error("Failed to encrypt transfer amount:", encTransferResult.error);
      return;
    }

    const [encTransferInput] = await hre.cofhe.expectResultSuccess(encTransferResult);

    // Generate permit
    const eTokenContract = (await ethers.getContractAt("eERC20", tokenaddress, signer)) as unknown as EERC20;
    const { name, version, chainId: eip712ChainId, verifyingContract } = await eTokenContract.eip712Domain();

    const nonce = await eTokenContract.nonces(signer.address);
    const getNowTimestamp = () => BigInt(Date.now()) / 1000n;
    const deadline = getNowTimestamp() + BigInt(24 * 60 * 60);

    const domain = {
      name,
      version,
      chainId: eip712ChainId,
      verifyingContract,
    };

    const types = {
      Permit: [
        { name: "owner", type: "address" },
        { name: "spender", type: "address" },
        { name: "value_hash", type: "uint256" },
        { name: "nonce", type: "uint256" },
        { name: "deadline", type: "uint256" },
      ],
    };

    const message = {
      owner: signer.address,
      spender: signer.address,
      value_hash: encTransferInput.ctHash,
      nonce: nonce,
      deadline: deadline,
    };

    const signature = await signer.signTypedData(domain, types, message);
    const { v, r, s } = ethers.Signature.from(signature);

    const permit = {
      owner: signer.address,
      spender: signer.address,
      value_hash: encTransferInput.ctHash,
      deadline: deadline,
      v,
      r,
      s,
    };

    // Execute the transfer
    const transferTx = await eTokenContract.encTransferFromDirect(signer.address, to, encTransferInput, permit);

    console.log(`Transaction: ${transferTx.hash}`);
  });
