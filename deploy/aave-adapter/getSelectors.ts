import { Contract } from "ethers";

export function getSelectors(contract: Contract) {
  const signatures = contract.interface.fragments
    .filter((fragment) => fragment.type === "function")
    .map((fragment) => fragment.format());
  const selectors = signatures.reduce((acc: string[], val: string) => {
    const selector = contract.interface.getFunction(val)?.selector;
    if (selector) {
      acc.push(selector);
    }
    return acc;
  }, []);

  return selectors;
}
