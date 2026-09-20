import { afterAll, beforeAll, describe, expect, it } from "vitest";
import request from "supertest";
import { Contract, HDNodeWallet, JsonRpcProvider, Wallet, hashMessage, toBeHex } from "ethers";
import { PrismaClient } from "@prisma/client";
import { createApp } from "../src/app";
import { createContainer, type Container } from "../src/container";
import { EvmBlockchainAdapter, loadChainConfigFromEnv } from "../src/blockchain";
import { MockDeviceAttestationAdapter } from "../src/devices/device-attestation";
import type { Transaction } from "../../shared/types";

const MNEMONIC = "test test test test test test test test test test test junk";
const configuredKeys = process.env.BEL_E2E_PRIVATE_KEYS?.split(",").map((value) => value.trim()).filter(Boolean);
const key = (index: number) => configuredKeys?.[index]
  ? new Wallet(configuredKeys[index])
  : HDNodeWallet.fromPhrase(MNEMONIC, undefined, `m/44'/60'/0'/0/${index}`);
const rpcUrl = process.env.BEL_E2E_RPC_URL?.trim() || process.env.BEL_CHAIN_RPC_URL?.trim() || "http://127.0.0.1:8545";
const adminEmployeeId = process.env.BEL_E2E_ADMIN_EMPLOYEE_ID?.trim() || "ADMIN-001";
const adminDeviceId = process.env.BEL_E2E_ADMIN_DEVICE_ID?.trim() || "BEL-DEV-ADMIN-001";

type Actor = { identityId: string; employeeId: string; walletAddress: string; token: string };

