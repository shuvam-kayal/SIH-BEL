// Person 5: blockchain layer tests that need no chain (always run in CI).
import { describe, expect, it } from "vitest";
import { Interface } from "ethers";
import type { Transaction } from "../../shared/types";
import { TRANSACTION_TYPES } from "../../shared/enums";
import { MockBlockchainAdapter } from "../../mocks/mock-blockchain";
import {
  BlockchainError,
  buildCallPlan,
  createBlockchainServiceFromEnv,
  EvmBlockchainAdapter,
  loadAbis,
  loadChainConfigFromEnv,
  loadDeployment,
  parseDeployment,
  type ChainLookups,
} from "../src/blockchain";
import { classifyError, extractRevertData, waitForReceipt } from "../src/blockchain/evm-adapter";

const W1 = "0x1111111111111111111111111111111111111111";
const W2 = "0x2222222222222222222222222222222222222222";

const lookups: ChainLookups = {
  nftIdOf: async (id) => (id === "PUMP-1" ? 7n : id === "VALVE-1" ? 8n : 0n),
  walletOfIdentity: async (did) => (did === "DID:BEL:TECH" ? W2 : null),
};

function tx(type: Transaction["type"], payload: Record<string, unknown>): Transaction {
  return { txId: "t-1", type, actorIdentity: "DID:BEL:ADMIN", actorWallet: W1, payload, timestamp: new Date().toISOString(), signature: "development" };
}

async function expectKind(p: Promise<unknown>, kind: string) {
  await expect(p).rejects.toBeInstanceOf(BlockchainError);
  await expect(p).rejects.toMatchObject({ kind });
}

describe("buildCallPlan: every transaction type maps to its CONTRACT_SPEC function", () => {
  const cases: Array<[Transaction["type"], Record<string, unknown>, string, string, unknown[]]> = [
    ["IDENTITY_CREATE", { identityId: "DID:BEL:9", walletAddress: W1 }, "IdentityRegistry", "createIdentity", [W1, "DID:BEL:9"]],
    ["IDENTITY_REGISTER", { identityId: "DID:BEL:9", address: W1 }, "IdentityRegistry", "createIdentity", [W1, "DID:BEL:9"]],
    ["WALLET_REGISTER", { identityId: "DID:BEL:9", address: W1 }, "IdentityRegistry", "createIdentity", [W1, "DID:BEL:9"]],
    ["WALLET_ACTIVATE", { address: W1, deviceId: "D1", identityId: "x" }, "IdentityRegistry", "activateWallet", [W1]],
    ["WALLET_REVOKE", { address: W1, reason: "lost" }, "IdentityRegistry", "revokeWallet", [W1, "lost"]],
    ["ROLE_ASSIGN", { identityId: "DID:BEL:TECH", role: "TECHNICIAN" }, "RoleRegistry", "assignRole", [W2, 3]],
    ["ROLE_REVOKE", { walletAddress: W1, role: "ADMIN" }, "RoleRegistry", "revokeRole", [W1, 0]],
    ["ASSET_MINT", { assetId: "PUMP-2", ownerId: "DID:BEL:TECH", assetType: "PUMP" }, "AssetRegistry", "mintAsset", ["PUMP-2", W2]],
    ["ASSET_TRANSFER", { assetId: "PUMP-1", newOwnerId: W1 }, "AssetRegistry", "transferAsset", [7n, W1]],
    ["GRANT_CREATE", { resourceId: "PUMP-1", actorIdentityId: "DID:BEL:TECH", authorizationGrantId: "GRANT-1", expiresAt: 1_900_000_000 }, "AssetRegistry", "setTransferGrant", [7n, W2, 1_900_000_000, true, "GRANT-1"]],
    ["GRANT_REVOKE", { resourceId: "PUMP-1", actorIdentityId: "DID:BEL:TECH", authorizationGrantId: "GRANT-1" }, "AssetRegistry", "setTransferGrant", [7n, W2, 0, false, "GRANT-1"]],
    ["ASSET_STATE_CHANGE", { nftId: "7", newState: "IN_MAINTENANCE" }, "AssetRegistry", "changeAssetState", [7n, "IN_MAINTENANCE"]],
    ["COMPONENT_ATTACH", { parentAssetId: "PUMP-1", componentAssetId: "VALVE-1" }, "AssetRegistry", "attachComponent", [7n, 8n]],
    ["COMPONENT_REMOVE", { parentNftId: 7, componentId: "VALVE-1" }, "AssetRegistry", "removeComponent", [7n, 8n]],
    ["JOB_CREATE", { jobId: "J-1", assetId: "PUMP-1", priority: "HIGH" }, "JobManager", "createJob", ["J-1", 7n]],
    ["JOB_ASSIGN", { jobId: "J-1", technicianId: "DID:BEL:TECH" }, "JobManager", "assignJob", ["J-1", W2]],
    ["JOB_START", { jobId: "J-1" }, "JobManager", "startJob", ["J-1"]],
    ["JOB_COMPLETE", { jobId: "J-1", evidenceHash: "AB".repeat(32) }, "JobManager", "completeJob", ["J-1", `0x${"ab".repeat(32)}`]],
    ["JOB_APPROVE", { jobId: "J-1" }, "JobManager", "approveJob", ["J-1"]],
    ["JOB_REJECT", { jobId: "J-1", reason: "incomplete" }, "JobManager", "rejectJob", ["J-1", "incomplete"]],
    ["VALIDATOR_ADD", { validatorId: W1, publicKey: "pub", signingPublicKey: "sign", activationHeight: 20 }, "ValidatorRegistry", "addValidator", [W1, "pub", "sign", 20]],
    ["VALIDATOR_REMOVE", { validatorId: W1, removalHeight: 30, reason: "retire" }, "ValidatorRegistry", "removeValidator", [W1, 30, "retire"]],
    ["VALIDATOR_RESTORE", { validatorId: W1, reason: "recover" }, "ValidatorRegistry", "restoreValidator", [W1, "recover"]],
    ["VALIDATOR_REMOVE_CANCEL", { validatorId: W1, reason: "cancel" }, "ValidatorRegistry", "cancelScheduledRemoval", [W1, "cancel"]],
  ];

  it("covers every frozen TransactionType", () => {
    expect(new Set(cases.map((c) => c[0]))).toEqual(new Set(TRANSACTION_TYPES));
  });

  it.each(cases)("%s", async (type, payload, contract, method, args) => {
    expect(await buildCallPlan(tx(type, payload), lookups)).toEqual({ contract, method, args });
  });

  it("every planned call encodes against the committed ABI", async () => {
    const abis = loadAbis();
    for (const [type, payload] of cases) {
      const plan = await buildCallPlan(tx(type, payload), lookups);
      expect(() => new Interface(abis[plan.contract]).encodeFunctionData(plan.method, plan.args)).not.toThrow();
    }
  });
});

