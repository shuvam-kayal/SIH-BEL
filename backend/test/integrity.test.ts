import { describe, expect, it } from "vitest";
import { MockBlockchainAdapter } from "../../mocks/mock-blockchain";
import { createContainer } from "../src/container";
import { canonicalStateHash, commitState, MemoryIntegrityAdapter } from "../src/integrity/integrity";
import { AuthServiceImpl } from "../src/auth/auth.service";
import { UsersServiceImpl } from "../src/users/users.service";
import { clearIdentityStore, identityStore } from "../src/users/identity.store";
import { createMemoryRepositories } from "../src/users/repository-implementations";

describe("security-critical integrity commitments", () => {
  it("creates an injectable commitment without secrets", async () => {
    clearIdentityStore();
    const adapter = new MemoryIntegrityAdapter();
    const container = createContainer(new MockBlockchainAdapter(), { repositories: createMemoryRepositories(identityStore), integrity: adapter });
    const created = await container.users.createUser({ employeeId: "INTEGRITY-001", fullName: "Integrity Test", role: "ENGINEER", department: "TEST" });
    await container.users.registerDevice("INTEGRITY-001", "INTEGRITY-DEVICE", "plain-device-secret", "PUBLIC-INTEGRITY-001");
    const identityCommitment = adapter.commitments.find((item) => item.eventType === "IDENTITY_CREATE");
    expect(identityCommitment).toMatchObject({ entityType: "IDENTITY", entityId: created.identity.identityId, eventType: "IDENTITY_CREATE", version: 1 });
    expect(JSON.stringify(adapter.commitments)).not.toContain("plain-device-secret");
    expect(JSON.stringify(adapter.commitments)).not.toContain("bel_");
    expect(JSON.stringify(adapter.commitments)).not.toContain("private");
  });

  it("is deterministic and detects modified canonical state", async () => {
    const original = { entityType: "IDENTITY", entityId: "DID:BEL:1", status: "ACTIVE", role: "ENGINEER" };
    expect(canonicalStateHash(original)).toBe(canonicalStateHash({ role: "ENGINEER", status: "ACTIVE", entityId: "DID:BEL:1", entityType: "IDENTITY" }));
    expect(canonicalStateHash(original)).not.toBe(canonicalStateHash({ ...original, status: "SUSPENDED" }));
    const adapter = new MemoryIntegrityAdapter();
    const commitment = await commitState(adapter, { entityType: "IDENTITY", entityId: "DID:BEL:1", eventType: "IDENTITY_CREATE", version: 1, actorIdentityId: "DID:BEL:1", state: original, timestamp: "2026-01-01T00:00:00.000Z" });
    expect(commitment.canonicalStateHash).toBe(canonicalStateHash(original));
    expect(canonicalStateHash({ ...original, status: "REVOKED" })).not.toBe(commitment.canonicalStateHash);
  });

  it("keeps token and credential data outside commitments", async () => {
    clearIdentityStore();
    const adapter = new MemoryIntegrityAdapter();
    const repositories = createMemoryRepositories(identityStore);
    const users = new UsersServiceImpl(new MockBlockchainAdapter(), repositories, adapter);
    const auth = new AuthServiceImpl(repositories);
    await users.createUser({ employeeId: "INTEGRITY-002", fullName: "Integrity Test", role: "ENGINEER", department: "TEST" });
    await users.registerDevice("INTEGRITY-002", "INTEGRITY-DEVICE-2", "credential-not-on-chain", "PUBLIC-INTEGRITY-002");
    await users.registerWallet("INTEGRITY-002", "INTEGRITY-DEVICE-2", "0xTEST-INTEGRITY-002");
    await users.activateWallet("INTEGRITY-002", "INTEGRITY-DEVICE-2", "0xTEST-INTEGRITY-002");
    const session = await auth.login("credential-not-on-chain");
    expect(JSON.stringify(adapter.commitments)).not.toContain(session.token);
    expect(JSON.stringify(adapter.commitments)).not.toContain("credential-not-on-chain");
  });

  it("fails closed when production has no durable integrity adapter", () => {
    const previous = process.env.BEL_ENV;
    process.env.BEL_ENV = "production";
    try {
      expect(() => createContainer()).toThrow("Production requires DATABASE_URL and an explicit durable integrity adapter");
    } finally {
      if (previous === undefined) delete process.env.BEL_ENV;
      else process.env.BEL_ENV = previous;
    }
  });
});