describe("Person 1 -> Person 3 -> Person 5 real workflow", () => {
  let prisma: PrismaClient;
  let container: Container;
  let app: ReturnType<typeof createApp>;
  let chain: EvmBlockchainAdapter;
  let jobManager: Contract;
  let admin: Actor;
  let technician: Actor;
  let technician2: Actor;
  let engineer: Actor;
  let verifier: Actor;

  async function login(deviceId: string, wallet: Wallet | HDNodeWallet): Promise<Actor> {
    const challengeResponse = await request(app).post("/auth/login-challenge").send({ deviceId });
    expect(challengeResponse.status).toBe(201);
    const challenge = challengeResponse.body;
    const publicKey = `0x${wallet.signingKey.publicKey.slice(4)}`;
    const signature = wallet.signingKey.sign(hashMessage(challenge.challenge));
    const compact = `0x${toBeHex(signature.yParity, 1).slice(2)}${signature.r.slice(2)}${signature.s.slice(2)}`;
    const response = await request(app).post("/auth/login").send({ deviceId, challengeId: challenge.challengeId, publicKey, signature: compact });
    expect(response.status, JSON.stringify(response.body)).toBe(200);
    expect(response.body.user.walletAddress).toBe(wallet.address);
    return { ...response.body.user, token: response.body.token };
  }

  async function provisionActor(label: string, index: number, role: "TECHNICIAN" | "ENGINEER" | "VERIFIER"): Promise<Actor> {
    const wallet = key(index);
    const deviceId = `E2E-${label}-DEVICE`;
    const publicKey = `0x${wallet.signingKey.publicKey.slice(4)}`;
    const challengeResponse = await request(app).post("/auth/provisioning-challenge").send({ deviceId, deviceMetadata: { test: "workflow" } });
    expect(challengeResponse.status).toBe(201);
    const challenge = challengeResponse.body;
    const proof = wallet.signingKey.sign(hashMessage(challenge.challenge));
    const signature = `0x${toBeHex(proof.yParity, 1).slice(2)}${proof.r.slice(2)}${proof.s.slice(2)}`;

    const invalid = await request(app).post("/auth/initialize-account").send({ fullName: `Invalid ${label}`, deviceId, publicKey, walletAddress: wallet.address, challengeId: challenge.challengeId, signature: `${signature.slice(0, -2)}00`, deviceMetadata: { test: "workflow" } });
    expect(invalid.status).toBe(403);

    const initialized = await request(app).post("/auth/initialize-account").send({ fullName: `E2E ${label}`, employeeId: `E2E-${label}`, department: "TEST", deviceId, publicKey, walletAddress: wallet.address, challengeId: challenge.challengeId, signature, deviceMetadata: { test: "workflow" } });
    expect(initialized.status).toBe(202);
    expect(initialized.body.identity.status).toBe("PENDING");
    expect(initialized.body.device.status).toBe("PENDING");
    expect(initialized.body.wallet.status).toBe("PENDING");
    expect(JSON.stringify(initialized.body)).not.toContain(wallet.privateKey);

    const identityId = initialized.body.identity.identityId as string;
    expect((await request(app).post(`/admin/users/${identityId}/verify`).set("Authorization", `Bearer ${admin.token}`).send({ employeeId: `E2E-${label}`, department: "TEST" })).status).toBe(200);
    expect((await request(app).post(`/admin/users/${identityId}/role`).set("Authorization", `Bearer ${admin.token}`).send({ role })).status).toBe(200);
    const activated = await request(app).post(`/admin/users/${identityId}/activate`).set("Authorization", `Bearer ${admin.token}`);
    expect(activated.status).toBe(200);
    expect(activated.body.identity.status).toBe("ACTIVE");
    expect(activated.body.device.status).toBe("ACTIVE");
    expect(activated.body.wallet.status).toBe("ACTIVE");

    const dbIdentity = await container.users.getIdentity(identityId);
    expect(dbIdentity).toMatchObject({ identityId, employeeId: `E2E-${label}`, role, status: "ACTIVE" });
    const onChainIdentity = await chain.getIdentity(identityId);
    expect(onChainIdentity).toMatchObject({ identityId, role, status: "ACTIVE" });
    expect(await chain.getWallet(wallet.address)).toMatchObject({ address: wallet.address, identityId, status: "ACTIVE" });
    return login(deviceId, wallet);
  }

  async function submit(tx: Omit<Transaction, "txId" | "timestamp" | "signature">) {
    const envelope: Transaction = { ...tx, txId: `e2e-${Date.now()}-${Math.random()}`, timestamp: new Date().toISOString(), signature: "development" };
    const result = await chain.submitTransaction(envelope);
    expect(result.status).toBe("SUCCESS");
    return result;
  }

  beforeAll(async () => {
    if (!process.env.DATABASE_URL) throw new Error("DATABASE_URL is required; start Docker PostgreSQL first");
    const keys = [0, 1, 2, 3, 4, 5].map((i) => key(i).privateKey);
    const provider = new JsonRpcProvider(rpcUrl, 31337, { staticNetwork: true, pollingInterval: 50 });
    expect(await provider.send("eth_chainId", [])).toBe("0x7a69");
    const config = loadChainConfigFromEnv({ ...process.env, BEL_BLOCKCHAIN: "evm", BEL_CHAIN_RPC_URL: rpcUrl, BEL_CHAIN_DEV_SIGNER_KEYS: keys.join(",") });
    chain = new EvmBlockchainAdapter(config, { provider });
    jobManager = new Contract(config.deployment.contracts.JobManager, config.abis.JobManager, provider);
    prisma = new PrismaClient();
    await prisma.$connect();
    const adminUser = await prisma.user.findUnique({ where: { employeeId: adminEmployeeId } });
    if (!adminUser) throw new Error(`Bootstrap admin ${adminEmployeeId} is missing; run the repository bootstrap against the real EVM/PostgreSQL environment`);
    await prisma.session.deleteMany();
    await prisma.authorizationGrant.deleteMany();
    await prisma.credential.deleteMany({ where: { device: { identityId: { not: adminUser.identityId } } } });
    await prisma.wallet.deleteMany({ where: { identityId: { not: adminUser.identityId } } });
    await prisma.device.deleteMany({ where: { identityId: { not: adminUser.identityId } } });
    await prisma.user.deleteMany({ where: { identityId: { not: adminUser.identityId } } });
    await prisma.identity.deleteMany({ where: { identityId: { not: adminUser.identityId } } });
    container = createContainer(chain, { prisma, attestation: new MockDeviceAttestationAdapter(["E2E-TECHNICIAN-DEVICE", "E2E-TECHNICIAN-2-DEVICE", "E2E-ENGINEER-DEVICE", "E2E-VERIFIER-DEVICE"]) });
    app = createApp(container);
    const adminWallet = key(0);
    expect(adminUser.identityId).toBe((await chain.getIdentity(adminUser.identityId))?.identityId);
    admin = await login(adminDeviceId, adminWallet);
    expect(admin).toMatchObject({ employeeId: adminEmployeeId, identityId: adminUser.identityId, role: "ADMIN", walletAddress: adminWallet.address });
    technician = await provisionActor("TECHNICIAN", 1, "TECHNICIAN");
    technician2 = await provisionActor("TECHNICIAN-2", 4, "TECHNICIAN");
    engineer = await provisionActor("ENGINEER", 2, "ENGINEER");
    verifier = await provisionActor("VERIFIER", 3, "VERIFIER");
  }, 120_000);

  afterAll(async () => { await prisma?.$disconnect(); });

  it("executes the authenticated job workflow against PostgreSQL and JobManager", async () => {
    const assetId = `E2E-ASSET-${Date.now()}`;
    await submit({ type: "ASSET_MINT", actorIdentity: engineer.identityId, actorWallet: engineer.walletAddress, payload: { assetId, ownerId: technician.identityId, assetType: "TEST" } });
    expect(await chain.getAsset(assetId)).toMatchObject({ assetId, ownerId: technician.identityId, status: "ACTIVE" });

    const requestedJobId = `E2E-JOB-${Date.now()}-A`;
    const created = await request(app).post("/jobs").set("Authorization", `Bearer ${engineer.token}`).send({ jobId: requestedJobId, assetId, priority: "HIGH" });
    expect(created.status).toBe(201);
    expect(created.body).toMatchObject({ jobId: expect.any(String), assetId, createdBy: engineer.identityId, status: "CREATED" });
    const actualJobId = created.body.jobId as string;
    expect(await chain.getJob(actualJobId)).toMatchObject({ jobId: actualJobId, assetId, createdBy: engineer.identityId, status: "CREATED" });
    const createdOnChain = await jobManager.getJob(actualJobId);
    expect(createdOnChain.createdBy).toBe(engineer.walletAddress);

    const assigned = await request(app).post(`/jobs/${actualJobId}/assign`).set("Authorization", `Bearer ${engineer.token}`).send({ technicianId: technician.identityId });
    expect(assigned.status).toBe(200);
    expect(assigned.body.assignedTo).toBe(technician.identityId);
    expect((await chain.getJob(actualJobId))?.assignedTo).toBe(technician.identityId);
    expect((await jobManager.getJob(actualJobId)).technician).toBe(technician.walletAddress);

    expect((await request(app).post(`/jobs/${actualJobId}/start`).set("Authorization", `Bearer ${technician2.token}`)).status).toBe(403);
    expect((await request(app).post(`/jobs/${actualJobId}/start`).set("Authorization", `Bearer ${technician.token}`)).body.status).toBe("IN_PROGRESS");
    expect((await chain.getJob(actualJobId))?.status).toBe("IN_PROGRESS");

    const evidenceHash = "ab".repeat(32);
    expect((await request(app).post(`/jobs/${actualJobId}/complete`).set("Authorization", `Bearer ${technician2.token}`).send({ evidenceHash })).status).toBe(403);
    const completed = await request(app).post(`/jobs/${actualJobId}/complete`).set("Authorization", `Bearer ${technician.token}`).send({ evidenceHash });
    expect(completed.body).toMatchObject({ status: "COMPLETED", completedAt: expect.any(String) });
    expect(await chain.getJob(actualJobId)).toMatchObject({ status: "COMPLETED" });
    expect((await jobManager.getJob(actualJobId)).evidenceHash).toBe(`0x${evidenceHash}`);

    expect((await request(app).post(`/jobs/${actualJobId}/approve`).set("Authorization", `Bearer ${technician.token}`)).status).toBe(403);
    const approved = await request(app).post(`/jobs/${actualJobId}/approve`).set("Authorization", `Bearer ${verifier.token}`);
    expect(approved.body).toMatchObject({ status: "VERIFIED", verifierId: verifier.identityId });
    expect(await chain.getJob(actualJobId)).toMatchObject({ status: "VERIFIED", verifierId: verifier.identityId });
    expect((await jobManager.getJob(actualJobId)).verifier).toBe(verifier.walletAddress);
  });

  it("executes rejection, reassignment, completion, and final approval", async () => {
    const assetId = `E2E-ASSET-REJECT-${Date.now()}`;
    await submit({ type: "ASSET_MINT", actorIdentity: engineer.identityId, actorWallet: engineer.walletAddress, payload: { assetId, ownerId: technician.identityId, assetType: "TEST" } });
    const requestedJobId = `E2E-JOB-${Date.now()}-B`;
    const created = await request(app).post("/jobs").set("Authorization", `Bearer ${engineer.token}`).send({ jobId: requestedJobId, assetId, priority: "MEDIUM" });
    const jobId = created.body.jobId as string;
    await request(app).post(`/jobs/${jobId}/assign`).set("Authorization", `Bearer ${engineer.token}`).send({ technicianId: technician.identityId });
    await request(app).post(`/jobs/${jobId}/start`).set("Authorization", `Bearer ${technician.token}`);
    await request(app).post(`/jobs/${jobId}/complete`).set("Authorization", `Bearer ${technician.token}`).send({ evidenceHash: "cd".repeat(32) });
    const rejected = await request(app).post(`/jobs/${jobId}/reject`).set("Authorization", `Bearer ${verifier.token}`).send({ reason: "repeat inspection" });
    expect(rejected.body.status).toBe("REJECTED");
    expect((await chain.getJob(jobId))?.status).toBe("REJECTED");
    await request(app).post(`/jobs/${jobId}/assign`).set("Authorization", `Bearer ${engineer.token}`).send({ technicianId: engineer.identityId });
    await request(app).post(`/jobs/${jobId}/start`).set("Authorization", `Bearer ${engineer.token}`);
    await request(app).post(`/jobs/${jobId}/complete`).set("Authorization", `Bearer ${engineer.token}`).send({ evidenceHash: "ef".repeat(32) });
    const approved = await request(app).post(`/jobs/${jobId}/approve`).set("Authorization", `Bearer ${verifier.token}`);
    expect(approved.body).toMatchObject({ status: "VERIFIED", verifierId: verifier.identityId });
    expect(await chain.getJob(jobId)).toMatchObject({ status: "VERIFIED", verifierId: verifier.identityId });
    expect((await jobManager.getJob(jobId)).verifier).toBe(verifier.walletAddress);
  });

  it("revokes the technician wallet and invalidates the authenticated session", async () => {
    const response = await request(app).post(`/admin/users/${technician.identityId}/revoke-wallet`).set("Authorization", `Bearer ${admin.token}`).send({ reason: "workflow cleanup" });
    expect(response.status).toBe(200);
    expect((await request(app).get("/users/me").set("Authorization", `Bearer ${technician.token}`)).status).toBe(401);
    expect((await chain.getWallet(technician.walletAddress))?.status).toBe("REVOKED");
  });
});