describe("buildCallPlan: invalid payloads fail before touching the chain", () => {
  it("rejects missing or malformed fields", async () => {
    await expectKind(buildCallPlan(tx("IDENTITY_CREATE", { identityId: "DID:BEL:9" }), lookups), "INVALID_PAYLOAD");
    await expectKind(buildCallPlan(tx("WALLET_ACTIVATE", { address: "not-an-address" }), lookups), "INVALID_PAYLOAD");
    await expectKind(buildCallPlan(tx("WALLET_REVOKE", { address: W1 }), lookups), "INVALID_PAYLOAD");
    await expectKind(buildCallPlan(tx("ROLE_ASSIGN", { walletAddress: W1, role: "SUPERUSER" }), lookups), "INVALID_PAYLOAD");
    await expectKind(buildCallPlan(tx("ASSET_STATE_CHANGE", { assetId: "PUMP-1", newState: "BROKEN" }), lookups), "INVALID_PAYLOAD");
    await expectKind(buildCallPlan(tx("JOB_COMPLETE", { jobId: "J-1", evidenceHash: "0x1234" }), lookups), "INVALID_PAYLOAD");
    await expectKind(buildCallPlan(tx("JOB_COMPLETE", { jobId: "J-1", evidenceHash: "0".repeat(64) }), lookups), "INVALID_PAYLOAD");
    await expectKind(buildCallPlan(tx("JOB_REJECT", { jobId: "J-1", reason: "  " }), lookups), "INVALID_PAYLOAD");
  });

  it("reports unknown on-chain references as NOT_FOUND", async () => {
    await expectKind(buildCallPlan(tx("JOB_CREATE", { jobId: "J-1", assetId: "NOPE" }), lookups), "NOT_FOUND");
    await expectKind(buildCallPlan(tx("ASSET_MINT", { assetId: "A", ownerId: "DID:BEL:GHOST" }), lookups), "NOT_FOUND");
  });

  it("refuses a separate custodian the frozen interface cannot express", async () => {
    await expectKind(
      buildCallPlan(tx("ASSET_TRANSFER", { assetId: "PUMP-1", newOwnerId: W1, newCustodianId: "DID:BEL:TECH" }), lookups),
      "UNSUPPORTED_TRANSACTION",
    );
    // Same custodian as owner is the default semantics and is fine.
    await expect(buildCallPlan(tx("ASSET_TRANSFER", { assetId: "PUMP-1", newOwnerId: W1, newCustodianId: W1 }), lookups)).resolves.toBeTruthy();
  });

  it("rejects unknown transaction types", async () => {
    await expectKind(buildCallPlan(tx("NOT_A_TYPE" as Transaction["type"], {}), lookups), "UNSUPPORTED_TRANSACTION");
  });
});

