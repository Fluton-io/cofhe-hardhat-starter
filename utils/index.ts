import { TypedDataDomain, Signature } from "ethers";
import { FHERC20, IFHERC20 } from "../types";
import { HardhatEthersSigner } from "@nomicfoundation/hardhat-ethers/signers";
import { FheTypes } from "cofhejs/node";

export const sleep = (delay: number) => new Promise((resolve) => setTimeout(resolve, delay));

// temporary function for generating transfer from permit, delete when fhenix team adds this to sdk
type GeneratePermitOptions = {
  signer: HardhatEthersSigner;
  token: FHERC20;
  owner: string;
  spender: string;
  valueHash: bigint;
  nonce?: bigint;
  deadline?: bigint;
};

export const getNowTimestamp = () => {
  return BigInt(Date.now()) / 1000n;
};

export const generateTransferFromPermit = async (
  options: GeneratePermitOptions
): Promise<IFHERC20.FHERC20_EIP712_PermitStruct> => {
  let { token, signer, owner, spender, valueHash, nonce, deadline } = options;

  const { name, version, chainId, verifyingContract } = await token.eip712Domain();

  // If nonce is not provided, get it from the token
  if (nonce == null) nonce = await token.nonces(owner);

  // If deadline is not provided, set it to 24 hours from now
  if (deadline == null) deadline = getNowTimestamp() + BigInt(24 * 60 * 60);

  const domain: TypedDataDomain = {
    name,
    version,
    chainId,
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
    owner,
    spender,
    value_hash: valueHash,
    nonce: nonce,
    deadline: deadline,
  };

  const signature = await signer.signTypedData(domain, types, message);
  const { v, r, s } = Signature.from(signature);

  return {
    owner,
    spender,
    value_hash: valueHash,
    deadline: deadline,
    v,
    r,
    s,
  };
};
// Reserve 2 bytes for metadata (clears last 2 bytes of 256-bit word)
const HASH_MASK_FOR_METADATA = (1n << 256n) - 1n - 0xffffn; // 0xffff = 2^16 - 1

// Reserve 1 byte for security zone (lowest byte)
const SECURITY_ZONE_MASK = 0xffn; // type(uint8).max

// 7-bit uint type mask
const UINT_TYPE_MASK = 0xff >> 1; // 0x7f

// 1-bit trivially encrypted flag (MSB of a byte)
const TRIVIALLY_ENCRYPTED_MASK = 0xff - UINT_TYPE_MASK; // 0x80

// uintType mask positioned in the second-to-last byte
const SHIFTED_TYPE_MASK = BigInt(UINT_TYPE_MASK) << 8n; // 0x7f00n

// Helper function to encode isTrivial + uintType into a byte
const getByteForTrivialAndType = (isTrivial: boolean, uintType: number): number => {
  return (isTrivial ? TRIVIALLY_ENCRYPTED_MASK : 0x00) | (uintType & UINT_TYPE_MASK);
};

// Main function to append metadata
export const appendMetadata = (
  preCtHash: bigint,
  securityZone: number,
  uintType: number,
  isTrivial: boolean
): bigint => {
  const result = preCtHash & HASH_MASK_FOR_METADATA;

  // Emulate uint8(int8(securityZone)) in Solidity
  const securityZoneByte = BigInt(((securityZone << 24) >> 24) & 0xff);

  const metadata = (BigInt(getByteForTrivialAndType(isTrivial, uintType)) << 8n) | securityZoneByte;

  return result | metadata;
};

// Utility function that accepts an encrypted input
export const appendMetadataToInput = (encryptedInput: {
  ctHash: bigint;
  securityZone: number;
  utype: FheTypes;
}): bigint => {
  return appendMetadata(encryptedInput.ctHash, encryptedInput.securityZone, encryptedInput.utype, false);
};

// temporary part ends here
