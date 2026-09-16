import { beforeAll, afterAll, describe, expect, it } from "vitest";
import request from "supertest";
import { MockBlockchainAdapter } from "../../mocks/mock-blockchain";
import { createApp } from "../src/app";
import { createContainer, type Container } from "../src/container";
import { MemoryIntegrityAdapter } from "../src/integrity/integrity";

const run = process.env.BEL_RUN_INTEGRATION === "true";
const suite = run ? describe : describe.skip;

suite("PostgreSQL persistence integration", () => {
  let container: Container;
  let adminId: string;
  let adminToken: string;
  let employeeId: string;
  let employeeToken: string;
  let employeeWallet: string;
  const integrity = new MemoryIntegrityAdapter();

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

    container = createContainer(new MockBlockchainAdapter(), { integrity });
    expect(container.prisma).toBeDefined();
    await container.prisma?.$connect();
    const admin = await container.users.createUser({ employeeId: "INTEGRATION-ADMIN", fullName: "Integration Admin", role: "ADMIN", department: "TEST" });
    adminId = admin.identity.identityId;
    await container.users.registerDevice("INTEGRATION-ADMIN", "INTEGRATION-ADMIN-DEVICE", "integration-admin-secret", "PUBLIC-INTEGRATION-ADMIN");
    await container.users.registerWallet("INTEGRATION-ADMIN", "INTEGRATION-ADMIN-DEVICE", "0xTEST-INTEGRATION-ADMIN");
    await container.users.activateWallet("INTEGRATION-ADMIN", "INTEGRATION-ADMIN-DEVICE", "0xTEST-INTEGRATION-ADMIN");
    adminToken = (await container.auth.login("integration-admin-secret")).token;

    employeeId = "INTEGRATION-EMPLOYEE";
    await container.users.createUser({ employeeId, fullName: "Integration Employee", role: "ENGINEER", department: "TEST" });
    await container.users.registerDevice(employeeId, "INTEGRATION-EMPLOYEE-DEVICE", "integration-employee-secret", "PUBLIC-INTEGRATION-EMPLOYEE");
    await container.users.registerWallet(employeeId, "INTEGRATION-EMPLOYEE-DEVICE", "0xTEST-INTEGRATION-EMPLOYEE");
    const wallet = await container.users.activateWallet(employeeId, "INTEGRATION-EMPLOYEE-DEVICE", "0xTEST-INTEGRATION-EMPLOYEE");
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
    container = createContainer(new MockBlockchainAdapter(), { integrity });
    await container.prisma?.$connect();
    expect(await container.users.getById(employeeId)).toMatchObject({ employeeId, role: "ENGINEER" });
    employeeToken = (await container.auth.login("integration-employee-secret")).token;
    adminToken = (await container.auth.login("integration-admin-secret")).token;
    const app = createApp(container);
    expect((await request(app).get("/users/me").set("Authorization", `Bearer ${employeeToken}`)).status).toBe(200);
    expect((await request(app).get("/users/me").set("Authorization", `Bearer ${employeeToken}`)).body.employeeId).toBe(employeeId);
    expect(integrity.commitments.length).toBeGreaterThan(0);
  });

  it("persists wallet/device revocation, role changes, and grant lifecycle", async () => {
    await container.users.assignRole(adminId, employeeId, "MANAGER");
    expect((await container.users.getById(employeeId))?.role).toBe("MANAGER");
    const grant = await container.users.createGrant(adminId, employeeId, { resourceType: "ASSET", resourceId: "ASSET-INTEGRATION", action: "TRANSFER_ASSET" });
    expect((await container.users.listGrants(employeeId)).find((item) => item.authorizationGrantId === grant.authorizationGrantId)?.status).toBe("ACTIVE");
    expect(await container.users.validateGrant(grant.authorizationGrantId, (await container.users.getIdentity(employeeId))!.identityId, "ASSET-INTEGRATION", "TRANSFER_ASSET")).toBe(true);
    await container.users.revokeGrant(adminId, grant.authorizationGrantId);
    expect(await container.users.validateGrant(grant.authorizationGrantId, (await container.users.getIdentity(employeeId))!.identityId, "ASSET-INTEGRATION", "TRANSFER_ASSET")).toBe(false);
    await expect(container.prisma!.authorizationGrant.create({ data: {
      authorizationGrantId: "GRANT-INTEGRATION-INVALID-IDENTITY",
      actorIdentityId: "DID:BEL:DOES-NOT-EXIST",
      resourceType: "ASSET",
      resourceId: "ASSET-INTEGRATION",
      action: "TRANSFER_ASSET",
      grantedByIdentityId: adminId,
      issuedAt: new Date(),
      expiresAt: null,
      status: "ACTIVE",
    } as any })).rejects.toThrow();
    const app = createApp(container);
    const revokeWallet = await request(app)
      .post(`/admin/users/${employeeId}/revoke-wallet`)
      .set("Authorization", `Bearer ${adminToken}`)
      .send({ reason: "integration test" });
    expect(revokeWallet.status).toBe(200);
    expect((await container.users.listWallets(employeeId)).find((item) => item.address === employeeWallet)?.status).toBe("REVOKED");
    expect(await container.auth.validateSession(employeeToken)).toBeNull();
    expect((await request(app).get("/users/me").set("Authorization", `Bearer ${employeeToken}`)).status).toBe(401);
    await expect(container.auth.login("integration-employee-secret")).rejects.toMatchObject({ code: "UNAUTHORIZED" });

    await container.users.registerDevice(employeeId, "INTEGRATION-EMPLOYEE-REPLACEMENT", "integration-employee-replacement-secret", "PUBLIC-INTEGRATION-REPLACEMENT");
    await container.users.registerWallet(employeeId, "INTEGRATION-EMPLOYEE-REPLACEMENT", "0xTEST-INTEGRATION-REPLACEMENT");
    await container.users.activateWallet(employeeId, "INTEGRATION-EMPLOYEE-REPLACEMENT", "0xTEST-INTEGRATION-REPLACEMENT");
    const revokeDevice = await request(app).post("/admin/devices/INTEGRATION-EMPLOYEE-REPLACEMENT/revoke").set("Authorization", `Bearer ${adminToken}`);
    expect(revokeDevice.status).toBe(200);
    expect((await container.users.listDevices(employeeId)).find((item) => item.deviceId === "INTEGRATION-EMPLOYEE-REPLACEMENT")?.status).toBe("REVOKED");
    for (const eventType of ["IDENTITY_CREATE", "DEVICE_REGISTER", "WALLET_ACTIVATE", "ROLE_ASSIGN", "GRANT_CREATE", "GRANT_REVOKE", "WALLET_REVOKE", "DEVICE_REVOKE"]) {
      expect(integrity.commitments.some((item) => item.eventType === eventType), eventType).toBe(true);
    }
  });
});
