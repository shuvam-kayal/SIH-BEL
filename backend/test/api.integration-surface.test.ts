import { afterAll, beforeAll, describe, expect, it } from "vitest";
import request from "supertest";
import { MockBlockchainAdapter } from "../../mocks/mock-blockchain";
import { createApp } from "../src/app";
import { createContainer } from "../src/container";
import { MemoryAssetRepository, MemoryJobRepository } from "../src/domain/repositories";
import { MemoryEvidenceStorage } from "../src/evidence/evidence.storage";
import { createMemoryRepositories } from "../src/users/repository-implementations";

/**
 * HTTP-level coverage for the routes that are not exercised by the longer
 * lifecycle suites. The adapter is intentionally mocked here: these tests
 * verify request/response shapes, middleware, and route composition. The
 * blockchain-dependent behavior remains covered by the real EVM suites.
 */
describe("backend HTTP integration surface", () => {
  const chain = new MockBlockchainAdapter();
  const container = createContainer(chain, {
    repositories: createMemoryRepositories(),
    assets: new MemoryAssetRepository(),
    jobs: new MemoryJobRepository(),
    evidenceStorage: new MemoryEvidenceStorage(),
  });
  const app = createApp(container);
  const tokens: Record<string, string> = {};
  const users: Record<string, { identityId: string; employeeId: string }> = {};
  const previousFreshAuth = process.env.BEL_FRESH_AUTH_REQUIRED_ACTIONS;

  async function seed(label: string, role: "ADMIN" | "ENGINEER" | "TECHNICIAN" | "VERIFIER") {
    const employeeId = `SURFACE-${label}`;
    const deviceId = `${employeeId}-DEVICE`;
    const credential = `${employeeId}-CREDENTIAL`;
    const walletAddress = `0xSURFACE-${label}`;
    const created = await container.users.createUser({ employeeId, fullName: label, role, department: "TEST" });
    await container.users.registerDevice(employeeId, deviceId, credential, `PUBLIC-${label}`);
    await container.users.registerWallet(employeeId, deviceId, walletAddress);
    await container.users.activateWallet(employeeId, deviceId, walletAddress);
    tokens[label] = (await container.auth.login(credential)).token;
    users[label] = { identityId: created.identity.identityId, employeeId };
  }

  const auth = (label: string) => ({ Authorization: `Bearer ${tokens[label]}` });

  beforeAll(async () => {
    // The route tests exercise ordinary session authorization. Fresh-auth
    // enforcement has dedicated coverage in fresh-auth.test.ts.
    delete process.env.BEL_FRESH_AUTH_REQUIRED_ACTIONS;
    await seed("ADMIN", "ADMIN");
    await seed("ENGINEER", "ENGINEER");
    await seed("TECHNICIAN", "TECHNICIAN");
    await seed("VERIFIER", "VERIFIER");
    await seed("LOGOUT", "TECHNICIAN");
    await seed("DEVICE", "TECHNICIAN");
  });

  afterAll(() => {
    if (previousFreshAuth === undefined) delete process.env.BEL_FRESH_AUTH_REQUIRED_ACTIONS;
    else process.env.BEL_FRESH_AUTH_REQUIRED_ACTIONS = previousFreshAuth;
  });

  it("covers user lookup, device management, wallet management, and session logout", async () => {
    const engineer = users.DEVICE;
    expect((await request(app).get(`/users/${engineer.employeeId}`).set(auth("ADMIN"))).status).toBe(200);

    const deviceId = "SURFACE-ENGINEER-SECOND-DEVICE";
    const device = await request(app)
      .post(`/admin/users/${engineer.employeeId}/devices`)
      .set(auth("ADMIN"))
      .send({ deviceId, credential: "surface-second-credential", publicKey: "PUBLIC-ENGINEER-SECOND" });
    expect(device.status).toBe(201);
    expect(device.body).toMatchObject({ deviceId, identityId: engineer.identityId, status: "ACTIVE" });
    expect((await request(app).get(`/admin/users/${engineer.employeeId}/devices`).set(auth("ADMIN"))).body).toEqual(expect.arrayContaining([expect.objectContaining({ deviceId })]));

    const walletAddress = "0xSURFACE-ENGINEER-SECOND";
    const pendingWallet = await request(app)
      .post(`/admin/users/${engineer.employeeId}/wallets`)
      .set(auth("ADMIN"))
      .send({ deviceId, walletAddress });
    expect(pendingWallet.status).toBe(201);
    expect(pendingWallet.body).toMatchObject({ address: walletAddress, status: "PENDING" });
    expect((await request(app).get(`/admin/users/${engineer.employeeId}/wallets`).set(auth("ADMIN"))).body).toEqual(expect.arrayContaining([expect.objectContaining({ address: walletAddress, status: "PENDING" })]));

    const activatedWallet = await request(app)
      .post(`/admin/users/${engineer.employeeId}/activate-wallet`)
      .set(auth("ADMIN"))
      .send({ deviceId, walletAddress });
    expect(activatedWallet.status).toBe(200);
    expect(activatedWallet.body.wallet).toMatchObject({ address: walletAddress, status: "ACTIVE" });

    const revokedDevice = await request(app).post(`/admin/devices/${deviceId}/revoke`).set(auth("ADMIN"));
    expect(revokedDevice.status).toBe(200);
    expect(revokedDevice.body).toMatchObject({ deviceId, status: "REVOKED" });

    const logout = await request(app).post("/auth/logout").set(auth("LOGOUT"));
    expect(logout.status).toBe(204);
    expect((await request(app).get("/users/me").set(auth("LOGOUT"))).status).toBe(401);
  });

  it("covers asset and job list/get/state-transition response shapes", async () => {
    const engineer = users.ENGINEER;
    const technician = users.TECHNICIAN;
    const verifier = users.VERIFIER;
    const assetId = "SURFACE-ASSET";
    const asset = await request(app).post("/assets").set(auth("ENGINEER")).send({ assetId, assetType: "PUMP", ownerId: technician.identityId, custodianId: technician.identityId });
    expect(asset.status).toBe(201);
    expect(asset.body).toMatchObject({ assetId, assetType: "PUMP", ownerId: technician.identityId, custodianId: technician.identityId, status: "ACTIVE" });
    expect((await request(app).get("/assets").set(auth("ENGINEER"))).body).toEqual(expect.arrayContaining([expect.objectContaining({ assetId })]));
    expect((await request(app).get(`/assets/${assetId}`).set(auth("ENGINEER"))).body).toMatchObject({ assetId });

    const grant = await container.users.createGrant(users.ADMIN.identityId, engineer.identityId, { resourceType: "ASSET", resourceId: assetId, action: "TRANSFER_ASSET" });
    expect(grant.status).toBe("ACTIVE");
    const transfer = await request(app).post(`/assets/${assetId}/transfer`).set(auth("ENGINEER")).send({ newOwnerId: engineer.identityId, newCustodianId: engineer.identityId });
    expect(transfer.status).toBe(200);
    expect(transfer.body).toMatchObject({ assetId, ownerId: engineer.identityId, custodianId: engineer.identityId });

    const jobId = "SURFACE-JOB";
    const created = await request(app).post("/jobs").set(auth("ENGINEER")).send({ jobId, assetId, priority: "HIGH" });
    expect(created.status).toBe(201);
    expect(created.body).toMatchObject({ jobId, assetId, status: "CREATED" });
    expect((await request(app).get("/jobs").set(auth("ENGINEER"))).body).toEqual(expect.arrayContaining([expect.objectContaining({ jobId })]));
    expect((await request(app).get(`/jobs/${jobId}`).set(auth("ENGINEER"))).body).toMatchObject({ jobId });
    expect((await request(app).post(`/jobs/${jobId}/assign`).set(auth("ENGINEER")).send({ technicianId: technician.identityId })).body.status).toBe("ASSIGNED");
    expect((await request(app).post(`/jobs/${jobId}/start`).set(auth("TECHNICIAN"))).body.status).toBe("IN_PROGRESS");
    expect((await request(app).post(`/jobs/${jobId}/complete`).set(auth("TECHNICIAN")).send({ evidenceHash: "ab".repeat(32) })).body.status).toBe("COMPLETED");
    expect((await request(app).post(`/jobs/${jobId}/approve`).set(auth("VERIFIER"))).body).toMatchObject({ jobId, status: "VERIFIED" });
    expect(verifier.identityId).toBeTruthy();
  });

  it("covers rejection, audit, blockchain read surfaces, validator administration, and errors", async () => {
    const assetId = "SURFACE-REJECT-ASSET";
    await request(app).post("/assets").set(auth("ENGINEER")).send({ assetId, assetType: "TOOL", ownerId: users.TECHNICIAN.identityId, custodianId: users.TECHNICIAN.identityId });
    const created = await request(app).post("/jobs").set(auth("ENGINEER")).send({ jobId: "SURFACE-REJECT-JOB", assetId, priority: "LOW" });
    await request(app).post(`/jobs/${created.body.jobId}/assign`).set(auth("ENGINEER")).send({ technicianId: users.TECHNICIAN.identityId });
    await request(app).post(`/jobs/${created.body.jobId}/start`).set(auth("TECHNICIAN"));
    await request(app).post(`/jobs/${created.body.jobId}/complete`).set(auth("TECHNICIAN")).send({ evidenceHash: "cd".repeat(32) });
    const rejected = await request(app).post(`/jobs/${created.body.jobId}/reject`).set(auth("VERIFIER")).send({ reason: "repeat inspection" });
    expect(rejected.status, JSON.stringify(rejected.body)).toBe(200);
    expect(rejected.body.status).toBe("REJECTED");

    expect((await request(app).get(`/audit/assets/${assetId}`).set(auth("TECHNICIAN"))).status).toBe(200);
    expect((await request(app).get("/blockchain/status")).body).toMatchObject({ height: 42, healthy: true });
    expect((await request(app).get("/blockchain/validators").set(auth("TECHNICIAN"))).body).toHaveLength(4);
    expect((await request(app).get("/blockchain/committee/42").set(auth("TECHNICIAN"))).body).toEqual({ height: 42, validatorIds: ["val_2"] });

    const add = await request(app).post("/admin/validators").set(auth("ADMIN")).send({ validatorId: "0x0000000000000000000000000000000000000001", nodeAddress: "node-1", publicKey: "pub", signingPublicKey: "sign", activationHeight: 50 });
    expect(add.status).toBe(201);
    expect((await request(app).get("/admin/validators").set(auth("ADMIN"))).body).toEqual(expect.arrayContaining([expect.objectContaining({ validatorId: "0x0000000000000000000000000000000000000001", status: "PENDING" })]));
    expect((await request(app).get("/admin/validators/history").set(auth("ADMIN"))).body).toEqual(expect.arrayContaining([expect.objectContaining({ operation: "VALIDATOR_ADD" })]));
    expect((await request(app).post("/admin/validators/0x0000000000000000000000000000000000000001/remove").set(auth("ADMIN")).send({ removalHeight: 60, reason: "retire" })).status).toBe(200);
    expect((await request(app).post("/admin/validators/0x0000000000000000000000000000000000000001/remove/cancel").set(auth("ADMIN")).send({ reason: "keep" })).status).toBe(200);

    expect((await request(app).get("/blockchain/committee/not-a-height").set(auth("TECHNICIAN"))).status).toBe(400);
    expect((await request(app).post("/assets").set(auth("ENGINEER")).send({})).body.code).toBe("VALIDATION_FAILED");
    expect((await request(app).get("/admin/validators").set(auth("TECHNICIAN"))).status).toBe(403);
    expect((await request(app).get("/jobs/does-not-exist").set(auth("ENGINEER"))).status).toBe(404);
  });
});
