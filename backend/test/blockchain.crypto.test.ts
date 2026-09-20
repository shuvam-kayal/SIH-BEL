import { describe, expect, it } from "vitest";
import { hashMessage, SigningKey, Wallet } from "ethers";
import { assertWalletMatchesPublicKey, parseCompactSignature, publicKeyToEvmAddress, verifyCompactSignature } from "../src/blockchain/crypto";

const PRIVATE_KEY = "0x59c6995e998f97a5a0044976f0945389dc9e86dae88c7a6f2e5f4b9c3c4f3f3a";
const wallet = new Wallet(PRIVATE_KEY);
const publicKey = `0x${SigningKey.computePublicKey(PRIVATE_KEY, false).slice(4)}`;

describe("frozen BEL EVM crypto representation", () => {
  it("derives the expected address from exactly X || Y", () => {
    expect(publicKey).toHaveLength(130);
    expect(publicKeyToEvmAddress(publicKey)).toBe(wallet.address);
  });

  it("rejects the SEC1 04 || X || Y form as canonical input", () => {
    expect(() => publicKeyToEvmAddress(`0x04${publicKey.slice(2)}`)).toThrow();
  });

  it("rejects a mismatched public key and address", () => {
    expect(() => assertWalletMatchesPublicKey("0x0000000000000000000000000000000000000001", publicKey)).toThrow();
  });

  it("accepts yParity || r || s and rejects invalid yParity", async () => {
    const signed = new SigningKey(PRIVATE_KEY).sign(hashMessage("challenge"));
    const compact = `0x${signed.yParity.toString(16).padStart(2, "0")}${signed.r.slice(2)}${signed.s.slice(2)}`;
    expect(parseCompactSignature(compact).yParity).toBe(signed.yParity);
    expect(verifyCompactSignature("challenge", publicKey, compact)).toBe(true);
    expect(() => parseCompactSignature(`0x02${signed.r.slice(2)}${signed.s.slice(2)}`)).toThrow();
  });

  it("rejects malformed public keys and signatures", () => {
    expect(() => publicKeyToEvmAddress("0x00")).toThrow();
    expect(() => parseCompactSignature("0x00")).toThrow();
    expect(verifyCompactSignature("challenge", publicKey, "0x00")).toBe(false);
  });

  it("rejects invalid secp256k1 points and mismatched key lengths", () => {
    expect(() => publicKeyToEvmAddress(`0x${"00".repeat(64)}`)).toThrow();
    expect(() => publicKeyToEvmAddress(`0x${"11".repeat(63)}`)).toThrow();
    expect(() => publicKeyToEvmAddress(`0x${"11".repeat(65)}`)).toThrow();
    expect(() => publicKeyToEvmAddress(`04${publicKey.slice(2)}`)).toThrow();
  });

  it("rejects zero, out-of-range, and high-s compact signatures", () => {
    const signed = new SigningKey(PRIVATE_KEY).sign(hashMessage("challenge"));
    const n = BigInt("0xFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFEBAAEDCE6AF48A03BBFD25E8CD0364141");
    const halfN = n / 2n;
    const compact = (yParity: number, r: bigint, s: bigint) => `0x${yParity.toString(16).padStart(2, "0")}${r.toString(16).padStart(64, "0")}${s.toString(16).padStart(64, "0")}`;
    const r = BigInt(signed.r);
    const s = BigInt(signed.s);
    expect(verifyCompactSignature("challenge", publicKey, compact(signed.yParity, 0n, s))).toBe(false);
    expect(verifyCompactSignature("challenge", publicKey, compact(signed.yParity, n, s))).toBe(false);
    expect(verifyCompactSignature("challenge", publicKey, compact(signed.yParity, r, 0n))).toBe(false);
    expect(verifyCompactSignature("challenge", publicKey, compact(signed.yParity, r, halfN + 1n))).toBe(false);
    // (r, n-s, 1-yParity) is the mathematically equivalent high-s ECDSA
    // signature for the same digest; the frozen wire format must still reject it.
    expect(verifyCompactSignature("challenge", publicKey, compact(1 - signed.yParity, r, n - s))).toBe(false);
    expect(verifyCompactSignature("challenge", publicKey, compact(signed.yParity, r, s))).toBe(true);
  });

  it("accepts the exact Ethereum signMessage compact wire format and rejects another signer", async () => {
    const other = new Wallet("0x8b3a350cf5c34c9194ca3a545d1f7c7d6e2b6e8c0b3f2a1d5c6e7f8091a2b3c4");
    const message = "challenge";
    const signed = await new Wallet(PRIVATE_KEY).signMessage(message);
    const parsed = signed.slice(2);
    const v = Number.parseInt(parsed.slice(128, 130), 16);
    const compact = `0x${(v - 27).toString(16).padStart(2, "0")}${parsed.slice(0, 64)}${parsed.slice(64, 128)}`;
    expect(verifyCompactSignature(message, publicKey, compact)).toBe(true);
    const otherSigned = await other.signMessage(message);
    const otherParsed = otherSigned.slice(2);
    const otherV = Number.parseInt(otherParsed.slice(128, 130), 16);
    const otherCompact = `0x${(otherV - 27).toString(16).padStart(2, "0")}${otherParsed.slice(0, 64)}${otherParsed.slice(64, 128)}`;
    expect(verifyCompactSignature(message, publicKey, otherCompact)).toBe(false);
  });
});
