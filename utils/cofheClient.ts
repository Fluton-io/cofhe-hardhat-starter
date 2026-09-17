import { HardhatEthersSigner } from "@nomicfoundation/hardhat-ethers/signers";
import { HardhatSignerAdapter } from "@cofhe/sdk/adapters";
import { getChainById } from "@cofhe/sdk/chains";
import { createCofheClient, createCofheConfig } from "@cofhe/sdk/node";
import { CofheClient } from "@cofhe/sdk";
import { HardhatRuntimeEnvironment } from "hardhat/types";

/**
 * `hre.cofhe.createClientWithBatteries` always impersonates the mock ZK-verifier
 * signer (`hardhat_impersonateAccount`), which only exists on a local/forked
 * Hardhat node. On a real network (e.g. `eth-sepolia`) that RPC method doesn't
 * exist, so this builds a real TESTNET client directly against `@cofhe/sdk`
 * instead, talking to Fhenix's hosted CoFHE services.
 */
export const getCofheClient = async (
  hre: HardhatRuntimeEnvironment,
  signer: HardhatEthersSigner,
): Promise<CofheClient> => {
  const chainId = +(await hre.getChainId());
  const chain = getChainById(chainId);

  if (!chain) {
    throw new Error(`No @cofhe/sdk chain config found for chainId ${chainId}`);
  }

  if (chain.environment !== "TESTNET") {
    return hre.cofhe.createClientWithBatteries(signer);
  }

  const config = createCofheConfig({ environment: "node", supportedChains: [chain] });
  const client = createCofheClient(config);
  const { publicClient, walletClient } = await HardhatSignerAdapter(signer);
  await client.connect(publicClient, walletClient);
  await client.acp.createSelf({ issuer: signer.address });
  return client;
};
