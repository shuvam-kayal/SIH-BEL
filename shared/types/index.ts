// Frozen shared types per docs/DATA_MODEL.md. Every core object listed
// in docs/SYSTEM_SPEC.md has a definition here. Changing any of these
// requires team approval (see Phase 2 of the project plan).

import {
  Role,
  IdentityStatus,
  WalletStatus,
  AssetStatus,
  JobStatus,
  JobPriority,
  ValidatorStatus,
  AuditEntityType,
} from "../enums";

export {
  Role,
  IdentityStatus,
  WalletStatus,
  AssetStatus,
  JobStatus,
  JobPriority,
  ValidatorStatus,
  AuditEntityType,
};

export type Identity = {
  identityId: string;
  employeeId: string;
  fullName: string;
  role: Role;
  department: string;
  status: IdentityStatus;
  createdAt: string;
  verifiedAt?: string | null;
  verifiedBy?: string | null;
};

/** Public contract for the pending onboarding response. Pending fields are
 * intentionally nullable until administrator verification; active Identity
 * consumers continue to use the non-null verified shape above. */
export type PendingIdentity = Omit<Identity, "employeeId" | "role" | "department" | "status"> & {
  employeeId: string | null;
  role: Role | null;
  department: string | null;
  status: "PENDING";
};

export type Device = {
  deviceId: string;
  identityId: string;
  status: "PENDING" | "ACTIVE" | "REVOKED";
  registeredAt: string;
  activatedAt?: string | null;
  revokedAt: string | null;
  publicKey?: string | null;
  metadata?: Record<string, unknown> | null;
};

export type Wallet = {
  address: string;
  identityId: string;
  deviceId: string;
  status: WalletStatus;
  activatedAt: string | null;
  revokedAt: string | null;
  revokedReason: string | null;
  publicKey?: string | null;
};

export type ProvisioningChallenge = {
  challengeId: string;
  deviceId: string;
  challenge: string;
  purpose: "WALLET_INITIALIZATION" | "AUTHENTICATION" | "FRESH_AUTHENTICATION";
  expiresAt: string;
  usedAt: string | null;
  metadata?: Record<string, unknown> | null;
};

export type AuthorizationGrant = {
  authorizationGrantId: string;
  actorIdentityId: string;
  resourceType: "ASSET" | "JOB";
  resourceId: string;
  action: import("../rbac").Action;
  grantedByIdentityId: string;
  issuedAt: string;
  expiresAt: string | null;
  status: "ACTIVE" | "REVOKED" | "EXPIRED";
};

export type User = {
  employeeId: string;
  identityId: string;
  walletAddress: string;
  role: Role;
  department: string;
  status: IdentityStatus;
};

export type Asset = {
  assetId: string;
  nftId: string;
  assetType: string;
  ownerId: string;
  custodianId: string;
  parentAssetId?: string | null;
  status: AssetStatus;
};

export type Component = {
  componentId: string;
  parentAssetId: string;
  attachedAt: string;
  detachedAt: string | null;
  attachedBy: string;
};

export type Job = {
  jobId: string;
  assetId: string;
  createdBy: string;
  assignedTo: string;
  verifierId?: string | null;
  status: JobStatus;
  priority: JobPriority;
  createdAt: string;
  completedAt: string | null;
};

export type AuditEvent = {
  eventId: string;
  txId: string;
  entityType: AuditEntityType;
  entityId: string;
  action: string;
  actorIdentityId: string;
  timestamp: string;
};

export type Validator = {
  validatorId: string;
  publicKey: string;
  status: ValidatorStatus;
  joinedAt: string;
};

export type ValidatorRegistrationStatus = "PENDING" | "APPROVED" | "ACTIVE" | "INACTIVE" | "REJECTED" | "REMOVED";
export type ValidatorRegistration = {
  registrationId: string; validatorId: string; identityId: string; walletAddress: string;
  nodeId: string; nodeAddress: string; publicKey: string; signingPublicKey: string;
  status: ValidatorRegistrationStatus; requestedAt: string; approvedAt: string | null;
  approvedBy: string | null; activationHeight: number | null; removalHeight: number | null;
  removedAt: string | null; removalReason: string | null;
};
export type Transaction = {
  txId: string;
  type: import("../enums").TransactionType;
  actorIdentity: string;
  actorWallet: string;
  payload: Record<string, unknown>;
  timestamp: string;
  signature: string;
};

export type Block = {
  height: number;
  leaderId: string;
  committee: string[];
  transactions: string[];
  finalizedAt: string;
};

