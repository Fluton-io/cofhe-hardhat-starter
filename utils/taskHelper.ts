import { HardhatRuntimeEnvironment } from "hardhat/types";
import { Signer } from "ethers";
import { EERC20, SimpleERC20 } from "../types";
import addresses from "../config/addresses";

export class TaskHelper {
  constructor(
    private hre: HardhatRuntimeEnvironment,
    private signer: Signer,
    private chainId: string
  ) {}

  /**
   * Ensures the user has sufficient eERC20 balance for bridging
   * Automatically mints ERC20 -> wraps to eERC20 if needed
   */
  async ensureEErc20Balance(
    requiredAmount: string,
    tokenAddress?: string
  ): Promise<string> {
    const { ethers, deployments, getNamedAccounts } = this.hre;
    const signerAddress = await this.signer.getAddress();

    // Get eERC20 token address
    let eErc20Address = tokenAddress;
    if (!eErc20Address) {
      try {
        const eErc20Deployment = await deployments.get("eERC20");
        eErc20Address = eErc20Deployment.address;
      } catch {
        eErc20Address = addresses[+this.chainId]?.eTEST_TOKEN;
        if (!eErc20Address) {
          throw new Error(
            "eERC20 token not found. Please deploy eERC20 or provide token address"
          );
        }
      }
    }

    const eErc20Contract = (await ethers.getContractAt(
      "eERC20",
      eErc20Address,
      this.signer
    )) as unknown as EERC20;

    // Check current eERC20 balance
    const eErc20Balance = await eErc20Contract.balanceOf(signerAddress);
    const requiredAmountBigInt = BigInt(requiredAmount);

    if (eErc20Balance >= requiredAmountBigInt) {
      return eErc20Address;
    }

    // Need to wrap more eERC20
    const shortfall = requiredAmountBigInt - eErc20Balance;

    // Get underlying ERC20 address
    const erc20Address = await eErc20Contract.erc20();
    const erc20Contract = (await ethers.getContractAt(
      "SimpleERC20",
      erc20Address,
      this.signer
    )) as SimpleERC20;

    // Check ERC20 balance
    const erc20Balance = await erc20Contract.balanceOf(signerAddress);

    if (erc20Balance < shortfall) {
      // Need to mint more ERC20
      const erc20Shortfall = shortfall - erc20Balance;

      try {
        const mintTx = await erc20Contract.mint(signerAddress, erc20Shortfall);
        await mintTx.wait();
      } catch (error) {
        throw new Error(
          `Cannot mint ERC20 tokens. You may not have permission.`
        );
      }
    }

    // Approve eERC20 contract to spend ERC20 if needed
    const allowance = await erc20Contract.allowance(
      signerAddress,
      eErc20Address
    );
    if (allowance < shortfall) {
      const approveTx = await erc20Contract.approve(eErc20Address, shortfall);
      await approveTx.wait();
    }

    // Wrap ERC20 to eERC20
    const wrapTx = await eErc20Contract.wrap(signerAddress, shortfall);
    await wrapTx.wait();

    return eErc20Address;
  }

  /**
   * Ensures the relayer has sufficient eERC20 balance for fulfilling
   */
  async ensureRelayerEErc20Balance(
    requiredAmount: string,
    relayerAddress: string,
    tokenAddress?: string
  ): Promise<string> {
    const { ethers, deployments } = this.hre;
    const relayerSigner = await ethers.getSigner(relayerAddress);

    // Create a new TaskHelper instance for the relayer
    const relayerHelper = new TaskHelper(this.hre, relayerSigner, this.chainId);
    return await relayerHelper.ensureEErc20Balance(
      requiredAmount,
      tokenAddress
    );
  }

  /**
   * Gets contract addresses with fallback logic
   */
  async getContractAddress(
    contractName: string,
    addressKey?: string
  ): Promise<string> {
    const { deployments } = this.hre;

    try {
      const deployment = await deployments.get(contractName);
      return deployment.address;
    } catch {
      const fallbackAddress =
        addresses[+this.chainId]?.[addressKey || contractName];
      if (!fallbackAddress) {
        throw new Error(
          `${contractName} not found. Please deploy it or add to addresses.ts`
        );
      }
      return fallbackAddress;
    }
  }

  /**
   * Validates and gets named accounts with fallbacks
   */
  async getAccountAddress(
    accountName: string,
    fallback?: string
  ): Promise<string> {
    const { getNamedAccounts } = this.hre;
    const accounts = await getNamedAccounts();

    const address =
      accounts[accountName] || fallback || (await this.signer.getAddress());
    if (!address) {
      throw new Error(`Account ${accountName} not found in named accounts`);
    }

    return address;
  }
}

/**
 * Factory function to create TaskHelper instances
 */
export async function createTaskHelper(
  hre: HardhatRuntimeEnvironment,
  signerAddress?: string
): Promise<TaskHelper> {
  const { ethers, getChainId, getNamedAccounts } = hre;
  const chainId = await getChainId();
  const resolvedSignerAddress =
    signerAddress || (await getNamedAccounts()).user;
  const signer = await ethers.getSigner(resolvedSignerAddress);

  return new TaskHelper(hre, signer, chainId);
}
