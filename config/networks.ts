import contracts from "./contracts";

const networks = [
  {
    name: "Ethereum Sepolia Testnet",
    id: "eth-sepolia",
    chainId: 11155111,
    contracts: contracts[11155111],
    layerzeroEid: 40161,
  },
  {
    name: "Arbitrum Sepolia Testnet",
    id: "arb-sepolia",
    chainId: 421614,
    contracts: contracts[421614],
    layerzeroEid: 40231,
  },
  {
    name: "Base Sepolia Testnet",
    id: "base-sepolia",
    chainId: 84532,
    contracts: contracts[84532],
    layerzeroEid: 40245,
  },
];

export default networks;
