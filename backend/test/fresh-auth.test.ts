import { generateKeyPairSync, sign } from "node:crypto";
import { beforeEach, describe, expect, it } from "vitest";
import request from "supertest";
import { MockBlockchainAdapter } from "../../mocks/mock-blockchain";
import { createContainer } from "../src/container";
import { clearIdentityStore, identityStore } from "../src/users/identity.store";
import { createMemoryRepositories } from "../src/users/repository-implementations";

const proof = (privateKey: ReturnType<typeof generateKeyPairSync>["privateKey"], challenge: string) =>
  sign(null, Buffer.from(challenge), privateKey).toString("base64url");

describe("fresh authentication", () => {
  beforeEach(() => clearIdentityStore());

  async function setup() {
    const repositories = createMemoryRepositories(identityStore);
    const container = createContainer(new MockBlockchainAdapter(), { repositories });
    const keys = generateKeyPairSync("ec", { namedCurve: "secp256k1" });
    const publicKey = keys.publicKey.export({ type: "spki", format: "pem" }).toString();
    await container.users.createUser({ identityId: "DID:BEL:FRESH", employeeId: "FRESH", fullName: "Fresh Auth", role: "ADMIN", department: "TEST" });
    await container.users.registerDevice("FRESH", "FRESH-DEVICE", "fresh-credential", publicKey);
    await container.users.registerWallet("FRESH", "FRESH-DEVICE", "0xFRESH-WALLET");
    await container.users.activateWallet("FRESH", "FRESH-DEVICE", "0xFRESH-WALLET");
    const session = await container.auth.login("fresh-credential");
    return { container, keys, publicKey, token: session.token };
  }

  it("requires an active session and consumes a proof once, bound to operation and resource", async () => {
    const { container, keys, publicKey, token } = await setup();
    const challenge = await container.auth.requestFreshAuthenticationChallenge(token, "ASSET_TRANSFER", "AST-001");
    await container.auth.verifyFreshAuthentication(token, { challengeId: challenge.challengeId, publicKey, signature: proof(keys.privateKey, challenge.challenge) }, "ASSET_TRANSFER", "AST-001");
    await expect(container.auth.verifyFreshAuthentication(token, { challengeId: challenge.challengeId, publicKey, signature: proof(keys.privateKey, challenge.challenge) }, "ASSET_TRANSFER", "AST-001"))
      .rejects.toMatchObject({ code: "UNAUTHORIZED" });
  });

  it("rejects wrong operation, wrong signature, expiry, and revoked sessions", async () => {
    const { container, keys, publicKey, token } = await setup();
    const wrongOperation = await container.auth.requestFreshAuthenticationChallenge(token, "ASSET_TRANSFER", "AST-002");
    await expect(container.auth.verifyFreshAuthentication(token, { challengeId: wrongOperation.challengeId, publicKey, signature: proof(keys.privateKey, wrongOperation.challenge) }, "ROLE_ASSIGN", "AST-002"))
      .rejects.toMatchObject({ code: "UNAUTHORIZED" });
    const invalid = await container.auth.requestFreshAuthenticationChallenge(token, "ASSET_TRANSFER", "AST-003");
    await expect(container.auth.verifyFreshAuthentication(token, { challengeId: invalid.challengeId, publicKey, signature: proof(keys.privateKey, "wrong") }, "ASSET_TRANSFER", "AST-003"))
      .rejects.toMatchObject({ code: "UNAUTHORIZED" });
    const expired = await container.auth.requestFreshAuthenticationChallenge(token, "ASSET_TRANSFER", "AST-004");
    const stored = await container.repositories.challenges.findById(expired.challengeId);
    await container.repositories.challenges.save({ ...stored!, expiresAt: new Date(Date.now() - 1).toISOString() });
    await expect(container.auth.verifyFreshAuthentication(token, { challengeId: expired.challengeId, publicKey, signature: proof(keys.privateKey, expired.challenge) }, "ASSET_TRANSFER", "AST-004"))
      .rejects.toMatchObject({ code: "UNAUTHORIZED" });
    await container.auth.logout(token);
    const afterLogout = await container.auth.requestFreshAuthenticationChallenge(token, "ASSET_TRANSFER", "AST-005").catch((error) => error);
    expect(afterLogout).toMatchObject({ code: "UNAUTHORIZED" });
  });

  it("gates a configured high-impact route without changing normal session authentication", async () => {
    const previous = process.env.BEL_FRESH_AUTH_REQUIRED_ACTIONS;
    process.env.BEL_FRESH_AUTH_REQUIRED_ACTIONS = "ASSET_TRANSFER";
    try {
      const { container, keys, publicKey, token } = await setup();
      await container.assets.create({ assetId: "AST-FRESH", assetType: "TOOL", ownerId: "DID:BEL:FRESH", custodianId: "DID:BEL:FRESH" }, { identityId: "DID:BEL:FRESH", walletAddress: "0xFRESH-WALLET" });
      const app = (await import("../src/app")).createApp(container);
      const denied = await request(app).post("/assets/AST-FRESH/transfer").set("Authorization", `Bearer ${token}`).send({ newOwnerId: "DID:BEL:NEW" });
      expect(denied.status).toBe(401);
      const challenge = await request(app).post("/auth/fresh-challenge").set("Authorization", `Bearer ${token}`).send({ operation: "ASSET_TRANSFER", resourceId: "AST-FRESH" });
      expect(challenge.status).toBe(201);
      const header = JSON.stringify({ challengeId: challenge.body.challengeId, publicKey, signature: proof(keys.privateKey, challenge.body.challenge) });
      const allowed = await request(app).post("/assets/AST-FRESH/transfer").set("Authorization", `Bearer ${token}`).set("X-BEL-Fresh-Auth", header).send({ newOwnerId: "DID:BEL:NEW" });
      expect(allowed.status).toBe(200);
    } finally {
      if (previous === undefined) delete process.env.BEL_FRESH_AUTH_REQUIRED_ACTIONS;
      else process.env.BEL_FRESH_AUTH_REQUIRED_ACTIONS = previous;
    }
  }, 30_000);
});
