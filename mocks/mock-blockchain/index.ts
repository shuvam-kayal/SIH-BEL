import type { BlockchainService } from "../../shared/api";
import type { Asset, Block, Identity, Job, Transaction, Validator, Wallet } from "../../shared/types";
import type { BlockchainStatus } from "../../shared/api";

export class MockBlockchainAdapter implements BlockchainService {
  private txCounter = 0;
  private readonly identities = new Map<string, Identity>();
  private readonly wallets = new Map<string, Wallet>();
  private readonly assets = new Map<string, Asset>();
  private readonly jobs = new Map<string, Job>();
  private readonly validators: Validator[] = [
    { validatorId: "val_0", publicKey: "0xMockPubKey0", status: "ACTIVE", joinedAt: new Date().toISOString() },
    { validatorId: "val_1", publicKey: "0xMockPubKey1", status: "ACTIVE", joinedAt: new Date().toISOString() },
    { validatorId: "val_2", publicKey: "0xMockPubKey2", status: "ACTIVE", joinedAt: new Date().toISOString() },
    { validatorId: "val_3", publicKey: "0xMockPubKey3", status: "ACTIVE", joinedAt: new Date().toISOString() },
  ];

  seedIdentity(identity: Identity): void { this.identities.set(identity.identityId, identity); }
  seedWallet(wallet: Wallet): void { this.wallets.set(wallet.address, wallet); }
  seedAsset(asset: Asset): void { this.assets.set(asset.assetId, asset); }
  seedJob(job: Job): void { this.jobs.set(job.jobId, job); }

  /** Every envelope accepted so far, in order (handy for assertions). */
  readonly submitted: Transaction[] = [];
  private nftCounter = 0;

  async submitTransaction(tx: Transaction) {
    this.txCounter += 1;
    this.submitted.push(tx);
    this.record(tx);
    return { txId: tx.txId || `mock-tx-${this.txCounter}`, status: "SUCCESS" as const };
  }

  // Best-effort read-after-write for asset/job transactions, using the same
  // payload fields as backend/src/blockchain/payloads.ts. The mock still
  // accepts everything and never enforces RBAC or state transitions — the
  // real contracts do (THREAT_MODEL: dev shortcut).
  private record(tx: Transaction): void {
    const p = (tx.payload ?? {}) as Record<string, unknown>;
    const s = (k: string) => (typeof p[k] === "string" && p[k] !== "" ? (p[k] as string) : undefined);
    const asset = s("assetId") ? this.assets.get(s("assetId")!) : undefined;
    const job = s("jobId") ? this.jobs.get(s("jobId")!) : undefined;
    const now = tx.timestamp || new Date().toISOString();
    switch (tx.type) {
      case "ASSET_MINT": {
        const id = s("assetId");
        if (!id || this.assets.has(id)) return;
        const owner = s("ownerId") ?? tx.actorIdentity;
        this.nftCounter += 1;
        this.assets.set(id, {
          assetId: id,
          nftId: String(this.nftCounter),
          assetType: s("assetType") ?? "",
          ownerId: owner,
          custodianId: s("custodianId") ?? owner,
          parentAssetId: s("parentAssetId") ?? null,
          status: "ACTIVE",
        });
        return;
      }
      case "ASSET_TRANSFER":
        if (asset && s("newOwnerId")) {
          asset.ownerId = s("newOwnerId")!;
          asset.custodianId = s("newCustodianId") ?? s("newOwnerId")!;
        }
        return;
      case "ASSET_STATE_CHANGE": {
        const state = s("newState") ?? s("status");
        if (asset && (state === "ACTIVE" || state === "IN_MAINTENANCE" || state === "DECOMMISSIONED")) asset.status = state;
        return;
      }
      case "COMPONENT_ATTACH":
      case "COMPONENT_REMOVE": {
        const component = this.assets.get(s("componentAssetId") ?? s("componentId") ?? "");
        if (component) component.parentAssetId = tx.type === "COMPONENT_ATTACH" ? s("parentAssetId") ?? null : null;
        return;
      }
      case "JOB_CREATE": {
        const id = s("jobId");
        if (!id || this.jobs.has(id) || !s("assetId")) return;
        const priority = s("priority");
        this.jobs.set(id, {
          jobId: id,
          assetId: s("assetId")!,
          createdBy: tx.actorIdentity,
          assignedTo: "",
          verifierId: s("verifierId") ?? null,
          status: "CREATED",
          priority: priority === "LOW" || priority === "HIGH" || priority === "CRITICAL" ? priority : "MEDIUM",
          createdAt: now,
          completedAt: null,
        });
        return;
      }
      case "JOB_ASSIGN":
        if (job) { job.assignedTo = s("technicianId") ?? job.assignedTo; job.status = "ASSIGNED"; }
        return;
      case "JOB_START":
        if (job) job.status = "IN_PROGRESS";
        return;
      case "JOB_COMPLETE":
        if (job) { job.status = "COMPLETED"; job.completedAt = now; }
        return;
      case "JOB_APPROVE":
        if (job) job.status = "VERIFIED";
        return;
      case "JOB_REJECT":
        if (job) job.status = "REJECTED";
        return;
      default:
        return;
    }
  }

  async getIdentity(identityId: string): Promise<Identity | null> { return this.identities.get(identityId) ?? null; }
  async getWallet(address: string): Promise<Wallet | null> { return this.wallets.get(address) ?? null; }
  async getAsset(id: string): Promise<Asset | null> { return this.assets.get(id) ?? null; }
  async getJob(id: string): Promise<Job | null> { return this.jobs.get(id) ?? null; }
  async getValidators(): Promise<Validator[]> { return [...this.validators]; }
  async getCommittee(height: number): Promise<string[]> {
    const active = this.validators.filter((v) => v.status === "ACTIVE");
    if (active.length === 0) return [];
    // Deterministic placeholder: base-v1 guarantees every node can derive the
    // same committee; Person 4 replaces only this algorithm, not its interface.
    const size = Math.max(1, Math.min(active.length, Math.ceil(active.length * 0.02)));
    const start = height % active.length;
    return Array.from({ length: size }, (_, i) => active[(start + i) % active.length].validatorId);
  }
  async getBlock(height: number): Promise<Block | null> {
    if (height < 0) return null;
    const committee = await this.getCommittee(height);
    return {
      height,
      leaderId: committee[0] ?? "",
      committee,
      transactions: [],
      finalizedAt: new Date().toISOString(),
    };
  }
  async getStatus(): Promise<BlockchainStatus> {
    return { height: 42, healthy: true, finalityLag: 0, lastFinalizedHeight: 42 };
  }
}
