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

  async submitTransaction(tx: Transaction) {
    this.txCounter += 1;
    return { txId: tx.txId || `mock-tx-${this.txCounter}`, status: "SUCCESS" as const };
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
