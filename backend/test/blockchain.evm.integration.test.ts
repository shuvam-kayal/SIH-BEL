// Person 5: EvmBlockchainAdapter against real contracts on a local anvil
// chain. Skips (with a reason) when Foundry's `anvil` or the compiled
// artifacts in contracts/out are unavailable — run `npm run test:contracts`
// (or `forge build` in contracts/) first. Never silently "passes" without a chain.
import { spawn, spawnSync, type ChildProcess } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { ContractFactory, HDNodeWallet, JsonRpcProvider, Wallet as EvmWallet, NonceManager, id as keccakText } from "ethers";
import type { Transaction } from "../../shared/types";
import { BlockchainError, EvmBlockchainAdapter, loadAbis, type EvmChainConfig } from "../src/blockchain";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const OUT = resolve(ROOT, "contracts/out");
const MNEMONIC = "test test test test test test test test test test test junk"; // anvil's public dev mnemonic

function findAnvil(): string | null {
  const candidates = [process.env.ANVIL_BIN, resolve(homedir(), ".foundry/bin/anvil"), "anvil"].filter(Boolean) as string[];
  for (const c of candidates) {
    if (spawnSync(c, ["--version"], { stdio: "ignore" }).status === 0) return c;
  }
  return null;
}
const anvilBin = findAnvil();
const haveArtifacts = existsSync(resolve(OUT, "JobManager.sol/JobManager.json"));
const skipReason = !anvilBin ? "anvil not installed" : !haveArtifacts ? "contracts/out missing (run forge build)" : null;
if (skipReason) console.warn(`[blockchain.evm.integration] SKIPPED: ${skipReason}`);

const key = (i: number) => HDNodeWallet.fromPhrase(MNEMONIC, undefined, `m/44'/60'/0'/0/${i}`).privateKey;
const addr = (i: number) => new EvmWallet(key(i)).address;
const [ADMIN, MANAGER, ENGINEER, TECH, AUDITOR, VERIFIER, ISSUER, TECH2, DEVICE] = [0, 1, 2, 3, 4, 5, 6, 7, 8].map(addr);

