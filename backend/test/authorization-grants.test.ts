import { beforeEach, describe, expect, it } from "vitest";
import { MockBlockchainAdapter } from "../../mocks/mock-blockchain";
import { UsersServiceImpl } from "../src/users/users.service";
import { clearIdentityStore } from "../src/users/identity.store";

describe("authorization grant foundation", () => {
  let users: UsersServiceImpl;
  let adminId: string;
  let engineerId: string;
  beforeEach(async () => {
    clearIdentityStore(); users = new UsersServiceImpl(new MockBlockchainAdapter());
    adminId = (await users.createUser({ employeeId: "GRANT-ADMIN", fullName: "Admin", role: "ADMIN", department: "TEST" })).identity.identityId;
    engineerId = (await users.createUser({ employeeId: "GRANT-ENGINEER", fullName: "Engineer", role: "ENGINEER", department: "TEST" })).identity.identityId;
  });

  it("accepts a valid grant and rejects wrong actor/resource/action", async () => {
    const grant = await users.createGrant(adminId, engineerId, { resourceType: "ASSET", resourceId: "ASSET-1", action: "TRANSFER_ASSET" });
    expect(await users.validateGrant(grant.authorizationGrantId, engineerId, "ASSET-1", "TRANSFER_ASSET")).toBe(true);
    expect(await users.validateGrant(grant.authorizationGrantId, adminId, "ASSET-1", "TRANSFER_ASSET")).toBe(false);
    expect(await users.validateGrant(grant.authorizationGrantId, engineerId, "ASSET-2", "TRANSFER_ASSET")).toBe(false);
    expect(await users.validateGrant(grant.authorizationGrantId, engineerId, "ASSET-1", "CREATE_JOB")).toBe(false);
    expect(await users.validateGrant("GRANT-MISSING", engineerId, "ASSET-1", "TRANSFER_ASSET")).toBe(false);
  });

  it("rejects expired and revoked grants", async () => {
    const expired = await users.createGrant(adminId, engineerId, { resourceType: "ASSET", resourceId: "ASSET-EXP", action: "TRANSFER_ASSET", expiresAt: new Date(Date.now() - 1000).toISOString() });
    expect(await users.validateGrant(expired.authorizationGrantId, engineerId, "ASSET-EXP", "TRANSFER_ASSET")).toBe(false);
    expect((await users.listGrants(engineerId)).find((item) => item.authorizationGrantId === expired.authorizationGrantId)?.status).toBe("EXPIRED");
    const active = await users.createGrant(adminId, engineerId, { resourceType: "ASSET", resourceId: "ASSET-REV", action: "TRANSFER_ASSET" });
    await users.revokeGrant(adminId, active.authorizationGrantId);
    expect(await users.validateGrant(active.authorizationGrantId, engineerId, "ASSET-REV", "TRANSFER_ASSET")).toBe(false);
  });

  it("enforces grant creation and revocation authorization", async () => {
    await expect(users.createGrant(engineerId, adminId, { resourceType: "ASSET", resourceId: "ASSET-1", action: "TRANSFER_ASSET" })).rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(users.createGrant(adminId, engineerId, { resourceType: "ASSET", resourceId: "ASSET-1", action: "CREATE_JOB" })).rejects.toMatchObject({ code: "FORBIDDEN" });
    const grant = await users.createGrant(adminId, engineerId, { resourceType: "ASSET", resourceId: "ASSET-2", action: "TRANSFER_ASSET" });
    await expect(users.revokeGrant(engineerId, grant.authorizationGrantId)).rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(users.revokeGrant(adminId, grant.authorizationGrantId)).resolves.toMatchObject({ status: "REVOKED" });
  });
});
