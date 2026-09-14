// Frozen application API and blockchain adapter contracts.
// All six workstreams consume these types. Change only through an ADR + spec update.
import type { Asset, AuditEvent, Block, Identity, Job, Transaction, User, Validator, Wallet } from "./types";
import type { JobPriority, Role } from "./enums";

export type ApiErrorCode = "VALIDATION_FAILED" | "UNAUTHORIZED" | "FORBIDDEN" | "NOT_FOUND" | "NOT_IMPLEMENTED" | "INTERNAL_ERROR";
export type ApiError = { code: ApiErrorCode; message: string };
export type Session = { user: User; token: string };

export type CreateUserRequest = { employeeId: string; fullName: string; role: Role; department: string };
export type CreateUserResponse = { identity: Identity; user: User };
export type ActivateWalletRequest = { deviceId: string; walletAddress: string };
export type WalletActionResponse = { wallet: Wallet };
export type CreateAssetRequest = { assetId?: string; assetType: string; ownerId: string; custodianId: string; parentAssetId?: string | null };
export type TransferAssetRequest = { newOwnerId: string; newCustodianId?: string };
export type CreateJobRequest = { assetId: string; priority: JobPriority; verifierId?: string };
export type AssignJobRequest = { technicianId: string };
export type CompleteJobRequest = { evidenceHash: string };
export type RejectJobRequest = { reason: string };
export type BlockchainStatus = { height: number; healthy: boolean; finalityLag: number; lastFinalizedHeight: number };
export type CommitteeResponse = { height: number; validatorIds: string[] };

export interface ApiClient {
  login(deviceCredential?: string): Promise<Session>;
  createUser(input: CreateUserRequest): Promise<CreateUserResponse>;
  revokeWallet(userId: string, reason: string): Promise<WalletActionResponse>;
  activateWallet(userId: string, input: ActivateWalletRequest): Promise<WalletActionResponse>;
  getMe(): Promise<User>;
  getUser(id: string): Promise<User | null>;
  getAssets(): Promise<Asset[]>;
  getAsset(id: string): Promise<Asset | null>;
  createAsset(input: CreateAssetRequest): Promise<Asset>;
  transferAsset(id: string, input: TransferAssetRequest): Promise<Asset>;
  getJobs(): Promise<Job[]>;
  getJob(id: string): Promise<Job | null>;
  createJob(input: CreateJobRequest): Promise<Job>;
  assignJob(id: string, input: AssignJobRequest): Promise<Job>;
  startJob(id: string): Promise<Job>;
  completeJob(id: string, input: CompleteJobRequest): Promise<Job>;
  approveJob(id: string): Promise<Job>;
  rejectJob(id: string, input: RejectJobRequest): Promise<Job>;
  getAssetAuditTrail(assetId: string): Promise<AuditEvent[]>;
  getBlockchainStatus(): Promise<BlockchainStatus>;
  getValidators(): Promise<Validator[]>;
  getCommittee(height: number): Promise<CommitteeResponse>;
}

export type MockBlockchainResult = { txId: string; status: "SUCCESS" | "REJECTED" };
export interface BlockchainService {
  submitTransaction(tx: Transaction): Promise<MockBlockchainResult>;
  getIdentity(identityId: string): Promise<Identity | null>;
  getWallet(address: string): Promise<Wallet | null>;
  getAsset(id: string): Promise<Asset | null>;
  getJob(id: string): Promise<Job | null>;
  getValidators(): Promise<Validator[]>;
  getCommittee(height: number): Promise<string[]>;
  getBlock(height: number): Promise<Block | null>;
  getStatus(): Promise<BlockchainStatus>;
}
