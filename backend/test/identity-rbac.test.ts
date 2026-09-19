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
    await expect(auth.login("EMP005-CREDENTIAL")).rejects.toMatchObject({ code: "UNAUTHORIZED" });
  });
});
