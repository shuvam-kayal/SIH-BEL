import { describe, expect, it } from "vitest";
import { ACTIONS, can, RBAC_MATRIX, type Permission } from "../../shared/rbac";
import { ROLES } from "../../shared/enums";

const expected: Record<string, Record<string, Permission>> = {
  CREATE_EMPLOYEE: { ADMIN: "ALLOW", MANAGER: "DENY", ENGINEER: "DENY", TECHNICIAN: "DENY", AUDITOR: "DENY", ISSUER: "DENY", VERIFIER: "DENY" },
  REVOKE_WALLET: { ADMIN: "ALLOW", MANAGER: "DENY", ENGINEER: "DENY", TECHNICIAN: "DENY", AUDITOR: "DENY", ISSUER: "DENY", VERIFIER: "DENY" },
  ACTIVATE_WALLET: { ADMIN: "ALLOW", MANAGER: "DENY", ENGINEER: "DENY", TECHNICIAN: "DENY", AUDITOR: "DENY", ISSUER: "ALLOW", VERIFIER: "DENY" },
  REGISTER_ASSET: { ADMIN: "ALLOW", MANAGER: "ALLOW", ENGINEER: "ALLOW", TECHNICIAN: "DENY", AUDITOR: "DENY", ISSUER: "ALLOW", VERIFIER: "DENY" },
  CREATE_JOB: { ADMIN: "DENY", MANAGER: "ALLOW", ENGINEER: "ALLOW", TECHNICIAN: "DENY", AUDITOR: "DENY", ISSUER: "DENY", VERIFIER: "DENY" },
  ASSIGN_TECHNICIAN: { ADMIN: "DENY", MANAGER: "ALLOW", ENGINEER: "ALLOW", TECHNICIAN: "DENY", AUDITOR: "DENY", ISSUER: "DENY", VERIFIER: "DENY" },
  PERFORM_MAINTENANCE: { ADMIN: "DENY", MANAGER: "DENY", ENGINEER: "ALLOW", TECHNICIAN: "ALLOW", AUDITOR: "DENY", ISSUER: "DENY", VERIFIER: "DENY" },
  VERIFY_MAINTENANCE: { ADMIN: "DENY", MANAGER: "ALLOW", ENGINEER: "ALLOW", TECHNICIAN: "DENY", AUDITOR: "ALLOW", ISSUER: "DENY", VERIFIER: "ALLOW" },
  TRANSFER_ASSET: { ADMIN: "ALLOW", MANAGER: "ALLOW", ENGINEER: "AUTH", TECHNICIAN: "DENY", AUDITOR: "DENY", ISSUER: "DENY", VERIFIER: "DENY" },
  VIEW_AUDIT_HISTORY: { ADMIN: "ALLOW", MANAGER: "ALLOW", ENGINEER: "ALLOW", TECHNICIAN: "OWN", AUDITOR: "ALLOW", ISSUER: "DENY", VERIFIER: "ALLOW" },
  VIEW_VALIDATOR_STATUS: { ADMIN: "ALLOW", MANAGER: "ALLOW", ENGINEER: "ALLOW", TECHNICIAN: "ALLOW", AUDITOR: "ALLOW", ISSUER: "ALLOW", VERIFIER: "ALLOW" },
  MANAGE_VALIDATORS: { ADMIN: "ALLOW", MANAGER: "DENY", ENGINEER: "DENY", TECHNICIAN: "DENY", AUDITOR: "DENY", ISSUER: "DENY", VERIFIER: "DENY" },
};

describe("frozen RBAC matrix", () => {
  it("enforces every role x action cell", () => {
    for (const action of ACTIONS) for (const role of ROLES) {
      expect(RBAC_MATRIX[action][role], `${role} x ${action} permission`).toBe(expected[action][role]);
      const permission = expected[action][role];
      const context = permission === "AUTH" ? { explicitlyAuthorized: true, authorizationGrantId: "GRANT-TEST" } : permission === "OWN" ? { actorId: "OWNER", resourceOwnerId: "OWNER" } : {};
      expect(can(role, action, context), `${role} x ${action} resolution`).toBe(permission !== "DENY");
    }
  });
});
