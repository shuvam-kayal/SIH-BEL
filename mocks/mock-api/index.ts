import type { ApiClient, BlockchainStatus, CommitteeResponse, CreateAssetRequest, CreateJobRequest, CreateUserRequest, Session, TransferAssetRequest, ActivateWalletRequest, AssignJobRequest, CompleteJobRequest, RejectJobRequest, WalletActionResponse, CreateUserResponse } from "../../shared/api";
import type { AuditEvent, Asset, Identity, Job, User, Validator, Wallet } from "../../shared/types";

const now = () => new Date().toISOString();
const seedIdentity: Identity = { identityId: "DID:BEL:001", employeeId: "EMP001", fullName: "Demo Engineer", role: "ENGINEER", department: "MAINTENANCE", status: "ACTIVE", createdAt: now() };
const seedWallet: Wallet = { address: "0xMockWallet001", identityId: seedIdentity.identityId, deviceId: "BEL-DEV-001", status: "ACTIVE", activatedAt: now(), revokedAt: null, revokedReason: null };
const seedUser: User = { employeeId: seedIdentity.employeeId, identityId: seedIdentity.identityId, walletAddress: seedWallet.address, role: seedIdentity.role, department: seedIdentity.department, status: seedIdentity.status };

let identities: Identity[] = [seedIdentity];
let wallets: Wallet[] = [seedWallet];
let users: User[] = [seedUser];
let assets: Asset[] = [{ assetId: "AST-001", nftId: "1", assetType: "AIRCRAFT_PART", ownerId: seedIdentity.identityId, custodianId: seedIdentity.identityId, parentAssetId: null, status: "ACTIVE" }];
let jobs: Job[] = [{ jobId: "JOB-001", assetId: "AST-001", createdBy: seedIdentity.identityId, assignedTo: seedIdentity.identityId, verifierId: null, status: "CREATED", priority: "MEDIUM", createdAt: now(), completedAt: null }];
const auditLog: Record<string, AuditEvent[]> = {};
const validators: Validator[] = [
  { validatorId: "val_0", publicKey: "0xMockPubKey0", status: "ACTIVE", joinedAt: now() },
  { validatorId: "val_1", publicKey: "0xMockPubKey1", status: "ACTIVE", joinedAt: now() },
  { validatorId: "val_2", publicKey: "0xMockPubKey2", status: "ACTIVE", joinedAt: now() },
  { validatorId: "val_3", publicKey: "0xMockPubKey3", status: "ACTIVE", joinedAt: now() },
];

function recordAudit(entityType: AuditEvent["entityType"], entityId: string, action: string): void {
  const event: AuditEvent = { eventId: `evt_${Date.now()}_${Math.random().toString(16).slice(2)}`, txId: `mock-tx-${Date.now()}`, entityType, entityId, action, actorIdentityId: seedIdentity.identityId, timestamp: now() };
  auditLog[entityId] = [...(auditLog[entityId] ?? []), event];
}

function requireAsset(id: string): Asset { const asset = assets.find((a) => a.assetId === id); if (!asset) throw new Error(`Asset ${id} not found`); return asset; }
function requireJob(id: string): Job { const job = jobs.find((j) => j.jobId === id); if (!job) throw new Error(`Job ${id} not found`); return job; }

