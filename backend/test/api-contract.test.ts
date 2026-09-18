import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import type { ApiClient } from "../../shared/api";
import { mockApi } from "../../mocks/mock-api/index";

const repoRoot = join(fileURLToPath(new URL(".", import.meta.url)), "../..");

describe("shared auth contract", () => {
  it("is implemented by the mock API", () => {
    const client: ApiClient = mockApi;
    for (const method of [
      "requestProvisioningChallenge", "initializeAccount", "requestAuthenticationChallenge",
      "getPendingRegistrations", "verifyRegistration", "assignRole", "activateRegistration",
      "registerDevice", "getDevices", "registerWallet", "getWallets", "activateWallet",
      "revokeWallet", "revokeDevice",
    ]) expect(typeof client[method as keyof ApiClient]).toBe("function");
  });

  it("documents proof login and excludes private-key fields", () => {
    const spec = readFileSync(join(repoRoot, "docs", "API_SPEC.yaml"), "utf8");
    expect(spec).toContain("oneOf:");
    expect(spec).toContain("required: [deviceCredential]");
    expect(spec).toContain("required: [deviceId, challengeId, publicKey, signature]");
    expect(spec).not.toMatch(/^\s+privateKey:/m);
  });

  it("documents cryptographic public-key/address binding", () => {
    for (const file of ["IDENTITY_AUTH_SPEC.md", "DATA_MODEL.md", "CONTRACT_SPEC.md", "TEAM_INTEGRATION_CONTRACT.md"]) {
      const text = readFileSync(join(repoRoot, "docs", file), "utf8");
      expect(text).toContain("cryptographically validated by the wallet/blockchain integration adapter before activation");
    }
  });
});
