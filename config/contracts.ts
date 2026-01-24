import addresses from "./addresses";

const contracts = {
  11155111: {
    fhevmBridge: { address: addresses[11155111].FHEVMBridge },
    cofheBridge: { address: addresses[11155111].CoFHEBridge },
    defaultBridge: { address: addresses[11155111].FHEVMBridge },
  },
  421614: {
    cofheBridge: { address: addresses[421614].CoFHEBridge },
    defaultBridge: { address: addresses[421614].CoFHEBridge },
  },
  84532: {
    cofheBridge: { address: addresses[84532].CoFHEBridge },
    defaultBridge: { address: addresses[84532].CoFHEBridge },
  },
};

export default contracts;
