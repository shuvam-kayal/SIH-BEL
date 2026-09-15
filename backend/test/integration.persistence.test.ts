import { beforeAll, afterAll, describe, expect, it } from "vitest";
import { MockBlockchainAdapter } from "../../mocks/mock-blockchain";
import { createContainer, type Container } from "../src/container";

const run = process.env.BEL_RUN_INTEGRATION === "true";
const suite = run ? describe : describe.skip;

suite("PostgreSQL persistence integration", () => {
  let container: Container;
  let adminId: string;
  let employeeId: string;
  let employeeToken: string;
  let employeeWallet: string;

  beforeAll(async () => {
    if (!process.env.DATABASE_URL) throw new Error("DATABASE_URL is required for PostgreSQL integration tests; no memory fallback is allowed");
    const cleanup = createContainer(new MockBlockchainAdapter());
    await cleanup.prisma?.$connect();
    await cleanup.prisma?.session.deleteMany();
    await cleanup.prisma?.authorizationGrant.deleteMany();
    await cleanup.prisma?.credential.deleteMany();
    await cleanup.prisma?.wallet.deleteMany();
    await cleanup.prisma?.device.deleteMany();
    await cleanup.prisma?.user.deleteMany();
    await cleanup.prisma?.identity.deleteMany();
    await cleanup.prisma?.$disconnect();

    container = createContainer(new MockBlockchainAdapter());
    await container.prisma?.$connect();
    const admin = await container.users.createUser({ employeeId: "INTEGRATION-ADMIN", fullName: "Integration Admin", role: "ADMIN", department: "TEST" });
    adminId = admin.identity.identityId;
    await container.users.registerDevice("INTEGRATION-ADMIN", "INTEGRATION-ADMIN-DEVICE", "integration-admin-secret");
    await container.users.activateWallet("INTEGRATION-ADMIN", "INTEGRATION-ADMIN-DEVICE");
    await container.auth.login("integration-admin-secret");

    employeeId = "INTEGRATION-EMPLOYEE";
    await container.users.createUser({ employeeId, fullName: "Integration Employee", role: "ENGINEER", department: "TEST" });
    await container.users.registerDevice(employeeId, "INTEGRATION-EMPLOYEE-DEVICE", "integration-employee-secret");
    const wallet = await container.users.activateWallet(employeeId, "INTEGRATION-EMPLOYEE-DEVICE");
    employeeWallet = wallet.address;
    employeeToken = (await container.auth.login("integration-employee-secret")).token;
  });

  afterAll(async () => { await container?.prisma?.$disconnect(); });

  it("persists the complete identity/device/credential/wallet/session lifecycle across a container restart", async () => {
    expect(await container.users.getById(employeeId)).toMatchObject({ employeeId, role: "ENGINEER" });
    expect((await container.users.listDevices(employeeId))[0]).toMatchObject({ deviceId: "INTEGRATION-EMPLOYEE-DEVICE", status: "ACTIVE" });
    expect((await container.users.listWallets(employeeId)).find((item) => item.address === employeeWallet)?.status).toBe("ACTIVE");
    expect(await container.auth.validateSession(employeeToken)).toMatchObject({ employeeId });

    await container.prisma?.$disconnect();
    container = createContainer(new MockBlockchainAdapter());
    await container.prisma?.$connect();
    expect(await container.users.getById(employeeId)).toMatchObject({ employeeId, role: "ENGINEER" });
    expect(await container.auth.login("integration-employee-secret")).toMatchObject({ user: { employeeId } });
  });

  it("persists wallet/device revocation, role changes, and grant lifecycle", async () => {
    await container.users.assignRole(adminId, employeeId, "MANAGER");
    expect((await container.users.getById(employeeId))?.role).toBe("MANAGER");
    const grant = await container.users.createGrant(adminId, employeeId, { resourceType: "ASSET", resourceId: "ASSET-INTEGRATION", action: "TRANSFER_ASSET" });
    expect((await container.users.listGrants(employeeId)).find((item) => item.authorizationGrantId === grant.authorizationGrantId)?.status).toBe("ACTIVE");
    expect(await container.users.validateGrant(grant.authorizationGrantId, (await container.users.getIdentity(employeeId))!.identityId, "ASSET-INTEGRATION", "TRANSFER_ASSET")).toBe(true);
    await container.users.revokeGrant(adminId, grant.authorizationGrantId);
    expect(await container.users.validateGrant(grant.authorizationGrantId, (await container.users.getIdentity(employeeId))!.identityId, "ASSET-INTEGRATION", "TRANSFER_ASSET")).toBe(false);
    await container.users.revokeWallet(employeeId, "integration test");
    expect((await container.users.listWallets(employeeId)).find((item) => item.address === employeeWallet)?.status).toBe("REVOKED");
    expect(await container.auth.validateSession(employeeToken)).toBeNull();
    await expect(container.auth.login("integration-employee-secret")).rejects.toMatchObject({ code: "UNAUTHORIZED" });

    await container.users.registerDevice(employeeId, "INTEGRATION-EMPLOYEE-REPLACEMENT", "integration-employee-replacement-secret");
    await container.users.activateWallet(employeeId, "INTEGRATION-EMPLOYEE-REPLACEMENT");
    await container.users.revokeDevice("INTEGRATION-EMPLOYEE-REPLACEMENT");
    expect((await container.users.listDevices(employeeId)).find((item) => item.deviceId === "INTEGRATION-EMPLOYEE-REPLACEMENT")?.status).toBe("REVOKED");
  });
});
