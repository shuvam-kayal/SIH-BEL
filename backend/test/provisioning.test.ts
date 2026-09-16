import { generateKeyPairSync, sign } from "node:crypto";
import { beforeEach, describe, expect, it } from "vitest";
import request from "supertest";
import { createApp } from "../src/app";
import { createContainer } from "../src/container";
import { clearIdentityStore, identityStore } from "../src/users/identity.store";
import { createMemoryRepositories } from "../src/users/repository-implementations";

describe("employee self-initialization protocol", () => {
  let container: ReturnType<typeof createContainer>;
  let app: ReturnType<typeof createApp>;
  let adminToken: string;

  beforeEach(async () => {
    clearIdentityStore();
    container = createContainer(undefined, { repositories: createMemoryRepositories(identityStore) });
    app = createApp(container);
    await container.users.createUser({ employeeId: "BOOTSTRAP-ADMIN", fullName: "BEL Admin", role: "ADMIN", department: "PLATFORM" });
    await container.users.registerDevice("BOOTSTRAP-ADMIN", "BOOTSTRAP-ADMIN-DEVICE", "bootstrap-admin-credential");
    await container.users.activateWallet("BOOTSTRAP-ADMIN", "BOOTSTRAP-ADMIN-DEVICE");
    adminToken = (await container.auth.login("bootstrap-admin-credential")).token;
  });

  function keyMaterial() {
    const pair = generateKeyPairSync("ed25519");
    return {
      privateKey: pair.privateKey,
      publicKey: pair.publicKey.export({ type: "spki", format: "pem" }).toString(),
    };
  }

  const eligible = { managedDevice: true, onBelNetwork: true, hostname: "BEL-LAPTOP-001" };

  it("creates pending identity, device, and wallet from a device proof", async () => {
    const keys = keyMaterial();
    const challengeResponse = await request(app).post("/auth/provisioning-challenge").send({ deviceId: "BEL-DEVICE-001", deviceMetadata: eligible });
    expect(challengeResponse.status).toBe(201);
    const challenge = challengeResponse.body;
    const response = await request(app).post("/auth/initialize-account").send({
      fullName: "Ada Employee",
      employeeId: "ADA-PENDING",
      department: "ENGINEERING",
      deviceId: "BEL-DEVICE-001",
      publicKey: keys.publicKey,
      walletAddress: "0xPUBLIC-ADA-001",
      challengeId: challenge.challengeId,
      signature: sign(null, Buffer.from(challenge.challenge), keys.privateKey).toString("base64"),
      deviceMetadata: eligible,
    });

    expect(response.status).toBe(202);
    expect(response.body.identity.status).toBe("PENDING");
    expect(response.body.identity.role).toBeNull();
    expect(response.body.device.status).toBe("PENDING");
    expect(response.body.wallet.status).toBe("PENDING");
    expect(JSON.stringify(response.body)).not.toContain("privateKey");
    expect(response.body).not.toHaveProperty("privateKey");
  });

  it("rejects ineligible devices, private-key fields, and replayed challenges", async () => {
    const rejected = await request(app).post("/auth/provisioning-challenge").send({ deviceId: "UNTRUSTED", deviceMetadata: { managedDevice: false, onBelNetwork: true } });
    expect(rejected.status).toBe(403);

    const keys = keyMaterial();
    const challengeResponse = await request(app).post("/auth/provisioning-challenge").send({ deviceId: "BEL-DEVICE-002", deviceMetadata: eligible });
    const challenge = challengeResponse.body;
    const body = {
      fullName: "Replay Test",
      deviceId: "BEL-DEVICE-002",
      publicKey: keys.publicKey,
      walletAddress: "0xPUBLIC-REPLAY-001",
      challengeId: challenge.challengeId,
      signature: sign(null, Buffer.from(challenge.challenge), keys.privateKey).toString("base64"),
      deviceMetadata: eligible,
      privateKey: "must-not-be-accepted",
    };
    expect((await request(app).post("/auth/initialize-account").send(body)).status).toBe(400);
    delete (body as { privateKey?: string }).privateKey;
    expect((await request(app).post("/auth/initialize-account").send(body)).status).toBe(202);
    expect((await request(app).post("/auth/initialize-account").send(body)).status).toBe(409);
  });

  it("keeps the registration pending until an administrator verifies, assigns, and activates it", async () => {
    const keys = keyMaterial();
    const challenge = (await request(app).post("/auth/provisioning-challenge").send({ deviceId: "BEL-DEVICE-003", deviceMetadata: eligible })).body;
    const initialized = await request(app).post("/auth/initialize-account").send({
      fullName: "Pending Employee", deviceId: "BEL-DEVICE-003", publicKey: keys.publicKey, walletAddress: "0xPUBLIC-PENDING-003",
      challengeId: challenge.challengeId, signature: sign(null, Buffer.from(challenge.challenge), keys.privateKey).toString("base64"), deviceMetadata: eligible,
    });
    const identityId = initialized.body.identity.identityId;
    expect((await request(app).post("/auth/login-challenge").send({ deviceId: "BEL-DEVICE-003" })).status).toBe(401);

    expect((await request(app).get("/admin/registrations/pending").set("Authorization", `Bearer ${adminToken}`)).body).toHaveLength(1);
    expect((await request(app).post(`/admin/users/${identityId}/verify`).set("Authorization", `Bearer ${adminToken}`).send({ employeeId: "EMP-003", department: "ENGINEERING" })).status).toBe(200);
    expect((await request(app).post(`/admin/users/${identityId}/role`).set("Authorization", `Bearer ${adminToken}`).send({ role: "ENGINEER" })).status).toBe(200);
    const activated = await request(app).post(`/admin/users/${identityId}/activate`).set("Authorization", `Bearer ${adminToken}`).send({});

    expect(activated.status).toBe(200);
    expect(activated.body.identity.status).toBe("ACTIVE");
    expect(activated.body.device.status).toBe("ACTIVE");
    expect(activated.body.wallet.status).toBe("ACTIVE");
    expect((await request(app).get("/admin/registrations/pending").set("Authorization", `Bearer ${adminToken}`)).body).toHaveLength(0);

    const loginChallenge = (await request(app).post("/auth/login-challenge").send({ deviceId: "BEL-DEVICE-003" })).body;
    const login = await request(app).post("/auth/login").send({
      deviceId: "BEL-DEVICE-003", challengeId: loginChallenge.challengeId, publicKey: keys.publicKey,
      signature: sign(null, Buffer.from(loginChallenge.challenge), keys.privateKey).toString("base64"),
    });
    expect(login.status).toBe(200);
    expect(login.body.user.employeeId).toBe("EMP-003");
  });
});
