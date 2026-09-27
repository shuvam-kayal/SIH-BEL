// Permission-boundary tests for docs/RBAC_MATRIX.md. These mirror the
// revert tests Person 5 writes in contracts/test/AccessControl.t.sol —
// if the two ever disagree, one of them has drifted from the matrix.

import { describe, expect, it } from "vitest";
import { ACTIONS, can, permissionFor, RBAC_MATRIX } from "../../shared/rbac";
import { ROLES } from "../../shared/enums";

describe("RBAC matrix integrity", () => {
  it("defines a cell for every role/action pair", () => {
    for (const action of ACTIONS) {
      for (const role of ROLES) {
        expect(RBAC_MATRIX[action][role], `${role} x ${action}`).toBeDefined();
      }
    }
  });
});

describe("denied actions", () => {
  it("only ADMIN may create an employee", () => {
    expect(can("ADMIN", "CREATE_EMPLOYEE")).toBe(true);
    for (const role of ROLES.filter((r) => r !== "ADMIN")) {
      expect(can(role, "CREATE_EMPLOYEE"), role).toBe(false);
    }
  });

  it("only ADMIN may revoke a wallet", () => {
    expect(can("ADMIN", "REVOKE_WALLET")).toBe(true);
    for (const role of ROLES.filter((r) => r !== "ADMIN")) {
      expect(can(role, "REVOKE_WALLET"), role).toBe(false);
    }
  });

  it("a technician may not transfer an asset", () => {
    expect(can("TECHNICIAN", "TRANSFER_ASSET")).toBe(false);
  });

  it("a technician may not assign a job", () => {
    expect(can("TECHNICIAN", "ASSIGN_TECHNICIAN")).toBe(false);
  });

  it("an auditor may not register or transfer assets", () => {
    expect(can("AUDITOR", "REGISTER_ASSET")).toBe(false);
    expect(can("AUDITOR", "TRANSFER_ASSET")).toBe(false);
  });

  it("an admin may not create or assign jobs", () => {
    expect(can("ADMIN", "CREATE_JOB")).toBe(false);
    expect(can("ADMIN", "ASSIGN_TECHNICIAN")).toBe(false);
  });
});

describe("conditional cells", () => {
  it("an engineer may transfer only with an explicit per-asset grant", () => {
    expect(permissionFor("ENGINEER", "TRANSFER_ASSET")).toBe("AUTH");
    expect(can("ENGINEER", "TRANSFER_ASSET")).toBe(false);
    expect(can("ENGINEER", "TRANSFER_ASSET", { explicitlyAuthorized: true, authorizationGrantId: "GRANT-001" })).toBe(true);
  });

  it("a technician sees audit history only for their own records", () => {
    expect(permissionFor("TECHNICIAN", "VIEW_AUDIT_HISTORY")).toBe("OWN");
    expect(can("TECHNICIAN", "VIEW_AUDIT_HISTORY", { actorId: "A", resourceOwnerId: "B" })).toBe(false);
    expect(can("TECHNICIAN", "VIEW_AUDIT_HISTORY", { actorId: "A", resourceOwnerId: "A" })).toBe(true);
  });

  it("every role can see validator status", () => {
    for (const role of ROLES) {
      expect(can(role, "VIEW_VALIDATOR_STATUS"), role).toBe(true);
    }
  });

  it("only ADMIN can manage validators", () => {
    expect(can("ADMIN", "MANAGE_VALIDATORS")).toBe(true);
    for (const role of ["MANAGER", "ENGINEER", "TECHNICIAN"] as const) expect(can(role, "MANAGE_VALIDATORS")).toBe(false);
  });
});
