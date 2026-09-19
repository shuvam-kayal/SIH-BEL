import { describe, expect, it } from "vitest";
import { hashMessage, SigningKey, Wallet } from "ethers";
import { assertWalletMatchesPublicKey, parseCompactSignature, publicKeyToEvmAddress, verifyCompactSignature } from "../src/blockchain/crypto";

const PRIVATE_KEY = "0x59c6995e998f97a5a0044976f0945389dc9e86dae88c7a6f2e5f4b9c3c4f3f3a";
const wallet = new Wallet(PRIVATE_KEY);
const publicKey = SigningKey.computePublicKey(PRIVATE_KEY, false).slice(4);

describe("frozen BEL EVM crypto representation", () => {
  it("derives the expected address from exactly X || Y", () => {
    expect(publicKey).toHaveLength(128);
    expect(publicKeyToEvmAddress(publicKey)).toBe(wallet.address);
  });

  it("rejects the SEC1 04 || X || Y form as canonical input", () => {
    expect(() => publicKeyToEvmAddress(`04${publicKey}`)).toThrow();
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
    expect(() => publicKeyToEvmAddress("00")).toThrow();
    expect(() => parseCompactSignature("0x00")).toThrow();
    expect(verifyCompactSignature("challenge", publicKey, "0x00")).toBe(false);
  });
});
