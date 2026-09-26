// Machine-readable mirror of docs/RBAC_MATRIX.md. The markdown table is
// the human-readable source of truth; this file is the single artifact
// both the backend middleware and the frontend gating import, so the two
// cannot drift from each other. Person 5's contract modifiers must
// implement the same table independently on-chain.
//
// Owner: Person 1. Changing a cell here requires the same team approval
// as changing the markdown (Phase 2/3).

import { Role } from "../enums";

/** Every permission-gated action in docs/RBAC_MATRIX.md. */
export const ACTIONS = [
  "CREATE_EMPLOYEE",
  "REVOKE_WALLET",
  "ACTIVATE_WALLET",
  "REGISTER_ASSET",
  "CREATE_JOB",
  "ASSIGN_TECHNICIAN",
  "PERFORM_MAINTENANCE",
  "VERIFY_MAINTENANCE",
  "TRANSFER_ASSET",
  "VIEW_AUDIT_HISTORY",
  "VIEW_VALIDATOR_STATUS",
  "MANAGE_VALIDATORS",
] as const;
export type Action = (typeof ACTIONS)[number];

/**
 * ALLOW — unconditionally permitted.
 * DENY  — unconditionally refused.
 * AUTH  — permitted only if the actor holds an explicit per-resource
 *         authorization (the `auth` cell in the matrix).
 * OWN   — permitted only on records the actor created or is assigned to
 *         (the `own` cell in the matrix).
 */
export type Permission = "ALLOW" | "DENY" | "AUTH" | "OWN";

export const RBAC_MATRIX: Record<Action, Record<Role, Permission>> = {
  CREATE_EMPLOYEE: {
    ADMIN: "ALLOW", MANAGER: "DENY", ENGINEER: "DENY", TECHNICIAN: "DENY",
    AUDITOR: "DENY", ISSUER: "DENY", VERIFIER: "DENY",
  },
  REVOKE_WALLET: {
    ADMIN: "ALLOW", MANAGER: "DENY", ENGINEER: "DENY", TECHNICIAN: "DENY",
    AUDITOR: "DENY", ISSUER: "DENY", VERIFIER: "DENY",
  },
  ACTIVATE_WALLET: {
    ADMIN: "ALLOW", MANAGER: "DENY", ENGINEER: "DENY", TECHNICIAN: "DENY",
    AUDITOR: "DENY", ISSUER: "ALLOW", VERIFIER: "DENY",
  },
  REGISTER_ASSET: {
    ADMIN: "ALLOW", MANAGER: "ALLOW", ENGINEER: "ALLOW", TECHNICIAN: "DENY",
    AUDITOR: "DENY", ISSUER: "ALLOW", VERIFIER: "DENY",
  },
  CREATE_JOB: {
    ADMIN: "DENY", MANAGER: "ALLOW", ENGINEER: "ALLOW", TECHNICIAN: "DENY",
    AUDITOR: "DENY", ISSUER: "DENY", VERIFIER: "DENY",
  },
  ASSIGN_TECHNICIAN: {
    ADMIN: "DENY", MANAGER: "ALLOW", ENGINEER: "ALLOW", TECHNICIAN: "DENY",
    AUDITOR: "DENY", ISSUER: "DENY", VERIFIER: "DENY",
  },
  PERFORM_MAINTENANCE: {
    ADMIN: "DENY", MANAGER: "DENY", ENGINEER: "ALLOW", TECHNICIAN: "ALLOW",
    AUDITOR: "DENY", ISSUER: "DENY", VERIFIER: "DENY",
  },
  VERIFY_MAINTENANCE: {
    ADMIN: "DENY", MANAGER: "ALLOW", ENGINEER: "ALLOW", TECHNICIAN: "DENY",
    AUDITOR: "ALLOW", ISSUER: "DENY", VERIFIER: "ALLOW",
  },
  TRANSFER_ASSET: {
    ADMIN: "ALLOW", MANAGER: "ALLOW", ENGINEER: "AUTH", TECHNICIAN: "DENY",
    AUDITOR: "DENY", ISSUER: "DENY", VERIFIER: "DENY",
  },
  VIEW_AUDIT_HISTORY: {
    ADMIN: "ALLOW", MANAGER: "ALLOW", ENGINEER: "ALLOW", TECHNICIAN: "OWN",
    AUDITOR: "ALLOW", ISSUER: "DENY", VERIFIER: "ALLOW",
  },
  VIEW_VALIDATOR_STATUS: {
    ADMIN: "ALLOW", MANAGER: "ALLOW", ENGINEER: "ALLOW", TECHNICIAN: "ALLOW",
    AUDITOR: "ALLOW", ISSUER: "ALLOW", VERIFIER: "ALLOW",
  },
  MANAGE_VALIDATORS: {
    ADMIN: "ALLOW", MANAGER: "DENY", ENGINEER: "DENY", TECHNICIAN: "DENY",
    AUDITOR: "DENY", ISSUER: "DENY", VERIFIER: "DENY",
  },
};

export type PermissionContext = {
  /** Identity id of the actor making the request. */
  actorId?: string;
  /** Identity id that owns / is assigned to the target record. */
  resourceOwnerId?: string;
  /** Explicit grant identifier required by AUTH cells. */
  authorizationGrantId?: string;
  /**
   * True when the actor holds an explicit per-resource grant. Whoever
   * owns the resource (Person 2 for assets, Person 3 for jobs) supplies
   * this; the matrix itself does not store grants.
   */
  explicitlyAuthorized?: boolean;
};

export function permissionFor(role: Role, action: Action): Permission {
  return RBAC_MATRIX[action][role];
}

/** Resolves a matrix cell against the request context to a yes/no. */
export function can(role: Role, action: Action, ctx: PermissionContext = {}): boolean {
  switch (permissionFor(role, action)) {
    case "ALLOW":
      return true;
    case "DENY":
      return false;
    case "AUTH":
      return ctx.explicitlyAuthorized === true && Boolean(ctx.authorizationGrantId);
    case "OWN":
      return (
        ctx.actorId !== undefined &&
        ctx.resourceOwnerId !== undefined &&
        ctx.actorId === ctx.resourceOwnerId
      );
  }
}

/** Roles for which an action is never available — useful for UI gating. */
export function rolesDeniedFor(action: Action): Role[] {
  return (Object.keys(RBAC_MATRIX[action]) as Role[]).filter(
    (role) => RBAC_MATRIX[action][role] === "DENY"
  );
}
