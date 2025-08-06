import type { HardhatUserConfig } from "hardhat/config";
import { vars } from "hardhat/config";
import "@nomicfoundation/hardhat-toolbox";
import "@nomicfoundation/hardhat-ethers";
import "@nomicfoundation/hardhat-verify";
import "cofhe-hardhat-plugin";
import "hardhat-deploy";

import "./tasks";

const MNEMONIC: string = vars.get("MNEMONIC", "test test test test test test test test test test test junk");
const INFURA_API_KEY: string = vars.get("INFURA_API_KEY");
const ETHERSCAN_API_KEY: string = vars.get("ETHERSCAN_API_KEY");
const ARBISCAN_API_KEY: string = vars.get("ARBISCAN_API_KEY");

const DEPLOYER_PRIVATE_KEY = vars.get("DEPLOYER_PRIVATE_KEY");
const USER_PRIVATE_KEY = vars.get("USER_PRIVATE_KEY");
const RELAYER_PRIVATE_KEY = vars.get("RELAYER_PRIVATE_KEY");

const accounts = [DEPLOYER_PRIVATE_KEY, USER_PRIVATE_KEY, RELAYER_PRIVATE_KEY];

const config: HardhatUserConfig = {
  defaultNetwork: "arb-sepolia",
  namedAccounts: {
    deployer: 0,
    user: 1,
    relayer: 2,
  },
  solidity: {
    version: "0.8.25",
    settings: {
      evmVersion: "cancun",
      optimizer: {
        enabled: true,
        runs: 200,
      },
      viaIR: true,
    },
  },
  // defaultNetwork: 'localcofhe',
  networks: {
    // Sepolia testnet configuration
    "eth-sepolia": {
      url: `https://sepolia.infura.io/v3/${INFURA_API_KEY}`,
      accounts,
      chainId: 11155111,
      gasMultiplier: 1.2,
      timeout: 60000,
      httpHeaders: {},
    },

    // Arbitrum Sepolia testnet configuration
    "arb-sepolia": {
      url: `https://arbitrum-sepolia.infura.io/v3/${INFURA_API_KEY}`,
      accounts,
      chainId: 421614,
      gasMultiplier: 1.2,
      timeout: 60000,
      httpHeaders: {},
    },
  },

  // Etherscan verification config
  etherscan: {
    apiKey: {
      "eth-sepolia": ETHERSCAN_API_KEY,
      "arb-sepolia": ARBISCAN_API_KEY,
    },
    customChains: [
      {
        network: "arb-sepolia",
        chainId: 421614,
        urls: {
          apiURL: "https://api-sepolia.arbiscan.io/api",
          browserURL: "https://sepolia.arbiscan.io/",
        },
      },
    ],
  },
  typechain: {
    outDir: "types",
    target: "ethers-v6",
  },
};

export default config;
