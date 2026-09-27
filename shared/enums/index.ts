// Frozen per docs/SYSTEM_SPEC.md and docs/DATA_MODEL.md.
// Changing any of these requires team approval (see Phase 2 of the project plan).

export const ROLES = [
  "ADMIN",
  "MANAGER",
  "ENGINEER",
  "TECHNICIAN",
  "AUDITOR",
  "ISSUER",
  "VERIFIER",
] as const;
export type Role = (typeof ROLES)[number];

export const IDENTITY_STATUSES = ["PENDING", "ACTIVE", "SUSPENDED", "REVOKED"] as const;
export type IdentityStatus = (typeof IDENTITY_STATUSES)[number];

export const WALLET_STATUSES = ["PENDING", "ACTIVE", "REVOKED"] as const;
export type WalletStatus = (typeof WALLET_STATUSES)[number];

export const ASSET_STATUSES = ["ACTIVE", "IN_MAINTENANCE", "DECOMMISSIONED"] as const;
export type AssetStatus = (typeof ASSET_STATUSES)[number];

export const JOB_STATUSES = [
  "CREATED",
  "ASSIGNED",
  "IN_PROGRESS",
  "COMPLETED",
  "VERIFIED",
  "REJECTED",
] as const;
export type JobStatus = (typeof JOB_STATUSES)[number];

export const JOB_PRIORITIES = ["LOW", "MEDIUM", "HIGH", "CRITICAL"] as const;
export type JobPriority = (typeof JOB_PRIORITIES)[number];

export const VALIDATOR_STATUSES = ["ACTIVE", "INACTIVE", "SLASHED"] as const;
export type ValidatorStatus = (typeof VALIDATOR_STATUSES)[number];

export const AUDIT_ENTITY_TYPES = ["ASSET", "JOB", "IDENTITY", "DEVICE", "WALLET", "GRANT", "VALIDATOR"] as const;
export type AuditEntityType = (typeof AUDIT_ENTITY_TYPES)[number];

// Mirrors docs/CONTRACT_SPEC.md — every on-chain transaction type.
export const TRANSACTION_TYPES = [
  "IDENTITY_CREATE",
  "IDENTITY_REGISTER",
  "ROLE_ASSIGN",
  "ROLE_REVOKE",
  "WALLET_REGISTER",
  "WALLET_ACTIVATE",
  "WALLET_REVOKE",
  "ASSET_MINT",
  "ASSET_TRANSFER",
  "ASSET_STATE_CHANGE",
  "JOB_CREATE",
  "JOB_ASSIGN",
  "JOB_START",
  "JOB_COMPLETE",
  "JOB_APPROVE",
  "JOB_REJECT",
  "COMPONENT_ATTACH",
  "COMPONENT_REMOVE",
  "VALIDATOR_ADD",
  "VALIDATOR_REMOVE",
  "VALIDATOR_RESTORE",
  "VALIDATOR_REMOVE_CANCEL",
  "GRANT_CREATE",
  "GRANT_REVOKE",
] as const;
export type TransactionType = (typeof TRANSACTION_TYPES)[number];



