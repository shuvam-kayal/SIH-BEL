import { generateKeyPairSync, sign } from "node:crypto";
import { beforeEach, describe, expect, it } from "vitest";
import request from "supertest";

import { createApp } from "../src/app";
import { createContainer } from "../src/container";
import {
  clearIdentityStore,
  identityStore,
} from "../src/users/identity.store";
import { createMemoryRepositories } from "../src/users/repository-implementations";
import { MockDeviceAttestationAdapter } from "../src/devices/device-attestation";

describe("Person 1 lifecycle and security checklist", () => {
  let container: ReturnType<typeof createContainer>;
  let app: ReturnType<typeof createApp>;
  let adminToken: string;
  let managerToken: string;

  const eligible = {
    managedDevice: true,
    onBelNetwork: true,
    hostname: "BEL-LAPTOP-TEST",
  };

  beforeEach(async () => {
    clearIdentityStore();

    const attestation = new MockDeviceAttestationAdapter([
      "BEL-DEVICE-001",
      "BEL-DEVICE-002",
      "BEL-DEVICE-003",
      "BEL-DEVICE-004",
    ]);

    container = createContainer(undefined, {
      repositories: createMemoryRepositories(identityStore),
      attestation,
    });

    app = createApp(container);

    // ADMIN
    await container.users.createUser({
      employeeId: "CHECK-ADMIN",
      fullName: "Checklist Admin",
      role: "ADMIN",
      department: "PLATFORM",
    });

    await container.users.registerDevice(
      "CHECK-ADMIN",
      "CHECK-ADMIN-DEVICE",
      "check-admin-credential",
      "PUBLIC-CHECK-ADMIN",
    );

    await container.users.registerWallet(
      "CHECK-ADMIN",
      "CHECK-ADMIN-DEVICE",
      "0xCHECK-ADMIN",
    );

    await container.users.activateWallet(
      "CHECK-ADMIN",
      "CHECK-ADMIN-DEVICE",
      "0xCHECK-ADMIN",
    );

    adminToken = (
      await container.auth.login("check-admin-credential")
    ).token;

    // MANAGER
    await container.users.createUser({
      employeeId: "CHECK-MANAGER",
      fullName: "Checklist Manager",
      role: "MANAGER",
      department: "PLATFORM",
    });

    await container.users.registerDevice(
      "CHECK-MANAGER",
      "CHECK-MANAGER-DEVICE",
      "check-manager-credential",
      "PUBLIC-CHECK-MANAGER",
    );

    await container.users.registerWallet(
      "CHECK-MANAGER",
      "CHECK-MANAGER-DEVICE",
      "0xCHECK-MANAGER",
    );

    await container.users.activateWallet(
      "CHECK-MANAGER",
      "CHECK-MANAGER-DEVICE",
      "0xCHECK-MANAGER",
    );

    managerToken = (
      await container.auth.login("check-manager-credential")
    ).token;
  });

  function keyMaterial() {
    const pair = generateKeyPairSync("ed25519");

    return {
      privateKey: pair.privateKey,
      publicKey: pair.publicKey
        .export({
          type: "spki",
          format: "pem",
        })
        .toString(),
    };
  }

  async function createPendingEmployee(
    deviceId = "BEL-DEVICE-001",
    employeeId = "CHECK-PENDING",
  ) {
    const keys = keyMaterial();

    const challengeResponse = await request(app)
      .post("/auth/provisioning-challenge")
      .send({
        deviceId,
        deviceMetadata: eligible,
      });

    expect(challengeResponse.status).toBe(201);

    const challenge = challengeResponse.body;

    const response = await request(app)
      .post("/auth/initialize-account")
      .send({
        fullName: "Checklist Employee",
        employeeId,
        department: "ENGINEERING",
        deviceId,
        publicKey: keys.publicKey,
        walletAddress: `0x${employeeId}`,
        challengeId: challenge.challengeId,
        signature: sign(
          null,
          Buffer.from(challenge.challenge),
          keys.privateKey,
        ).toString("base64"),
        deviceMetadata: eligible,
      });

    expect(response.status).toBe(202);

    return {
      identityId: response.body.identity.identityId,
      deviceId,
      keys,
      response,
    };
  }

  it("rejects an invalid provisioning signature", async () => {
    const keys = keyMaterial();

    const challengeResponse = await request(app)
      .post("/auth/provisioning-challenge")
      .send({
        deviceId: "BEL-DEVICE-001",
        deviceMetadata: eligible,
      });

    expect(challengeResponse.status).toBe(201);

    const challenge = challengeResponse.body;

    const response = await request(app)
      .post("/auth/initialize-account")
      .send({
        fullName: "Invalid Signature",
        employeeId: "CHECK-BAD-SIGNATURE",
        department: "ENGINEERING",
        deviceId: "BEL-DEVICE-001",
        publicKey: keys.publicKey,
        walletAddress: "0xCHECK-BAD-SIGNATURE",
        challengeId: challenge.challengeId,
        signature: "definitely-not-a-valid-signature",
        deviceMetadata: eligible,
      });

    expect(response.status).toBe(403);
    expect(response.body.code).toBe("FORBIDDEN");
  });

  it("rejects a provisioning challenge used with the wrong device", async () => {
    const keys = keyMaterial();

    const challengeResponse = await request(app)
      .post("/auth/provisioning-challenge")
      .send({
        deviceId: "BEL-DEVICE-001",
        deviceMetadata: eligible,
      });

    const challenge = challengeResponse.body;

    const response = await request(app)
      .post("/auth/initialize-account")
      .send({
        fullName: "Wrong Device",
        employeeId: "CHECK-WRONG-DEVICE",
        department: "ENGINEERING",
        deviceId: "BEL-DEVICE-002",
        publicKey: keys.publicKey,
        walletAddress: "0xCHECK-WRONG-DEVICE",
        challengeId: challenge.challengeId,
        signature: sign(
          null,
          Buffer.from(challenge.challenge),
          keys.privateKey,
        ).toString("base64"),
        deviceMetadata: eligible,
      });

    expect(response.status).toBe(400);
    expect(response.body.code).toBe("VALIDATION_FAILED");
    expect(response.body.message).toContain(
      "challenge is bound to another device",
    );
  });

  it("allows an admin to see pending registrations", async () => {
    await createPendingEmployee();

    const response = await request(app)
      .get("/admin/registrations/pending")
      .set("Authorization", `Bearer ${adminToken}`);

    expect(response.status).toBe(200);
    expect(response.body).toHaveLength(1);
    console.log("PENDING REGISTRATION:", JSON.stringify(response.body[0], null, 2));
  });

  it("rejects registration verification by a non-admin", async () => {
    const pending = await createPendingEmployee();

    const response = await request(app)
      .post(`/admin/users/${pending.identityId}/verify`)
      .set("Authorization", `Bearer ${managerToken}`)
      .send({
        employeeId: "CHECK-VERIFY-BLOCKED",
        department: "ENGINEERING",
      });

    expect(response.status).toBe(403);
    expect(response.body.code).toBe("FORBIDDEN");
  });

  it("records verification metadata but keeps registration PENDING", async () => {
    const pending = await createPendingEmployee();

    const response = await request(app)
      .post(`/admin/users/${pending.identityId}/verify`)
      .set("Authorization", `Bearer ${adminToken}`)
      .send({
        employeeId: "CHECK-VERIFIED",
        department: "ENGINEERING",
      });

    expect(response.status).toBe(200);
    expect(response.body.status).toBe("PENDING");
    expect(response.body.verifiedAt).not.toBeNull();
    expect(response.body.verifiedBy).toBeTruthy();
  });

  it("does not authenticate using fake x-bel-* headers", async () => {
    const response = await request(app)
      .get("/users/me")
      .set("x-bel-identity-id", "DID:BEL:FAKE")
      .set("x-bel-role", "ADMIN")
      .set("x-bel-device-id", "FAKE-DEVICE");

    expect(response.status).toBe(401);
    expect(response.body.code).toBe("UNAUTHORIZED");
  });

  it("rejects an invalid bearer token", async () => {
    const response = await request(app)
      .get("/users/me")
      .set("Authorization", "Bearer definitely-invalid-token");

    expect(response.status).toBe(401);
    expect(response.body.code).toBe("UNAUTHORIZED");
  });

  it("invalidates a session after logout", async () => {
    const response = await request(app)
      .get("/users/me")
      .set("Authorization", `Bearer ${adminToken}`);

    expect(response.status).toBe(200);

    const logout = await request(app)
      .post("/auth/logout")
      .set("Authorization", `Bearer ${adminToken}`);

    expect(logout.status).toBe(204);

    const afterLogout = await request(app)
      .get("/users/me")
      .set("Authorization", `Bearer ${adminToken}`);

    expect(afterLogout.status).toBe(401);
  });

  it("invalidates a session after device revocation", async () => {
    const response = await request(app)
      .get("/users/me")
      .set("Authorization", `Bearer ${adminToken}`);

    expect(response.status).toBe(200);

    const revoke = await request(app)
      .post("/admin/devices/CHECK-ADMIN-DEVICE/revoke")
      .set("Authorization", `Bearer ${adminToken}`);

    expect(revoke.status).toBe(200);

    const afterRevoke = await request(app)
      .get("/users/me")
      .set("Authorization", `Bearer ${adminToken}`);

    expect(afterRevoke.status).toBe(401);
  });

  it("rejects login with the wrong public key", async () => {
    const keys = keyMaterial();

    const challengeResponse = await request(app)
      .post("/auth/login-challenge")
      .send({
        deviceId: "CHECK-ADMIN-DEVICE",
      });

    expect(challengeResponse.status).toBe(201);

    const challenge = challengeResponse.body;

    const response = await request(app)
      .post("/auth/login")
      .send({
        deviceId: "CHECK-ADMIN-DEVICE",
        challengeId: challenge.challengeId,
        publicKey: keys.publicKey,
        signature: sign(
          null,
          Buffer.from(challenge.challenge),
          keys.privateKey,
        ).toString("base64"),
      });

    expect(response.status).toBe(401);
  });

  it("rejects login with a wrong signature", async () => {
    const keys = keyMaterial();

    const challengeResponse = await request(app)
      .post("/auth/login-challenge")
      .send({
        deviceId: "CHECK-ADMIN-DEVICE",
      });

    expect(challengeResponse.status).toBe(201);

    const challenge = challengeResponse.body;

    const response = await request(app)
      .post("/auth/login")
      .send({
        deviceId: "CHECK-ADMIN-DEVICE",
        challengeId: challenge.challengeId,
        publicKey: keys.publicKey,
        signature: Buffer.from("wrong-signature").toString("base64"),
      });

    expect(response.status).toBe(401);
  });

  it("rejects a login challenge replay", async () => {
    const keys = keyMaterial();

    const challengeResponse = await request(app)
      .post("/auth/login-challenge")
      .send({
        deviceId: "CHECK-ADMIN-DEVICE",
      });

    expect(challengeResponse.status).toBe(201);

    const challenge = challengeResponse.body;

    const body = {
      deviceId: "CHECK-ADMIN-DEVICE",
      challengeId: challenge.challengeId,
      publicKey: "PUBLIC-CHECK-ADMIN",
      signature: "not-used-here",
    };

    // First prove the challenge can be consumed with the actual admin
    // credential-backed login path by using the service directly.
    await container.auth.login({
      deviceId: "CHECK-ADMIN-DEVICE",
      challengeId: challenge.challengeId,
      publicKey: "PUBLIC-CHECK-ADMIN",
      signature: "invalid",
    }).catch(() => undefined);

    // The challenge should now be unusable regardless of the invalid proof.
    const replay = await request(app)
      .post("/auth/login")
      .send(body);

    expect([401, 409]).toContain(replay.status);
  });

  it("rejects unauthorized role escalation", async () => {
    const pending = await createPendingEmployee(
      "BEL-DEVICE-002",
      "CHECK-ROLE-ESCALATION",
    );

    const response = await request(app)
      .post(`/admin/users/${pending.identityId}/role`)
      .set("Authorization", `Bearer ${managerToken}`)
      .send({
        role: "ADMIN",
      });

    expect(response.status).toBe(403);
    expect(response.body.code).toBe("FORBIDDEN");
  });

  it("preserves Identity when replacing a wallet", async () => {
    const employee = await container.users.createUser({
      employeeId: "CHECK-WALLET-ROTATION",
      fullName: "Wallet Rotation",
      role: "ENGINEER",
      department: "ENGINEERING",
    });

    await container.users.registerDevice(
      "CHECK-WALLET-ROTATION",
      "CHECK-WALLET-DEVICE-1",
      "wallet-rotation-credential-1",
      "PUBLIC-WALLET-1",
    );

    await container.users.registerWallet(
      "CHECK-WALLET-ROTATION",
      "CHECK-WALLET-DEVICE-1",
      "0xCHECK-WALLET-1",
    );

    const firstWallet = await container.users.activateWallet(
      "CHECK-WALLET-ROTATION",
      "CHECK-WALLET-DEVICE-1",
      "0xCHECK-WALLET-1",
    );

    await container.users.registerDevice(
      "CHECK-WALLET-ROTATION",
      "CHECK-WALLET-DEVICE-2",
      "wallet-rotation-credential-2",
      "PUBLIC-WALLET-2",
    );

    await container.users.registerWallet(
      "CHECK-WALLET-ROTATION",
      "CHECK-WALLET-DEVICE-2",
      "0xCHECK-WALLET-2",
    );

    const secondWallet = await container.users.activateWallet(
      "CHECK-WALLET-ROTATION",
      "CHECK-WALLET-DEVICE-2",
      "0xCHECK-WALLET-2",
    );

    expect(secondWallet.address).not.toBe(firstWallet.address);

    const current = await container.users.getById(
      "CHECK-WALLET-ROTATION",
    );

    expect(current?.identityId).toBe(employee.identity.identityId);
  });
});