// Person 5: EvmBlockchainAdapter against contracts deployed on the customized
// Besu process owned by the integration workflow. This suite is skipped by
// ordinary unit runs and fails on the mandatory path when Besu is absent.
import { beforeAll, describe, expect, it, vi } from "vitest";
import { Transaction as EvmTransaction, JsonRpcProvider, Wallet as EvmWallet, id as keccakText } from "ethers";
import type { Transaction } from "../../shared/types";
import { BlockchainError, EvmBlockchainAdapter, loadChainConfigFromEnv, type EvmChainConfig } from "../src/blockchain";

const configuredRpcUrl = process.env.BEL_EVM_RPC_URL?.trim() || process.env.BEL_CHAIN_RPC_URL?.trim();
const configuredKeys = (process.env.BEL_E2E_PRIVATE_KEYS ?? process.env.BEL_CHAIN_DEV_SIGNER_KEYS ?? "").split(",").map((value) => value.trim()).filter(Boolean);
const integrationRun = process.env.BEL_RUN_INTEGRATION === "true";

describe.skipIf(!integrationRun)("EvmBlockchainAdapter on customized Besu", () => {
  vi.setConfig({ testTimeout: 180_000, hookTimeout: 240_000 });
  const key = (i: number) => configuredKeys[i];
  const addr = (i: number) => new EvmWallet(key(i)).address;
  const [ADMIN, MANAGER, ENGINEER, TECH, AUDITOR, VERIFIER, ISSUER, TECH2, DEVICE, NONCE_GAP] = [0, 1, 2, 3, 4, 5, 6, 7, 8, 9].map(addr);
  let provider: JsonRpcProvider;
  let adapter: EvmBlockchainAdapter;
  let config: EvmChainConfig;
  let n = 0;

  const env = (type: Transaction["type"], actorWallet: string, actorIdentity: string, payload: Record<string, unknown>, signature = "development"): Transaction =>
    ({ txId: `it-${++n}`, type, actorWallet, actorIdentity, payload, timestamp: new Date().toISOString(), signature });
  const asAdmin = (type: Transaction["type"], payload: Record<string, unknown>) => env(type, ADMIN, "DID:BEL:ADMIN", payload);

  async function ok(tx: Transaction) {
    const r = await adapter.submitTransactionDetailed(tx);
    if (r.status !== "SUCCESS") throw new Error(`${tx.type} rejected: ${r.revert?.message}`);
    return r;
  }
  async function onboard(did: string, wallet: string, role: string) {
    await ok(asAdmin("IDENTITY_CREATE", { identityId: did, walletAddress: wallet }));
    await ok(asAdmin("ROLE_ASSIGN", { identityId: did, role }));
    await ok(asAdmin("WALLET_ACTIVATE", { address: wallet }));
  }

  beforeAll(async () => {
    if (!configuredRpcUrl) throw new Error("BEL_EVM_RPC_URL/BEL_CHAIN_RPC_URL is required for the Besu integration suite");
    if (configuredKeys.length < 10) throw new Error("BEL_E2E_PRIVATE_KEYS/BEL_CHAIN_DEV_SIGNER_KEYS must contain at least ten Besu-funded keys");
    const rpcUrl = configuredRpcUrl;
    config = loadChainConfigFromEnv({ ...process.env, BEL_BLOCKCHAIN: "evm", BEL_CHAIN_RPC_URL: rpcUrl, BEL_CHAIN_DEPLOYMENT: process.env.BEL_CHAIN_DEPLOYMENT || "besu-prototype", BEL_CHAIN_DEV_SIGNER_KEYS: configuredKeys.join(",") });
    provider = new JsonRpcProvider(rpcUrl, config.deployment.chainId, { staticNetwork: true, pollingInterval: 50 });
    for (let i = 0; ; i++) {
      try {
        const chainId = await provider.send("eth_chainId", []);
        if (BigInt(chainId) !== BigInt(config.deployment.chainId)) throw new Error(`RPC chain id ${chainId} does not match deployment ${config.deployment.chainId}`);
        const client = await provider.send("web3_clientVersion", []);
        if (!String(client).toLowerCase().includes("besu")) throw new Error(`expected Besu RPC client, got ${client}`);
        break;
      } catch (error) {
        if (i > 50) throw new Error(`configured EVM endpoint did not become reachable: ${String(error)}`);
        await new Promise((r) => setTimeout(r, 100));
      }
    }

    config.devSignerKeys = configuredKeys.slice(0, 8); // DEVICE (8) deliberately uses the signed-tx path.
    adapter = new EvmBlockchainAdapter(config, { provider });

    await onboard("DID:BEL:MANAGER", MANAGER, "MANAGER");
    await onboard("DID:BEL:ENGINEER", ENGINEER, "ENGINEER");
    await onboard("DID:BEL:TECH", TECH, "TECHNICIAN");
    await onboard("DID:BEL:AUDITOR", AUDITOR, "AUDITOR");
    await onboard("DID:BEL:VERIFIER", VERIFIER, "VERIFIER");
    await onboard("DID:BEL:ISSUER", ISSUER, "ISSUER");
  }, 300_000);

  it("identity and wallet reads reflect on-chain state", async () => {
    expect(await adapter.getWallet(TECH)).toMatchObject({ address: TECH, identityId: "DID:BEL:TECH", status: "ACTIVE", revokedAt: null });
    expect(await adapter.getIdentity("DID:BEL:TECH")).toMatchObject({ identityId: "DID:BEL:TECH", role: "TECHNICIAN", status: "ACTIVE" });
    expect(await adapter.getWallet(DEVICE)).toBeNull();
    expect(await adapter.getIdentity("DID:BEL:NOBODY")).toBeNull();
  });

  it("mints by owner identity, returns nftId, events and audit ids", async () => {
    const r = await ok(env("ASSET_MINT", ENGINEER, "DID:BEL:ENGINEER", { assetId: "PUMP-1", ownerId: "DID:BEL:MANAGER", assetType: "PUMP" }));
    expect(r.nftId).toMatch(/^\d+$/);
    expect(Number(r.nftId)).toBeGreaterThan(0);
    expect(r.hash).toMatch(/^0x[0-9a-f]{64}$/);
    expect(r.events.map((e) => e.name)).toEqual(expect.arrayContaining(["Transfer", "AssetMinted", "AuditRecorded"]));
    expect(r.auditTxIds).toHaveLength(1);
    expect(await adapter.getAsset("PUMP-1")).toMatchObject({ nftId: r.nftId, ownerId: "DID:BEL:MANAGER", custodianId: "DID:BEL:MANAGER", status: "ACTIVE", parentAssetId: null });
    expect(await adapter.getAsset("NOPE")).toBeNull();
  });

  it("reports duplicates and unauthorized callers as decoded REJECTED results", async () => {
    const dup = await adapter.submitTransactionDetailed(asAdmin("ASSET_MINT", { assetId: "PUMP-1", ownerId: ADMIN }));
    expect(dup).toMatchObject({ status: "REJECTED", revert: { name: "AssetAlreadyExists", args: ["PUMP-1"] } });
    expect(dup.hash).toBeUndefined(); // caught in simulation: no gas spent

    const unauth = await adapter.submitTransaction(env("ASSET_MINT", TECH, "DID:BEL:TECH", { assetId: "X", ownerId: TECH }));
    expect(unauth).toMatchObject({ txId: expect.any(String), status: "REJECTED", revert: { name: "Unauthorized" } });
    const detailed = await adapter.submitTransactionDetailed(env("ASSET_MINT", TECH, "DID:BEL:TECH", { assetId: "X", ownerId: TECH }));
    // 39 = ADMIN|MANAGER|ENGINEER|ISSUER, the "Register asset" row of RBAC_MATRIX.md
    expect(detailed.revert).toMatchObject({ name: "Unauthorized", args: [TECH, "39"] });
  });

  it("transfers, changes lifecycle state and manages components", async () => {
    await ok(asAdmin("ASSET_MINT", { assetId: "VALVE-1", ownerId: "DID:BEL:MANAGER" }));
    await ok(env("COMPONENT_ATTACH", ENGINEER, "DID:BEL:ENGINEER", { parentAssetId: "PUMP-1", componentAssetId: "VALVE-1" }));
    expect((await adapter.getAsset("VALVE-1"))?.parentAssetId).toBe("PUMP-1");
    await ok(env("COMPONENT_REMOVE", ENGINEER, "DID:BEL:ENGINEER", { parentAssetId: "PUMP-1", componentAssetId: "VALVE-1" }));
    expect((await adapter.getAsset("VALVE-1"))?.parentAssetId).toBeNull();

    await ok(env("ASSET_TRANSFER", MANAGER, "DID:BEL:MANAGER", { assetId: "VALVE-1", newOwnerId: "DID:BEL:ENGINEER" }));
    expect(await adapter.getAsset("VALVE-1")).toMatchObject({ ownerId: "DID:BEL:ENGINEER", custodianId: "DID:BEL:ENGINEER" });

    await ok(env("ASSET_STATE_CHANGE", ENGINEER, "DID:BEL:ENGINEER", { assetId: "VALVE-1", newState: "DECOMMISSIONED" }));
    const again = await adapter.submitTransactionDetailed(env("ASSET_STATE_CHANGE", ENGINEER, "DID:BEL:ENGINEER", { assetId: "VALVE-1", newState: "ACTIVE" }));
    expect(again.revert?.name).toBe("InvalidStateTransition");
  });

  it("runs the job workflow with rejection, re-assignment and verification", async () => {
    const m = (t: Transaction["type"], p: Record<string, unknown>) => env(t, MANAGER, "DID:BEL:MANAGER", p);
    const t = (w: string, did: string, type: Transaction["type"], p: Record<string, unknown>) => env(type, w, did, p);
    await ok(m("JOB_CREATE", { jobId: "J-1", assetId: "PUMP-1", priority: "HIGH" }));
    await ok(m("JOB_ASSIGN", { jobId: "J-1", technicianId: "DID:BEL:TECH" }));
    await ok(t(TECH, "DID:BEL:TECH", "JOB_START", { jobId: "J-1" }));
    await ok(t(TECH, "DID:BEL:TECH", "JOB_COMPLETE", { jobId: "J-1", evidenceHash: keccakText("report-1") }));
    await ok(t(AUDITOR, "DID:BEL:AUDITOR", "JOB_REJECT", { jobId: "J-1", reason: "missing torque values" }));
    expect((await adapter.getJob("J-1"))?.status).toBe("REJECTED");

    await ok(m("JOB_ASSIGN", { jobId: "J-1", technicianId: "DID:BEL:ENGINEER" }));
    const wrongTech = await adapter.submitTransactionDetailed(t(TECH, "DID:BEL:TECH", "JOB_START", { jobId: "J-1" }));
    expect(wrongTech.revert?.name).toBe("NotAssignedTechnician");
    await ok(t(ENGINEER, "DID:BEL:ENGINEER", "JOB_START", { jobId: "J-1" }));
    // SHA-256 hex without 0x (backend canonicalStateHash format) is accepted.
    await ok(t(ENGINEER, "DID:BEL:ENGINEER", "JOB_COMPLETE", { jobId: "J-1", evidenceHash: "ab".repeat(32) }));
    const self = await adapter.submitTransactionDetailed(t(ENGINEER, "DID:BEL:ENGINEER", "JOB_APPROVE", { jobId: "J-1" }));
    expect(self.revert?.name).toBe("VerifierIsTechnician");
    await ok(t(VERIFIER, "DID:BEL:VERIFIER", "JOB_APPROVE", { jobId: "J-1" }));

    expect(await adapter.getJob("J-1")).toMatchObject({
      jobId: "J-1", assetId: "PUMP-1", createdBy: "DID:BEL:MANAGER", assignedTo: "DID:BEL:ENGINEER",
      verifierId: "DID:BEL:VERIFIER", status: "VERIFIED", completedAt: expect.any(String),
    });
    const replay = await adapter.submitTransactionDetailed(t(VERIFIER, "DID:BEL:VERIFIER", "JOB_APPROVE", { jobId: "J-1" }));
    expect(replay.revert).toMatchObject({ name: "InvalidTransition", args: ["J-1", "5", "5"] });
    expect(await adapter.getJob("J-404")).toBeNull();
  });

  it("exposes the on-chain audit trail attributed to identities", async () => {
    const trail = await adapter.getAuditTrail("J-1");
    expect(trail.map((e) => e.action)).toEqual([
      "JOB_CREATE", "JOB_ASSIGN", "JOB_START", "JOB_COMPLETE", "JOB_REJECT", "JOB_ASSIGN", "JOB_START", "JOB_COMPLETE", "JOB_APPROVE",
    ]);
    expect(trail[0]).toMatchObject({ entityType: "JOB", entityId: "J-1", actorIdentityId: "DID:BEL:MANAGER" });
    expect(trail[4].actorIdentityId).toBe("DID:BEL:AUDITOR");
  });

  it("revoked wallets cannot transact; a replacement wallet keeps identity and role", async () => {
    await ok(asAdmin("WALLET_REVOKE", { address: TECH, reason: "device lost" }));
    expect(await adapter.getWallet(TECH)).toMatchObject({ status: "REVOKED", revokedReason: "device lost", identityId: "DID:BEL:TECH" });
    await ok(m("JOB_CREATE", { jobId: "J-2", assetId: "PUMP-1" }));
    const revoked = await adapter.submitTransactionDetailed(env("JOB_START", TECH, "DID:BEL:TECH", { jobId: "J-2" }));
    expect(revoked.revert).toMatchObject({ name: "InactiveWallet", args: [TECH] });

    await ok(asAdmin("WALLET_REGISTER", { identityId: "DID:BEL:TECH", walletAddress: TECH2 }));
    await ok(asAdmin("WALLET_ACTIVATE", { address: TECH2 }));
    expect(await adapter.getIdentity("DID:BEL:TECH")).toMatchObject({ role: "TECHNICIAN", status: "ACTIVE" });
    // DID resolution now picks the replacement wallet automatically.
    await ok(m("JOB_ASSIGN", { jobId: "J-2", technicianId: "DID:BEL:TECH" }));
    await ok(env("JOB_START", TECH2, "DID:BEL:TECH", { jobId: "J-2" }));

    function m(type: Transaction["type"], p: Record<string, unknown>) { return env(type, MANAGER, "DID:BEL:MANAGER", p); }
  });

  it("relays device-signed transactions and refuses tampered or unsigned ones", async () => {
    await onboard("DID:BEL:DEVICE-USER", DEVICE, "MANAGER");
    const device = new EvmWallet(key(8), provider);

    const sign = async (tx: Transaction) => {
      const p = await adapter.prepareTransaction(tx);
      expect(p.gasLimit).toMatch(/^\d+$/);
      expect(BigInt(p.gasLimit!)).toBeGreaterThan(0n);
      const raw = await device.signTransaction({ to: p.to, data: p.data, chainId: p.chainId, nonce: p.nonce, gasLimit: p.gasLimit, value: p.value });
      const parsed = EvmTransaction.from(raw);
      expect(parsed.gasLimit).toBe(BigInt(p.gasLimit!));
      return raw;
    };

    const assetCreate = env("ASSET_MINT", DEVICE, "DID:BEL:DEVICE-USER", { assetId: "ASSET-DEV", ownerId: "DID:BEL:DEVICE-USER", assetType: "DEVICE-OWNED" });
    const assetResult = await adapter.submitTransactionDetailed({ ...assetCreate, signature: await sign(assetCreate) });
    expect(assetResult.status).toBe("SUCCESS");
    expect(await adapter.getAsset("ASSET-DEV")).toMatchObject({ ownerId: "DID:BEL:DEVICE-USER", status: "ACTIVE" });

    const create = env("JOB_CREATE", DEVICE, "DID:BEL:DEVICE-USER", { jobId: "J-DEV", assetId: "PUMP-1" });
    const r = await adapter.submitTransactionDetailed({ ...create, signature: await sign(create) });
    expect(r.status).toBe("SUCCESS");
    expect((await adapter.getJob("J-DEV"))?.createdBy).toBe("DID:BEL:DEVICE-USER");

    // Envelope says J-OTHER, signature is for J-SIGNED: must not be relayed.
    const signedFor = env("JOB_CREATE", DEVICE, "DID:BEL:DEVICE-USER", { jobId: "J-SIGNED", assetId: "PUMP-1" });
    const claimed = env("JOB_CREATE", DEVICE, "DID:BEL:DEVICE-USER", { jobId: "J-OTHER", assetId: "PUMP-1" });
    await expect(adapter.submitTransaction({ ...claimed, signature: await sign(signedFor) })).rejects.toMatchObject({ kind: "SIGNER" });

    // Signed by someone other than actorWallet.
    const impersonate = env("JOB_CREATE", MANAGER, "DID:BEL:MANAGER", { jobId: "J-IMP", assetId: "PUMP-1" });
    const p = await adapter.prepareTransaction(impersonate);
    const forged = await device.signTransaction(await device.populateTransaction({ to: p.to, data: p.data, chainId: p.chainId }));
    await expect(adapter.submitTransaction({ ...impersonate, signature: forged })).rejects.toMatchObject({ kind: "SIGNER" });

    // No backend key and no device signature.
    await expect(adapter.submitTransaction(env("JOB_START", DEVICE, "DID:BEL:DEVICE-USER", { jobId: "J-DEV" }))).rejects.toBeInstanceOf(BlockchainError);
    expect(await adapter.getJob("J-SIGNED")).toBeNull();
    expect(await adapter.getJob("J-IMP")).toBeNull();
  });

  it("handles concurrent submissions from the same wallet without nonce clashes", async () => {
    const ids = ["J-C1", "J-C2", "J-C3", "J-C4", "J-C5"];
    const results = await Promise.all(
      ids.map((jobId) => adapter.submitTransactionDetailed(env("JOB_CREATE", MANAGER, "DID:BEL:MANAGER", { jobId, assetId: "PUMP-1" }))),
    );
    expect(results.map((r) => r.status)).toEqual(ids.map(() => "SUCCESS"));
    for (const jobId of ids) expect((await adapter.getJob(jobId))?.status).toBe("CREATED");
  });

  it("explains a stuck transaction on timeout (nonce gap) instead of just 'timed out'", async () => {
    // Keep the deliberately pending nonce-gap transaction off every wallet
    // used by the later PostgreSQL and cross-person integration suites.
    await onboard("DID:BEL:NONCE-GAP", NONCE_GAP, "MANAGER");
    const device = new EvmWallet(key(9), provider);
    const quick = new EvmBlockchainAdapter({ ...config, txTimeoutMs: 400 }, { provider });
    const envelope = env("JOB_CREATE", NONCE_GAP, "DID:BEL:NONCE-GAP", { jobId: "J-GAP", assetId: "PUMP-1" });
    const p = await quick.prepareTransaction(envelope);
    const populated = await device.populateTransaction({ to: p.to, data: p.data, chainId: p.chainId });
    const skipped = await device.signTransaction({ ...populated, nonce: Number(populated.nonce) + 5 });
    const err = await quick.submitTransaction({ ...envelope, signature: skipped }).catch((e) => e);
    expect(err).toBeInstanceOf(BlockchainError);
    expect(err).toMatchObject({ kind: "TIMEOUT" });
    expect(String(err.message)).toMatch(/nonce gap/);
    expect(await adapter.getJob("J-GAP")).toBeNull();
  });

  it("reports chain status and blocks", async () => {
    const status = await adapter.getStatus();
    expect(status.healthy).toBe(true);
    expect(status.height).toBeGreaterThan(10);
    // QBFT continues producing empty blocks after transactions. Find a recent
    // transaction-bearing block instead of assuming the chain tip has one.
    let block = null;
    for (let height = status.height; height >= Math.max(0, status.height - 100); height -= 1) {
      const candidate = await adapter.getBlock(height);
      if (candidate?.transactions.length) {
        block = candidate;
        break;
      }
    }
    expect(block).not.toBeNull();
    expect(block).toMatchObject({ committee: [] });
    expect(block!.transactions.length).toBeGreaterThan(0);
    expect(await adapter.getBlock(status.height + 1000)).toBeNull();
  });

  it("refuses to run against a chain whose id differs from the deployment", async () => {
    const wrong = new EvmBlockchainAdapter({ ...config, deployment: { ...config.deployment, chainId: 999 } }, { provider });
    await expect(wrong.submitTransaction(asAdmin("JOB_START", { jobId: "J-1" }))).rejects.toMatchObject({ kind: "CONFIG" });
  });
});