describe.skipIf(skipReason !== null)("EvmBlockchainAdapter on anvil", () => {
  let anvil: ChildProcess;
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
    const port = 18545 + Math.floor(Math.random() * 1000);
    anvil = spawn(anvilBin!, ["--port", String(port), "--silent"], { stdio: "ignore" });
    provider = new JsonRpcProvider(`http://127.0.0.1:${port}`, 31337, { staticNetwork: true, pollingInterval: 50 });
    for (let i = 0; ; i++) {
      try { await provider.send("eth_chainId", []); break; } catch { if (i > 50) throw new Error("anvil did not start"); await new Promise((r) => setTimeout(r, 100)); }
    }

    // Same sequence as contracts/script/Deploy.s.sol.
    const deployer = new NonceManager(new EvmWallet(key(0), provider));
    const art = (name: string) => JSON.parse(readFileSync(resolve(OUT, `${name}.sol/${name}.json`), "utf8"));
    const deploy = async (name: string, ...args: unknown[]) => {
      const a = art(name);
      const c = await new ContractFactory(a.abi, a.bytecode.object, deployer).deploy(...args);
      await c.waitForDeployment();
      return c;
    };
    const identity = await deploy("IdentityRegistry", ADMIN, "DID:BEL:ADMIN");
    const roles = await deploy("RoleRegistry", await identity.getAddress(), ADMIN);
    const assets = await deploy("AssetRegistry");
    const jobs = await deploy("JobManager", await assets.getAddress());
    const addrs = await Promise.all([identity, roles, assets, jobs].map((c) => c.getAddress()));
    const audit = await deploy("AuditRegistry", addrs[0], addrs[1], addrs);
    const auditAddr = await audit.getAddress();
    for (const c of [identity, roles, assets, jobs]) {
      await (await (c.getFunction("wire"))(addrs[0], addrs[1], auditAddr)).wait();
    }

    config = {
      rpcUrl: `http://127.0.0.1:${port}`,
      deployment: {
        network: "vitest", chainId: 31337,
        contracts: { IdentityRegistry: addrs[0], RoleRegistry: addrs[1], AssetRegistry: addrs[2], JobManager: addrs[3], AuditRegistry: auditAddr },
      },
      abis: loadAbis(),
      confirmations: 1,
      txTimeoutMs: 10_000,
      devSignerKeys: [0, 1, 2, 3, 4, 5, 6, 7].map(key), // DEVICE (8) deliberately absent: it must use the signed-tx path
    };
    adapter = new EvmBlockchainAdapter(config, { provider });

    await onboard("DID:BEL:MANAGER", MANAGER, "MANAGER");
    await onboard("DID:BEL:ENGINEER", ENGINEER, "ENGINEER");
    await onboard("DID:BEL:TECH", TECH, "TECHNICIAN");
    await onboard("DID:BEL:AUDITOR", AUDITOR, "AUDITOR");
    await onboard("DID:BEL:VERIFIER", VERIFIER, "VERIFIER");
    await onboard("DID:BEL:ISSUER", ISSUER, "ISSUER");
  }, 60_000);

  afterAll(() => { anvil?.kill(); });

  it("identity and wallet reads reflect on-chain state", async () => {
    expect(await adapter.getWallet(TECH)).toMatchObject({ address: TECH, identityId: "DID:BEL:TECH", status: "ACTIVE", revokedAt: null });
    expect(await adapter.getIdentity("DID:BEL:TECH")).toMatchObject({ identityId: "DID:BEL:TECH", role: "TECHNICIAN", status: "ACTIVE" });
    expect(await adapter.getWallet(DEVICE)).toBeNull();
    expect(await adapter.getIdentity("DID:BEL:NOBODY")).toBeNull();
  });

  it("mints by owner identity, returns nftId, events and audit ids", async () => {
    const r = await ok(env("ASSET_MINT", ENGINEER, "DID:BEL:ENGINEER", { assetId: "PUMP-1", ownerId: "DID:BEL:MANAGER", assetType: "PUMP" }));
    expect(r.nftId).toBe("1");
    expect(r.hash).toMatch(/^0x[0-9a-f]{64}$/);
    expect(r.events.map((e) => e.name)).toEqual(expect.arrayContaining(["Transfer", "AssetMinted", "AuditRecorded"]));
    expect(r.auditTxIds).toHaveLength(1);
    expect(await adapter.getAsset("PUMP-1")).toMatchObject({ nftId: "1", ownerId: "DID:BEL:MANAGER", custodianId: "DID:BEL:MANAGER", status: "ACTIVE", parentAssetId: null });
    expect(await adapter.getAsset("NOPE")).toBeNull();
  });

  it("reports duplicates and unauthorized callers as decoded REJECTED results", async () => {
    const dup = await adapter.submitTransactionDetailed(asAdmin("ASSET_MINT", { assetId: "PUMP-1", ownerId: ADMIN }));
    expect(dup).toMatchObject({ status: "REJECTED", revert: { name: "AssetAlreadyExists", args: ["PUMP-1"] } });
    expect(dup.hash).toBeUndefined(); // caught in simulation: no gas spent

    const unauth = await adapter.submitTransaction(env("ASSET_MINT", TECH, "DID:BEL:TECH", { assetId: "X", ownerId: TECH }));
    expect(unauth).toEqual({ txId: expect.any(String), status: "REJECTED" });
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
      return device.signTransaction(await device.populateTransaction({ to: p.to, data: p.data, chainId: p.chainId }));
    };

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

  it("reports chain status and blocks", async () => {
    const status = await adapter.getStatus();
    expect(status.healthy).toBe(true);
    expect(status.height).toBeGreaterThan(10);
    const block = await adapter.getBlock(status.height);
    expect(block).toMatchObject({ height: status.height, committee: [] });
    expect(block!.transactions.length).toBeGreaterThan(0);
    expect(await adapter.getBlock(status.height + 1000)).toBeNull();
  });

  it("refuses to run against a chain whose id differs from the deployment", async () => {
    const wrong = new EvmBlockchainAdapter({ ...config, deployment: { ...config.deployment, chainId: 999 } }, { provider });
    await expect(wrong.submitTransaction(asAdmin("JOB_START", { jobId: "J-1" }))).rejects.toMatchObject({ kind: "CONFIG" });
  });
});
