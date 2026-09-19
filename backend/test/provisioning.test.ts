import { generateKeyPairSync, sign } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import request from "supertest";
import { createApp } from "../src/app";
import { createContainer } from "../src/container";
import { clearIdentityStore, identityStore } from "../src/users/identity.store";
import { createMemoryRepositories } from "../src/users/repository-implementations";
import { MockDeviceAttestationAdapter } from "../src/devices/device-attestation";
import { MockBlockchainAdapter } from "../../mocks/mock-blockchain";
import { SigningKey, Wallet } from "ethers";

describe("employee self-initialization protocol", () => {
  let container: ReturnType<typeof createContainer>;
  let app: ReturnType<typeof createApp>;
  let adminToken: string;

  beforeEach(async () => {
    clearIdentityStore();
    const attestation = new MockDeviceAttestationAdapter(["BEL-DEVICE-001", "BEL-DEVICE-002", "BEL-DEVICE-003"]);
    container = createContainer(undefined, { repositories: createMemoryRepositories(identityStore), attestation });
    app = createApp(container);
    await container.users.createUser({ employeeId: "BOOTSTRAP-ADMIN", fullName: "BEL Admin", role: "ADMIN", department: "PLATFORM" });
    await container.users.registerDevice("BOOTSTRAP-ADMIN", "BOOTSTRAP-ADMIN-DEVICE", "bootstrap-admin-credential", "PUBLIC-BOOTSTRAP-ADMIN");
    await container.users.registerWallet("BOOTSTRAP-ADMIN", "BOOTSTRAP-ADMIN-DEVICE", "0xTEST-BOOTSTRAP-ADMIN");
    await container.users.activateWallet("BOOTSTRAP-ADMIN", "BOOTSTRAP-ADMIN-DEVICE", "0xTEST-BOOTSTRAP-ADMIN");
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
    expect(response.body.wallet.address).toBe("0xPUBLIC-ADA-001");
    expect(response.body.wallet.address).not.toMatch(/^0xBEL/);
    expect(JSON.stringify(response.body)).not.toContain("privateKey");
    expect(response.body).not.toHaveProperty("privateKey");
  });

  it("rejects ineligible devices, private-key fields, and replayed challenges", async () => {
    const rejected = await request(app).post("/auth/provisioning-challenge").send({ deviceId: "UNTRUSTED", deviceMetadata: { managedDevice: true, onBelNetwork: true } });
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

  it("rejects private-key material nested in device metadata", async () => {
    const response = await request(app).post("/auth/provisioning-challenge").send({
      deviceId: "BEL-DEVICE-001",
      deviceMetadata: { hardware: { wallet: { privateKey: "secret" } } },
    });
    expect(response.status).toBe(400);
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

  it("does not create a wallet for the old admin seed path", async () => {
    await container.users.createUser({ employeeId: "NO-FAKE-WALLET", fullName: "No Fake Wallet", role: "ENGINEER", department: "TEST" });
    await container.users.registerDevice("NO-FAKE-WALLET", "NO-FAKE-WALLET-DEVICE", "no-fake-credential", "PUBLIC-NO-FAKE");
    expect(await container.users.listWallets("NO-FAKE-WALLET")).toHaveLength(0);
    await expect(container.users.activateWallet("NO-FAKE-WALLET", "NO-FAKE-WALLET-DEVICE", "")).rejects.toMatchObject({ code: "VALIDATION_FAILED" });
  });
});

describe("frozen EVM provisioning challenge wire", () => {
  const DEVICE = "EVM-WIRE-DEVICE";
  const OTHER_DEVICE = "EVM-WIRE-OTHER-DEVICE";
  const PRIVATE_KEY = "0x59c6995e998f97a5a0044976f0945389dc9e86dae88c7a6f2e5f4b9c3c4f3f3a";
  const OTHER_PRIVATE_KEY = "0x8b3a350cf5c34c9194ca3a545d1f7c7d6e2b6e8c0b3f2a1d5c6e7f8091a2b3c4";
  let container: ReturnType<typeof createContainer>;
  let previousMode: string | undefined;
  let attestationCalls = 0;

  beforeEach(() => {
    previousMode = process.env.BEL_BLOCKCHAIN;
    process.env.BEL_BLOCKCHAIN = "evm";
    clearIdentityStore();
    attestationCalls = 0;
    const mockAttestation = new MockDeviceAttestationAdapter([DEVICE, OTHER_DEVICE]);
    container = createContainer(new MockBlockchainAdapter(), {
      repositories: createMemoryRepositories(identityStore),
      attestation: {
        async attest(request) {
          attestationCalls += 1;
          return mockAttestation.attest(request);
        },
      },
    });
  });

  afterEach(() => {
    if (previousMode === undefined) delete process.env.BEL_BLOCKCHAIN;
    else process.env.BEL_BLOCKCHAIN = previousMode;
  });

  const compactSign = async (privateKey: string, challenge: string): Promise<string> => {
    const serialized = await new Wallet(privateKey).signMessage(challenge);
    const hex = serialized.slice(2);
    const v = Number.parseInt(hex.slice(128, 130), 16);
    return `0x${(v - 27).toString(16).padStart(2, "0")}${hex.slice(0, 64)}${hex.slice(64, 128)}`;
  };

  async function validInput(deviceId = DEVICE) {
    const wallet = new Wallet(PRIVATE_KEY);
    const challenge = await container.users.requestProvisioningChallenge({ deviceId, deviceMetadata: { managedDevice: true, onBelNetwork: true } });
    return {
      fullName: "EVM Wire User", employeeId: `EVM-WIRE-${deviceId}`, department: "ENGINEERING", deviceId,
      publicKey: `0x${SigningKey.computePublicKey(PRIVATE_KEY, false).slice(4)}`,
      walletAddress: wallet.address, challengeId: challenge.challengeId,
      signature: await compactSign(PRIVATE_KEY, challenge.challenge), deviceMetadata: { managedDevice: true, onBelNetwork: true },
    };
  }

  it("does not consume a challenge after a failed proof, then consumes it after success", async () => {
    const input = await validInput();
    input.signature = await compactSign(OTHER_PRIVATE_KEY, "wrong-challenge");
    await expect(container.users.initializeAccount(input)).rejects.toMatchObject({ code: "FORBIDDEN" });
    expect((await container.repositories.challenges.findById(input.challengeId))?.usedAt).toBeNull();

    input.signature = await compactSign(PRIVATE_KEY, (await container.repositories.challenges.findById(input.challengeId))!.challenge);
    await expect(container.users.initializeAccount(input)).resolves.toMatchObject({ identity: { status: "PENDING" } });
    expect((await container.repositories.challenges.findById(input.challengeId))?.usedAt).not.toBeNull();
    await expect(container.users.initializeAccount(input)).rejects.toMatchObject({ code: "CONFLICT" });
  });

  it("rejects an invalid proof before invoking device attestation", async () => {
    const input = await validInput();
    const callsAfterChallenge = attestationCalls;
    input.signature = await compactSign(OTHER_PRIVATE_KEY, "wrong-challenge");

    await expect(container.users.initializeAccount(input)).rejects.toMatchObject({ code: "FORBIDDEN" });
    expect(attestationCalls).toBe(callsAfterChallenge);
    expect((await container.repositories.challenges.findById(input.challengeId))?.usedAt).toBeNull();
  });

  it("rejects expired, wrong-device, and wrong-purpose challenges before proof consumption", async () => {
    const expired = await validInput();
    const expiredChallenge = await container.repositories.challenges.findById(expired.challengeId);
    await container.repositories.challenges.save({ ...expiredChallenge!, expiresAt: new Date(Date.now() - 1_000).toISOString() });
    await expect(container.users.initializeAccount(expired)).rejects.toMatchObject({ code: "VALIDATION_FAILED" });
    expect((await container.repositories.challenges.findById(expired.challengeId))?.usedAt).toBeNull();

    const wrongDevice = await validInput();
    wrongDevice.deviceId = OTHER_DEVICE;
    await expect(container.users.initializeAccount(wrongDevice)).rejects.toMatchObject({ code: "VALIDATION_FAILED" });
    expect((await container.repositories.challenges.findById(wrongDevice.challengeId))?.usedAt).toBeNull();

    const wrongPurpose = await validInput();
    const purposeChallenge = await container.repositories.challenges.findById(wrongPurpose.challengeId);
    await container.repositories.challenges.save({ ...purposeChallenge!, purpose: "AUTHENTICATION" });
    await expect(container.users.initializeAccount(wrongPurpose)).rejects.toMatchObject({ code: "VALIDATION_FAILED" });
    expect((await container.repositories.challenges.findById(wrongPurpose.challengeId))?.usedAt).toBeNull();
  });

  it("allows only one concurrent consumer of a valid challenge", async () => {
    const input = await validInput();
    const [first, second] = await Promise.allSettled([
      container.users.initializeAccount({ ...input, employeeId: "EVM-WIRE-CONCURRENT-A" }),
      container.users.initializeAccount({ ...input, employeeId: "EVM-WIRE-CONCURRENT-B" }),
    ]);

    expect([first.status, second.status].sort()).toEqual(["fulfilled", "rejected"]);
    const rejectedReason = first.status === "rejected" ? first.reason : second.status === "rejected" ? second.reason : undefined;
    expect(rejectedReason).toMatchObject({ code: "CONFLICT" });
    expect((await container.repositories.challenges.findById(input.challengeId))?.usedAt).not.toBeNull();
    expect([...identityStore.identities.values()].filter((identity) => identity.employeeId?.startsWith("EVM-WIRE-CONCURRENT-")).length).toBe(1);
  });
});
