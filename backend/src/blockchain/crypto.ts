import { getBytes, getAddress, hashMessage, recoverAddress, computeAddress } from "ethers";

const PUBLIC_KEY_BYTES = 64;
const SIGNATURE_BYTES = 65;

function canonicalHex(value: string, bytes: number, label: string): Uint8Array {
  if (typeof value !== "string") throw new Error(`${label} must be a hex string`);
  const hex = value.startsWith("0x") || value.startsWith("0X") ? value.slice(2) : value;
  if (!new RegExp(`^[0-9a-fA-F]{${bytes * 2}}$`).test(hex)) {
    throw new Error(`${label} must be exactly ${bytes} bytes of hexadecimal data`);
  }
  return getBytes(`0x${hex}`);
}

/** Frozen BEL representation: secp256k1 X || Y, with no SEC1 04 prefix. */
export function publicKeyToEvmAddress(publicKey: string): string {
  const xy = canonicalHex(publicKey, PUBLIC_KEY_BYTES, "publicKey");
  return getAddress(computeAddress(`0x04${Buffer.from(xy).toString("hex")}`));
}

/** Frozen BEL representation: yParity || r || s, where yParity is 0 or 1. */
export function parseCompactSignature(signature: string): { yParity: 0 | 1; r: string; s: string } {
  const bytes = canonicalHex(signature, SIGNATURE_BYTES, "signature");
  const yParity = bytes[0];
  if (yParity !== 0 && yParity !== 1) throw new Error("signature yParity must be 0 or 1");
  const hex = Buffer.from(bytes).toString("hex");
  return { yParity, r: `0x${hex.slice(2, 66)}`, s: `0x${hex.slice(66)}` };
}

export function assertWalletMatchesPublicKey(address: string, publicKey: string): string {
  const expected = publicKeyToEvmAddress(publicKey);
  if (getAddress(address) !== expected) throw new Error("wallet address does not match public key");
  return expected;
}

export function verifyCompactSignature(message: string, publicKey: string, signature: string): boolean {
  try {
    const expected = publicKeyToEvmAddress(publicKey);
    const { yParity, r, s } = parseCompactSignature(signature);
    return getAddress(recoverAddress(hashMessage(message), { r, s, v: 27 + yParity })) === expected;
  } catch {
    return false;
  }
}

