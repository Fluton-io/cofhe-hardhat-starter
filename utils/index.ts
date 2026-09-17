import { HardhatRuntimeEnvironment } from "hardhat/types";

export const sleep = (delay: number) => new Promise((resolve) => setTimeout(resolve, delay));

/**
 * Resolves the chain id to use for `config/addresses.ts` lookups. Normally
 * this is just the connected network's real chain id. When running against
 * a local Hardhat fork, the network must keep reporting its natural chainId
 * (31337) for @cofhe/sdk's mock-vs-real detection to work, so there's no way
 * to make `hre.getChainId()` reflect the forked chain. Set ADDRESS_CHAIN_ID
 * to the forked chain's real id in that case instead.
 */
export const resolveAddressChainId = async (hre: HardhatRuntimeEnvironment): Promise<number> => {
  if (process.env.ADDRESS_CHAIN_ID) return +process.env.ADDRESS_CHAIN_ID;
  return +(await hre.getChainId());
};

/**
 * A `fromBlock` for `queryFilter` that stays within RPC providers' `eth_getLogs`
 * range caps (e.g. Infura's 10,000 block limit), instead of the default of
 * scanning from genesis.
 */
export const recentFromBlock = async (hre: HardhatRuntimeEnvironment, lookback = 9000): Promise<number> => {
  const latest = await hre.ethers.provider.getBlockNumber();
  return Math.max(0, latest - lookback);
};
