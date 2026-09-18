// Lightweight runtime shape validators mirroring shared/types/index.ts.
// Kept dependency-free (no zod/joi) so every package can import this
// without pulling in a validation library of its own choice. If the
// team wants zod later, replace the bodies here and keep the exported
// function names stable so call sites don't change.

import {
  ROLES,
  IDENTITY_STATUSES,
  WALLET_STATUSES,
  ASSET_STATUSES,
  JOB_STATUSES,
  JOB_PRIORITIES,
} from "../enums";

function isOneOf<T extends readonly string[]>(value: unknown, allowed: T): value is T[number] {
  return typeof value === "string" && (allowed as readonly string[]).includes(value);
}

export function isValidRole(value: unknown): boolean {
  return isOneOf(value, ROLES);
}

export function validateIdentity(obj: any): string[] {
  const errors: string[] = [];
  if (typeof obj?.identityId !== "string") errors.push("identityId must be a string");
  if (obj?.employeeId !== null && typeof obj?.employeeId !== "string") errors.push("employeeId must be a string or null");
  if (obj?.role !== null && !isOneOf(obj?.role, ROLES)) errors.push(`role must be one of ${ROLES.join(", ")} or null`);
  if (!isOneOf(obj?.status, IDENTITY_STATUSES)) errors.push("status is invalid");
  return errors;
}

export function validateWallet(obj: any): string[] {
  const errors: string[] = [];
  if (typeof obj?.address !== "string") errors.push("address must be a string");
  if (typeof obj?.identityId !== "string") errors.push("identityId must be a string");
  if (!isOneOf(obj?.status, WALLET_STATUSES)) errors.push("status is invalid");
  return errors;
}

export function validateAuthorizationGrant(obj: any): string[] {
  const errors: string[] = [];
  if (typeof obj?.authorizationGrantId !== "string") errors.push("authorizationGrantId must be a string");
  if (typeof obj?.actorIdentityId !== "string") errors.push("actorIdentityId must be a string");
  if (typeof obj?.resourceId !== "string") errors.push("resourceId must be a string");
  if (typeof obj?.grantedByIdentityId !== "string") errors.push("grantedByIdentityId must be a string");
  if (typeof obj?.issuedAt !== "string") errors.push("issuedAt must be an ISO 8601 string");
  return errors;
}

export function validateAsset(obj: any): string[] {
  const errors: string[] = [];
  if (typeof obj?.assetId !== "string") errors.push("assetId must be a string");
  if (typeof obj?.nftId !== "string") errors.push("nftId must be a string");
  if (typeof obj?.ownerId !== "string") errors.push("ownerId must be a string");
  if (!isOneOf(obj?.status, ASSET_STATUSES)) errors.push("status is invalid");
  return errors;
}

export function validateJob(obj: any): string[] {
  const errors: string[] = [];
  if (typeof obj?.jobId !== "string") errors.push("jobId must be a string");
  if (typeof obj?.assetId !== "string") errors.push("assetId must be a string");
  if (!isOneOf(obj?.status, JOB_STATUSES)) errors.push("status is invalid");
  if (!isOneOf(obj?.priority, JOB_PRIORITIES)) errors.push("priority is invalid");
  return errors;
}
