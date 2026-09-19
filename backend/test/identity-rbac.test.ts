import { describe, expect, it, beforeEach } from "vitest";
import { MockBlockchainAdapter } from "../../mocks/mock-blockchain";
import { AuthServiceImpl } from "../src/auth/auth.service";
import { UsersServiceImpl } from "../src/users/users.service";
import { clearIdentityStore, identityStore } from "../src/users/identity.store";
import { createMemoryRepositories } from "../src/users/repository-implementations";
import type { BlockchainService } from "../../shared/api";
import type { Transaction } from "../../shared/types";

describe("identity, authentication, and wallet lifecycle", () => {
  const chain = new MockBlockchainAdapter();
  let users: UsersServiceImpl;
  let auth: AuthServiceImpl;

  beforeEach(() => {
    clearIdentityStore();
    const repositories = createMemoryRepositories(identityStore);
    users = new UsersServiceImpl(chain, repositories);
    auth = new AuthServiceImpl(repositories);
  });

  async function provision(employeeId: string, role: "ADMIN" | "ENGINEER" = "ENGINEER") {
    const result = await users.createUser({ employeeId, fullName: employeeId, role, department: "TEST" });
    await users.registerDevice(employeeId, `${employeeId}-DEVICE`, `${employeeId}-CREDENTIAL`, `PUBLIC-${employeeId}`);
    await users.registerWallet(employeeId, `${employeeId}-DEVICE`, `0xTEST-${employeeId}`);
    const wallet = await users.activateWallet(employeeId, `${employeeId}-DEVICE`, `0xTEST-${employeeId}`);
    return { ...result, wallet };
  }

  it("provisions an identity before a wallet and authenticates a bound device", async () => {
    const result = await users.createUser({ employeeId: "EMP001", fullName: "Ada", role: "ENGINEER", department: "R&D" });
    expect(result.identity.identityId).toBe(result.user.identityId);
    expect(identityStore.walletForIdentity(result.identity.identityId)).toBeUndefined();

    await users.registerDevice("EMP001", "DEV-001", "credential-001", "PUBLIC-EMP001");
    await users.registerWallet("EMP001", "DEV-001", "0xTEST-EMP001");
    const wallet = await users.activateWallet("EMP001", "DEV-001", "0xTEST-EMP001");
    const session = await auth.login("credential-001");
    expect(session.user.walletAddress).toBe(wallet.address);
    expect(await auth.validateSession(session.token)).toMatchObject({ employeeId: "EMP001" });
  });

  it("rejects invalid, suspended, and revoked-wallet logins", async () => {
    await provision("EMP002");
    const existingSession = await auth.login("EMP002-CREDENTIAL");
    await expect(auth.login("wrong")).rejects.toMatchObject({ code: "UNAUTHORIZED" });
    const identity = identityStore.identities.get("DID:BEL:SYSTEM");
    expect(identity).toBeUndefined();

    const employee = identityStore.users.get("EMP002")!;
    identityStore.identities.get(employee.identityId)!.status = "SUSPENDED";
    await expect(auth.login("EMP002-CREDENTIAL")).rejects.toMatchObject({ code: "FORBIDDEN" });
    expect(await auth.validateSession(existingSession.token)).toBeNull();
    identityStore.identities.get(employee.identityId)!.status = "ACTIVE";
    await users.revokeWallet("EMP002", "lost device");
    await expect(auth.login("EMP002-CREDENTIAL")).rejects.toMatchObject({ code: "UNAUTHORIZED" });
  });

  it("rejects duplicate employees and preserves identity across wallet rotation", async () => {
    const first = await provision("EMP003");
    await expect(users.createUser({ employeeId: "EMP003", fullName: "Other", role: "ENGINEER", department: "TEST" })).rejects.toMatchObject({ code: "CONFLICT" });
    await users.registerDevice("EMP003", "DEV-003B", "credential-003b", "PUBLIC-EMP003B");
    await users.registerWallet("EMP003", "DEV-003B", "0xTEST-EMP003B");
    const replacement = await users.activateWallet("EMP003", "DEV-003B", "0xTEST-EMP003B");
    expect(replacement.address).not.toBe(first.wallet.address);
    expect((await users.getById("EMP003"))!.identityId).toBe(first.identity.identityId);
    expect(identityStore.wallets.get(first.wallet.address)!.status).toBe("REVOKED");
  });

  it("enforces admin-only role assignment", async () => {
    const admin = await provision("ADMIN001", "ADMIN");
    await provision("EMP004");
    await expect(users.assignRole("EMP004", "EMP004", "MANAGER")).rejects.toMatchObject({ code: "FORBIDDEN" });
    const changed = await users.assignRole(admin.identity.identityId, "EMP004", "MANAGER");
    expect(changed.role).toBe("MANAGER");
  });

  it("does not persist an active role when blockchain role assignment fails", async () => {
    const admin = await provision("ADMIN-FAIL", "ADMIN");
    await provision("EMP-FAIL");
    const repositories = createMemoryRepositories(identityStore);
    const baseChain = new MockBlockchainAdapter();
    const failingChain = {
      ...baseChain,
      submitTransaction: async (tx: Transaction) => tx.type === "ROLE_ASSIGN"
        ? { txId: tx.txId, status: "REJECTED" }
        : baseChain.submitTransaction(tx),
    } as unknown as BlockchainService;
    const failingUsers = new UsersServiceImpl(failingChain, repositories);

    await expect(failingUsers.assignRole(admin.identity.identityId, "EMP-FAIL", "MANAGER"))
      .rejects.toThrow("Blockchain rejected ROLE_ASSIGN");
    expect((await failingUsers.getIdentity("EMP-FAIL"))?.role).toBe("ENGINEER");
    expect((await failingUsers.getById("EMP-FAIL"))?.role).toBe("ENGINEER");
  });

  it("revoking a device revokes its active wallet and credential", async () => {
    const { wallet } = await provision("EMP005");
    await users.revokeDevice("EMP005-DEVICE");
    expect(identityStore.wallets.get(wallet.address)!.status).toBe("REVOKED");
    expect(chain.submitted.at(-1)).toMatchObject({ type: "WALLET_REVOKE", payload: { address: wallet.address } });
    await expect(auth.login("EMP005-CREDENTIAL")).rejects.toMatchObject({ code: "UNAUTHORIZED" });

    const submissionCount = chain.submitted.length;
    await users.revokeDevice("EMP005-DEVICE");
    expect(chain.submitted).toHaveLength(submissionCount);
  });

  it("leaves PostgreSQL state unchanged when wallet revocation is rejected", async () => {
    const failingChain = new MockBlockchainAdapter() as any;
    const submit = failingChain.submitTransaction.bind(failingChain);
    failingChain.failRevoke = false;
    failingChain.submitTransaction = async (tx: any) => {
      if (failingChain.failRevoke && tx.type === "WALLET_REVOKE") {
        failingChain.submitted.push(tx);
        return { txId: tx.txId, status: "REJECTED" as const };
      }
      return submit(tx);
    };
    const repositories = createMemoryRepositories();
    const failingUsers = new UsersServiceImpl(failingChain, repositories);
    await failingUsers.createUser({ employeeId: "EMP-FAIL", fullName: "EMP-FAIL", role: "ENGINEER", department: "TEST" });
    await failingUsers.registerDevice("EMP-FAIL", "EMP-FAIL-DEVICE", "EMP-FAIL-CREDENTIAL", "PUBLIC-EMP-FAIL");
    await failingUsers.registerWallet("EMP-FAIL", "EMP-FAIL-DEVICE", "0xFAIL-WALLET");
    const wallet = await failingUsers.activateWallet("EMP-FAIL", "EMP-FAIL-DEVICE", "0xFAIL-WALLET");
    failingChain.failRevoke = true;

    await expect(failingUsers.revokeDevice("EMP-FAIL-DEVICE")).rejects.toMatchObject({ code: "CONFLICT" });
    expect((await failingUsers.listDevices("EMP-FAIL"))[0].status).toBe("ACTIVE");
    expect((await failingUsers.listWallets("EMP-FAIL")).find((item) => item.address === wallet.address)?.status).toBe("ACTIVE");
  });

  it("uses the authenticated admin wallet for EVM device revocation", async () => {
    const originalMode = process.env.BEL_BLOCKCHAIN;
    const evmChain = new MockBlockchainAdapter();
    const repositories = createMemoryRepositories();
    const evmUsers = new UsersServiceImpl(evmChain, repositories);
    await evmUsers.createUser({ employeeId: "ADMIN-EVM", fullName: "ADMIN-EVM", role: "ADMIN", department: "TEST" });
    await evmUsers.registerDevice("ADMIN-EVM", "ADMIN-EVM-DEVICE", "ADMIN-EVM-CREDENTIAL", "PUBLIC-ADMIN-EVM");
    await evmUsers.registerWallet("ADMIN-EVM", "ADMIN-EVM-DEVICE", "0xADMIN-EVM");
    await evmUsers.activateWallet("ADMIN-EVM", "ADMIN-EVM-DEVICE", "0xADMIN-EVM");
    await evmUsers.createUser({ employeeId: "EMP-EVM", fullName: "EMP-EVM", role: "ENGINEER", department: "TEST" });
    await evmUsers.registerDevice("EMP-EVM", "EMP-EVM-DEVICE", "EMP-EVM-CREDENTIAL", "PUBLIC-EMP-EVM");
    await evmUsers.registerWallet("EMP-EVM", "EMP-EVM-DEVICE", "0xEMP-EVM");
    await evmUsers.activateWallet("EMP-EVM", "EMP-EVM-DEVICE", "0xEMP-EVM");
    process.env.BEL_BLOCKCHAIN = "evm";
    try {
      await evmUsers.revokeDevice("EMP-EVM-DEVICE", "ADMIN-EVM");
      const admin = await evmUsers.getIdentity("ADMIN-EVM");
      expect(evmChain.submitted.at(-1)).toMatchObject({ actorIdentity: admin?.identityId, actorWallet: "0xADMIN-EVM", type: "WALLET_REVOKE" });
    } finally {
      if (originalMode === undefined) delete process.env.BEL_BLOCKCHAIN;
      else process.env.BEL_BLOCKCHAIN = originalMode;
    }
  });

  it("mirrors a predeployed EVM bootstrap identity without wallet-less writes", async () => {
    const originalMode = process.env.BEL_BLOCKCHAIN;
    const evmChain = new MockBlockchainAdapter();
    evmChain.seedIdentity({ identityId: "DID:BEL:ADMIN", employeeId: "", fullName: "", role: "ADMIN", department: "", status: "ACTIVE", createdAt: new Date().toISOString() });
    evmChain.seedWallet({ address: "0x1111111111111111111111111111111111111111", identityId: "DID:BEL:ADMIN", deviceId: "", status: "ACTIVE", activatedAt: new Date().toISOString(), revokedAt: null, revokedReason: null, publicKey: null });
    process.env.BEL_BLOCKCHAIN = "evm";
    try {
      const bootstrapUsers = new UsersServiceImpl(evmChain, createMemoryRepositories());
      const result = await bootstrapUsers.createUser({ employeeId: "ADMIN-001", identityId: "DID:BEL:ADMIN", fullName: "BEL Development Administrator", role: "ADMIN", department: "PLATFORM" });
      expect(result.identity.identityId).toBe("DID:BEL:ADMIN");
      expect(evmChain.submitted).toHaveLength(0);
    } finally {
      if (originalMode === undefined) delete process.env.BEL_BLOCKCHAIN;
      else process.env.BEL_BLOCKCHAIN = originalMode;
    }
  });

  it("uses the active admin wallet for an EVM legacy role correction", async () => {
    const originalMode = process.env.BEL_BLOCKCHAIN;
    const evmChain = new MockBlockchainAdapter();
    const repositories = createMemoryRepositories();
    const legacyUsers = new UsersServiceImpl(evmChain, repositories);
    const admin = await legacyUsers.createUser({ employeeId: "LEGACY-ADMIN", fullName: "LEGACY-ADMIN", role: "ADMIN", department: "TEST" });
    await legacyUsers.registerDevice("LEGACY-ADMIN", "LEGACY-ADMIN-DEVICE", "LEGACY-ADMIN-CREDENTIAL", "PUBLIC-LEGACY-ADMIN");
    await legacyUsers.registerWallet("LEGACY-ADMIN", "LEGACY-ADMIN-DEVICE", "0xLEGACY-ADMIN");
    await legacyUsers.activateWallet("LEGACY-ADMIN", "LEGACY-ADMIN-DEVICE", "0xLEGACY-ADMIN");
    evmChain.seedIdentity({ identityId: "DID:BEL:LEGACY-TARGET", employeeId: "", fullName: "", role: "ENGINEER", department: "", status: "ACTIVE", createdAt: new Date().toISOString() });
    process.env.BEL_BLOCKCHAIN = "evm";
    try {
      await legacyUsers.createUser({ employeeId: "LEGACY-TARGET", identityId: "DID:BEL:LEGACY-TARGET", fullName: "LEGACY-TARGET", role: "MANAGER", department: "TEST" }, admin.identity.identityId);
      expect(evmChain.submitted.at(-1)).toMatchObject({ type: "ROLE_ASSIGN", actorIdentity: admin.identity.identityId, actorWallet: "0xLEGACY-ADMIN", payload: { identityId: "DID:BEL:LEGACY-TARGET", role: "MANAGER" } });
    } finally {
      if (originalMode === undefined) delete process.env.BEL_BLOCKCHAIN;
      else process.env.BEL_BLOCKCHAIN = originalMode;
    }
  });
});
