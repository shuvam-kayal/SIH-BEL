import { describe, expect, it } from "vitest";
import type { BlockchainService } from "../src/adapters/BlockchainService";
import { ValidatorServiceImpl } from "../src/validators/validator.service";
import { createMemoryRepositories } from "../src/users/repository-implementations";
import { IdentityStore } from "../src/users/identity.store";
import type { Identity, User } from "../../shared/types";

const admin: Identity = { identityId: "DID:BEL:ADMIN", employeeId: "ADMIN", fullName: "Admin", role: "ADMIN", department: "OPS", status: "ACTIVE", createdAt: new Date().toISOString() };
const manager: Identity = { ...admin, identityId: "DID:BEL:MANAGER", employeeId: "MANAGER", role: "MANAGER" };
const user = (identity: Identity): User => ({ employeeId: identity.employeeId, identityId: identity.identityId, walletAddress: `wallet-${identity.employeeId}`, role: identity.role, department: identity.department, status: identity.status });

function setup() {
  const store = new IdentityStore(); const repositories = createMemoryRepositories(store);
  store.identities.set(admin.identityId, admin); store.identities.set(manager.identityId, manager); store.users.set(admin.employeeId, user(admin)); store.users.set(manager.employeeId, user(manager));
  let count = 0; const chain: BlockchainService = { submitTransaction: async (tx) => { count++; return { txId: `tx-${count}`, transactionHash: `hash-${count}`, blockNumber: 100 + count, status: "SUCCESS", event: tx.type === "VALIDATOR_ADD" ? "ValidatorAdded" : tx.type === "VALIDATOR_REMOVE" ? "ValidatorRemoved" : "ValidatorRestored" }; }, getStatus: async () => ({ height: 10, healthy: true, finalityLag: 0, lastFinalizedHeight: 10 }), getIdentity: async () => null, getWallet: async () => null, getAsset: async () => null, getJob: async () => null, getValidators: async () => [], getCommittee: async () => [], getBlock: async () => null };
  return { service: new ValidatorServiceImpl(chain, repositories), repositories };
}

describe("direct administrator validator lifecycle", () => {
  const input = { validatorId: "0x0000000000000000000000000000000000000001", nodeAddress: "node-1", publicKey: "pub", signingPublicKey: "sign", activationHeight: 20 };
  it("persists ADD, REMOVE, RESTORE only after chain success and preserves history", async () => {
    const { service, repositories } = setup();
    const added = await service.addValidator(admin.identityId, input);
    await service.removeValidator(admin.identityId, added.registrationId, { removalHeight: 30, reason: "retire" });
    await service.restoreValidator(admin.identityId, added.registrationId, { reason: "recover" });
    expect((await service.getHistory()).map((entry) => entry.operation)).toEqual(["VALIDATOR_ADD", "VALIDATOR_REMOVE", "VALIDATOR_RESTORE"]);
    expect((await repositories.validators.findById(added.registrationId))?.status).toBe("ACTIVE");
    expect((await repositories.notifications.list()).filter((entry) => entry.channel === "IN_APP")).toHaveLength(6);
  });

  it("rejects non-admin actors", async () => {
    const { service } = setup();
    await expect(service.addValidator(manager.identityId, input)).rejects.toMatchObject({ status: 403 });
  });
});
