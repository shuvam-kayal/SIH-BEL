import { getBytes, getAddress, hashMessage, recoverAddress, computeAddress } from "ethers";

const PUBLIC_KEY_BYTES = 64;
const SIGNATURE_BYTES = 65;
// SEC2 secp256k1 group order. Check compact signatures before ethers'
// recovery routine so high-s values are never silently normalized.
const SECP256K1_N = BigInt("0xFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFEBAAEDCE6AF48A03BBFD25E8CD0364141");
const SECP256K1_HALF_N = SECP256K1_N / 2n;

function canonicalHex(value: string, bytes: number, label: string): Uint8Array {
  if (typeof value !== "string") throw new Error(`${label} must be a hex string`);
  if (!value.startsWith("0x")) throw new Error(`${label} must use 0x-prefixed hexadecimal encoding`);
  const hex = value.slice(2);
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
  const r = BigInt(`0x${hex.slice(2, 66)}`);
  const s = BigInt(`0x${hex.slice(66)}`);
  if (r < 1n || r >= SECP256K1_N) throw new Error("signature r is outside secp256k1 range");
  if (s < 1n || s > SECP256K1_HALF_N) throw new Error("signature s is zero or not low-s");
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

