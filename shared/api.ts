// Frozen application API and blockchain adapter contracts.
// All six workstreams consume these types. Change only through an ADR + spec update.
import type { Asset, AuditEvent, Block, Identity, Job, PendingIdentity, Transaction, User, Validator, Wallet, Device, ProvisioningChallenge, ValidatorRegistration, ValidatorHistoryRecord } from "./types";
import type { JobPriority, Role } from "./enums";

export type ApiErrorCode = "VALIDATION_FAILED" | "UNAUTHORIZED" | "FORBIDDEN" | "NOT_FOUND" | "CONFLICT" | "NOT_IMPLEMENTED" | "INTERNAL_ERROR";
export type ApiError = { code: ApiErrorCode; message: string };
/** Returned after backend verification of a device-signed challenge. */
export type Session = { user: User; token: string };
/** Transport shape only: the device authenticator signs locally; the frontend never collects key material or local verification data. */
export type LoginProofRequest = { deviceId: string; challengeId: string; publicKey: string; signature: string };

export type CreateUserRequest = { employeeId: string; fullName: string; role: Role; department: string };
export type CreateUserResponse = { identity: Identity; user: User };
export type InitializeAccountRequest = {
  fullName: string;
  employeeId?: string;
  department?: string;
  deviceId: string;
  publicKey: string;
  walletAddress: string;
  challengeId: string;
  signature: string;
  deviceMetadata: Record<string, unknown>;
};
export type ProvisioningChallengeRequest = { deviceId: string; deviceMetadata: Record<string, unknown> };
export type PendingRegistration = { identity: Identity | PendingIdentity; device: Device; wallet: Wallet };
export type VerifyRegistrationRequest = { employeeId: string; department: string };
export type AssignRoleRequest = { role: Role };
export type RegisterDeviceRequest = { deviceId: string; credential?: string; publicKey?: string };
export type RegisterWalletRequest = { deviceId: string; walletAddress: string };
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
export type ValidatorAddInput = { validatorId: string; nodeAddress: string; publicKey: string; signingPublicKey: string; activationHeight: number };
export type ValidatorRemovalInput = { removalHeight: number; reason: string };
export type ValidatorRestoreInput = { reason: string };

export interface ApiClient {
  login(input?: string | LoginProofRequest): Promise<Session>;
  requestProvisioningChallenge(input: ProvisioningChallengeRequest): Promise<ProvisioningChallenge>;
  initializeAccount(input: InitializeAccountRequest): Promise<PendingRegistration>;
  requestAuthenticationChallenge(deviceId: string): Promise<ProvisioningChallenge>;
  getPendingRegistrations(): Promise<PendingRegistration[]>;
  verifyRegistration(id: string, input: VerifyRegistrationRequest): Promise<Identity | PendingIdentity>;
  assignRole(id: string, input: AssignRoleRequest): Promise<User>;
  activateRegistration(id: string): Promise<PendingRegistration>;
  registerDevice(userId: string, input: RegisterDeviceRequest): Promise<Device>;
  getDevices(userId: string): Promise<Device[]>;
  registerWallet(userId: string, input: RegisterWalletRequest): Promise<Wallet>;
  getWallets(userId: string): Promise<Wallet[]>;
  revokeDevice(deviceId: string): Promise<Device>;
  createUser(input: CreateUserRequest): Promise<CreateUserResponse>;
  revokeWallet(userId: string, reason: string): Promise<WalletActionResponse>;
  activateWallet(userId: string, input: ActivateWalletRequest): Promise<WalletActionResponse>;
  logout(): Promise<void>;
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
  getValidatorHistory(): Promise<ValidatorHistoryRecord[]>;
  addValidator(input: ValidatorAddInput): Promise<ValidatorRegistration>;
  removeValidator(id: string, input: ValidatorRemovalInput): Promise<ValidatorRegistration>;
  restoreValidator(id: string, input: ValidatorRestoreInput): Promise<ValidatorRegistration>;
  getCommittee(height: number): Promise<CommitteeResponse>;

}

export type MockBlockchainResult = { txId: string; status: "SUCCESS" | "REJECTED"; transactionHash?: string; blockNumber?: number; event?: string };
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