export const mockApi: ApiClient = {
  async login(_deviceCredential = "mock-device-credential"): Promise<Session> { return { user: seedUser, token: "mock-session-token" }; },
  async createUser(input: CreateUserRequest): Promise<CreateUserResponse> {
    const identity: Identity = { identityId: `DID:BEL:${identities.length + 1}`, employeeId: input.employeeId, fullName: input.fullName, role: input.role, department: input.department, status: "ACTIVE", createdAt: now() };
    const wallet: Wallet = { address: `0xMockWallet${String(identities.length + 1).padStart(3, "0")}`, identityId: identity.identityId, deviceId: "PENDING", status: "PENDING", activatedAt: null, revokedAt: null, revokedReason: null };
    const user: User = { employeeId: identity.employeeId, identityId: identity.identityId, walletAddress: wallet.address, role: identity.role, department: identity.department, status: identity.status };
    identities = [...identities, identity]; wallets = [...wallets, wallet]; users = [...users, user]; recordAudit("IDENTITY", identity.identityId, "IDENTITY_CREATE");
    return { identity, user };
  },
  async revokeWallet(userId: string, reason: string): Promise<WalletActionResponse> {
    const user = users.find((u) => u.employeeId === userId);
    if (!user) throw new Error(`User ${userId} not found`);
    const wallet = wallets.find((w) => w.address === user.walletAddress);
    if (!wallet) throw new Error(`Wallet ${user.walletAddress} not found`);
    wallet.status = "REVOKED"; wallet.revokedAt = now(); wallet.revokedReason = reason; recordAudit("WALLET", wallet.address, "WALLET_REVOKE");
    return { wallet: { ...wallet } };
  },
  async activateWallet(userId: string, input: ActivateWalletRequest): Promise<WalletActionResponse> {
    const user = users.find((u) => u.employeeId === userId); if (!user) throw new Error(`User ${userId} not found`);
    const wallet: Wallet = { address: input.walletAddress, identityId: user.identityId, deviceId: input.deviceId, status: "ACTIVE", activatedAt: now(), revokedAt: null, revokedReason: null };
    wallets = [...wallets.filter((w) => w.identityId !== user.identityId || w.status !== "ACTIVE"), wallet];
    user.walletAddress = wallet.address; recordAudit("WALLET", wallet.address, "WALLET_ACTIVATE"); return { wallet: { ...wallet } };
  },
  async getMe(): Promise<User> { return { ...seedUser }; },
  async getUser(id: string): Promise<User | null> { return users.find((u) => u.employeeId === id) ?? null; },
  async getAssets(): Promise<Asset[]> { return assets.map((a) => ({ ...a })); },
  async getAsset(id: string): Promise<Asset | null> { const a = assets.find((x) => x.assetId === id); return a ? { ...a } : null; },
  async createAsset(input: CreateAssetRequest): Promise<Asset> {
    const asset: Asset = { assetId: input.assetId ?? `AST-${String(assets.length + 1).padStart(3, "0")}`, nftId: String(assets.length + 1), assetType: input.assetType, ownerId: input.ownerId, custodianId: input.custodianId, parentAssetId: input.parentAssetId ?? null, status: "ACTIVE" };
    assets = [...assets, asset]; recordAudit("ASSET", asset.assetId, "ASSET_MINT"); return { ...asset };
  },
  async transferAsset(id: string, input: TransferAssetRequest): Promise<Asset> {
    const asset = requireAsset(id); asset.ownerId = input.newOwnerId; asset.custodianId = input.newCustodianId ?? input.newOwnerId; recordAudit("ASSET", id, "ASSET_TRANSFER"); return { ...asset };
  },
  async getJobs(): Promise<Job[]> { return jobs.map((j) => ({ ...j })); },
  async getJob(id: string): Promise<Job | null> { const j = jobs.find((x) => x.jobId === id); return j ? { ...j } : null; },
  async createJob(input: CreateJobRequest): Promise<Job> {
    const job: Job = { jobId: `JOB-${String(jobs.length + 1).padStart(3, "0")}`, assetId: input.assetId, createdBy: seedIdentity.identityId, assignedTo: "", verifierId: input.verifierId ?? null, status: "CREATED", priority: input.priority, createdAt: now(), completedAt: null };
    jobs = [...jobs, job]; recordAudit("JOB", job.jobId, "JOB_CREATE"); return { ...job };
  },
  async assignJob(id: string, input: AssignJobRequest): Promise<Job> { const job = requireJob(id); job.assignedTo = input.technicianId; job.status = "ASSIGNED"; recordAudit("JOB", id, "JOB_ASSIGN"); return { ...job }; },
  async startJob(id: string): Promise<Job> { const job = requireJob(id); job.status = "IN_PROGRESS"; recordAudit("JOB", id, "JOB_START"); return { ...job }; },
  async completeJob(id: string, _input: CompleteJobRequest): Promise<Job> { const job = requireJob(id); job.status = "COMPLETED"; job.completedAt = now(); recordAudit("JOB", id, "JOB_COMPLETE"); return { ...job }; },
  async approveJob(id: string): Promise<Job> { const job = requireJob(id); job.status = "VERIFIED"; job.verifierId = seedIdentity.identityId; recordAudit("JOB", id, "JOB_APPROVE"); return { ...job }; },
  async rejectJob(id: string, _input: RejectJobRequest): Promise<Job> { const job = requireJob(id); job.status = "REJECTED"; recordAudit("JOB", id, "JOB_REJECT"); return { ...job }; },
  async getAssetAuditTrail(assetId: string): Promise<AuditEvent[]> { return [...(auditLog[assetId] ?? [])]; },
  async getBlockchainStatus(): Promise<BlockchainStatus> { return { height: 42, healthy: true, finalityLag: 0, lastFinalizedHeight: 42 }; },
  async getValidators(): Promise<Validator[]> { return validators.map((v) => ({ ...v })); },
  async getCommittee(height: number): Promise<CommitteeResponse> {
    const ids = validators.filter((v) => v.status === "ACTIVE").map((v) => v.validatorId);
    const size = Math.max(1, Math.min(ids.length, Math.ceil(ids.length * 0.02))); const start = ids.length ? height % ids.length : 0;
    return { height, validatorIds: Array.from({ length: size }, (_, i) => ids[(start + i) % ids.length]) };
  },
};

export type MockApi = typeof mockApi;