describe("configuration", () => {
  const base = { BEL_CHAIN_RPC_URL: "http://127.0.0.1:1" };

  it("loads the committed local deployment and ABIs", () => {
    const cfg = loadChainConfigFromEnv(base);
    expect(cfg.deployment.chainId).toBe(31337);
    expect(Object.keys(cfg.abis).sort()).toEqual(["AssetRegistry", "AuditRegistry", "IdentityRegistry", "JobManager", "RoleRegistry", "ValidatorRegistry"]);
    expect(cfg.confirmations).toBe(1);
  });

  it("requires an RPC url", () => {
    expect(() => loadChainConfigFromEnv({})).toThrow(/BEL_CHAIN_RPC_URL/);
  });

  it("forbids backend signer keys in production", () => {
    expect(() => loadChainConfigFromEnv({ ...base, BEL_ENV: "production", BEL_CHAIN_DEV_SIGNER_KEYS: "0xabc" })).toThrow(/forbidden in production/);
  });

  it("rejects bad numbers, missing files and incomplete deployments", () => {
    expect(() => loadChainConfigFromEnv({ ...base, BEL_CHAIN_CONFIRMATIONS: "0" })).toThrow(BlockchainError);
    expect(() => loadDeployment("does-not-exist")).toThrow(/not found/);
    expect(() => parseDeployment({ chainId: 1, contracts: { IdentityRegistry: W1 } })).toThrow(/RoleRegistry/);
    expect(() => parseDeployment({ chainId: 0, contracts: {} })).toThrow(/chainId/);
  });

  it("factory defaults to the mock and validates BEL_BLOCKCHAIN", () => {
    expect(createBlockchainServiceFromEnv({})).toBeInstanceOf(MockBlockchainAdapter);
    expect(createBlockchainServiceFromEnv({ BEL_BLOCKCHAIN: "evm", ...base })).toBeInstanceOf(EvmBlockchainAdapter);
    expect(() => createBlockchainServiceFromEnv({ BEL_BLOCKCHAIN: "fabric" })).toThrow(/mock" or "evm/);
  });
});

describe("adapter failure handling without a chain", () => {
  const adapter = () => new EvmBlockchainAdapter({ ...loadChainConfigFromEnv({ BEL_CHAIN_RPC_URL: "http://127.0.0.1:1" }), txTimeoutMs: 2000 });

  it("reports an unreachable RPC as NETWORK on writes and unhealthy on status", async () => {
    const a = adapter();
    await expectKind(a.submitTransaction(tx("JOB_START", { jobId: "J-1" })), "NETWORK");
    await expect(a.getStatus()).resolves.toEqual({ height: 0, healthy: false, finalityLag: 0, lastFinalizedHeight: 0 });
  });

  it("validates the envelope's actorWallet", async () => {
    await expectKind(adapter().prepareTransaction({ ...tx("JOB_START", { jobId: "J" }), actorWallet: "bob" }), "INVALID_PAYLOAD");
  });

  it("decodes custom errors, Error(string) and unknown reverts", () => {
    const a = adapter();
    const iface = new Interface(loadAbis().JobManager);
    const data = iface.encodeErrorResult("InvalidTransition", ["J-1", 1, 5]);
    expect(a.decodeRevert(data)).toEqual({ name: "InvalidTransition", args: ["J-1", "1", "5"], message: "InvalidTransition(J-1, 1, 5)" });
    const err = Interface.from(["error Error(string)"]).encodeErrorResult("Error", ["nope"]);
    expect(a.decodeRevert(err).message).toBe("nope");
    expect(a.decodeRevert("0x").name).toBe("UnknownRevert");
  });

  it("finds revert data nested in JSON-RPC error chains and classifies transport errors", () => {
    expect(extractRevertData({ info: { error: { data: "0x1234" } } })).toBe("0x1234");
    expect(extractRevertData({ message: "x" })).toBeUndefined();
    expect(classifyError({ code: "TIMEOUT" }, "ctx").kind).toBe("TIMEOUT");
    expect(classifyError(new Error("ECONNREFUSED"), "ctx")).toMatchObject({ kind: "NETWORK", status: 502 });
  });

  it("validators/committee are 501 until Person 4 provides a consensus source", async () => {
    await expect(adapter().getValidators()).rejects.toMatchObject({ status: 501 });
    await expect(adapter().getCommittee(1)).rejects.toMatchObject({ status: 501 });
  });
});

