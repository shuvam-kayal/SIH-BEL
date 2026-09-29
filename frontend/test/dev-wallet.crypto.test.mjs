import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { verifyMessage } from "ethers";
import { loadOrCreateDevice, signChallenge } from "../dev-wallet/wallet.mjs";

const challenge = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmno_12".slice(0, 43);

describe("development BEL wallet crypto", () => {
  let directory;
  let previousDirectory;
  let previousSecret;
  beforeEach(() => { directory = mkdtempSync(join(tmpdir(), "bel-dev-wallet-")); previousDirectory = process.env.BEL_DEV_WALLET_DIR; previousSecret = process.env.BEL_DEV_WALLET_SECRET; process.env.BEL_DEV_WALLET_DIR = directory; process.env.BEL_DEV_WALLET_SECRET = "development-secret-strong"; });
  afterEach(() => { if (previousDirectory === undefined) delete process.env.BEL_DEV_WALLET_DIR; else process.env.BEL_DEV_WALLET_DIR = previousDirectory; if (previousSecret === undefined) delete process.env.BEL_DEV_WALLET_SECRET; else process.env.BEL_DEV_WALLET_SECRET = previousSecret; rmSync(directory, { recursive: true, force: true }); });

  it("creates isolated ADR-024 identities and verifies compact EIP-191 signatures", async () => {
    const admin = loadOrCreateDevice("admin-device");
    const employee = loadOrCreateDevice("employee-001-device");
    expect(admin.identity.publicKey).toMatch(/^0x[0-9a-f]{128}$/i);
    expect(admin.identity.walletAddress).toMatch(/^0x[0-9a-f]{40}$/i);
    expect(admin.identity).not.toEqual(employee.identity);
    const signed = await signChallenge("admin-device", challenge, { operation: "AUTHENTICATION", requireUserVerification: true });
    const compact = signed.signature.slice(2);
    expect(compact).toMatch(/^[0-9a-f]{130}$/i);
    const yParity = Number.parseInt(compact.slice(0, 2), 16);
    const r = compact.slice(2, 66); const s = compact.slice(66);
    const standard = `0x${r}${s}${(27 + yParity).toString(16).padStart(2, "0")}`;
    expect(verifyMessage(challenge, standard)).toBe(admin.identity.walletAddress);
    expect(signed.userVerified).toBeUndefined();
    expect(signed.developmentUserVerification).toBe(true);
  });

  it("rejects malformed challenge and missing verification requirement", async () => {
    await expect(signChallenge("admin-device", "short", { operation: "AUTHENTICATION", requireUserVerification: true })).rejects.toThrow(/43-character/);
    await expect(signChallenge("admin-device", challenge, { operation: "AUTHENTICATION", requireUserVerification: false })).rejects.toThrow(/requireUserVerification/);
  });
});