describe("MockBlockchainAdapter read-after-write (for Persons 2/3)", () => {
  it("records asset and job transactions and still always succeeds", async () => {
    const chain = new MockBlockchainAdapter();
    const ok = await chain.submitTransaction(tx("ASSET_MINT", { assetId: "PUMP-1", ownerId: "DID:BEL:1", assetType: "PUMP" }));
    expect(ok.status).toBe("SUCCESS");
    expect(await chain.getAsset("PUMP-1")).toMatchObject({ nftId: "1", ownerId: "DID:BEL:1", custodianId: "DID:BEL:1", status: "ACTIVE" });
    await chain.submitTransaction(tx("ASSET_TRANSFER", { assetId: "PUMP-1", newOwnerId: "DID:BEL:2" }));
    expect((await chain.getAsset("PUMP-1"))?.ownerId).toBe("DID:BEL:2");

    await chain.submitTransaction(tx("JOB_CREATE", { jobId: "J-1", assetId: "PUMP-1", priority: "HIGH" }));
    await chain.submitTransaction(tx("JOB_ASSIGN", { jobId: "J-1", technicianId: "DID:BEL:T" }));
    await chain.submitTransaction(tx("JOB_START", { jobId: "J-1" }));
    await chain.submitTransaction(tx("JOB_COMPLETE", { jobId: "J-1", evidenceHash: "ab".repeat(32) }));
    expect(await chain.getJob("J-1")).toMatchObject({ status: "COMPLETED", assignedTo: "DID:BEL:T", priority: "HIGH" });
    expect(chain.submitted).toHaveLength(6);
  });

  it("keeps accepting transactions it does not model", async () => {
    const chain = new MockBlockchainAdapter();
    await expect(chain.submitTransaction(tx("IDENTITY_CREATE", { identityId: "x" }))).resolves.toMatchObject({ status: "SUCCESS" });
    expect(await chain.getJob("nope")).toBeNull();
  });
});

describe("waitForReceipt (regression: tx mined between first check and block subscription)", () => {
  // Idle automine chain: the receipt appears on the 2nd lookup and no new block ever follows.
  // ethers' waitForTransaction timed out here on slower machines (seen on Windows).
  const fake = (appearOnCall: number, head = 5) => {
    let calls = 0;
    return {
      calls: () => calls,
      provider: {
        getTransactionReceipt: async () => (++calls >= appearOnCall ? ({ blockNumber: 5, status: 1 } as never) : null),
        getBlockNumber: async () => head,
      },
    };
  };

  it("finds a receipt that appears after the first check without any new block", async () => {
    const f = fake(2);
    await expect(waitForReceipt(f.provider, "0xabc", 1, 2_000, 10)).resolves.toMatchObject({ blockNumber: 5 });
    expect(f.calls()).toBe(2);
  });

  it("waits for the requested confirmations", async () => {
    await expect(waitForReceipt(fake(1, 5).provider, "0xabc", 3, 100, 10)).resolves.toBeNull(); // only 1 conf
    await expect(waitForReceipt(fake(1, 7).provider, "0xabc", 3, 100, 10)).resolves.toMatchObject({ blockNumber: 5 });
  });

  it("returns null at the timeout when the transaction never lands", async () => {
    const started = Date.now();
    await expect(waitForReceipt(fake(Infinity).provider, "0xabc", 1, 120, 10)).resolves.toBeNull();
    expect(Date.now() - started).toBeLessThan(1_000);
  });
});
