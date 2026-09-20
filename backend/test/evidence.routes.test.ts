import { beforeAll, describe, expect, it } from "vitest";
import request from "supertest";
import { MockBlockchainAdapter } from "../../mocks/mock-blockchain";
import { createApp } from "../src/app";
import { createContainer } from "../src/container";
import { MemoryAssetRepository, MemoryJobRepository } from "../src/domain/repositories";
import { MemoryEvidenceStorage } from "../src/evidence/evidence.storage";
import { createMemoryRepositories } from "../src/users/repository-implementations";

describe("evidence HTTP API", () => {
  const jobs = new MemoryJobRepository();
  const chain = new MockBlockchainAdapter();
  const container = createContainer(chain, {
    repositories: createMemoryRepositories(),
    assets: new MemoryAssetRepository(),
    jobs,
    evidenceStorage: new MemoryEvidenceStorage(),
  });
  const app = createApp(container);
  let token = "";
  const jobId = "JOB-HTTP-EVIDENCE";
  let identityId = "";

  beforeAll(async () => {
    const user = await container.users.createUser({ employeeId: "EVIDENCE-TECH", fullName: "Evidence Tech", role: "TECHNICIAN", department: "TEST" });
    await container.users.registerDevice("EVIDENCE-TECH", "EVIDENCE-DEVICE", "evidence-secret", "PUBLIC-EVIDENCE");
    await container.users.registerWallet("EVIDENCE-TECH", "EVIDENCE-DEVICE", "0xEVIDENCE");
    await container.users.activateWallet("EVIDENCE-TECH", "EVIDENCE-DEVICE", "0xEVIDENCE");
    token = (await container.auth.login("evidence-secret")).token;
    identityId = user.identity.identityId;
    await jobs.save({ jobId, assetId: "ASSET-HTTP", createdBy: identityId, assignedTo: identityId, verifierId: null, status: "IN_PROGRESS", priority: "LOW", createdAt: new Date().toISOString(), completedAt: null });
  });

  it("uploads, lists, and downloads only through authenticated backend routes", async () => {
    const bytes = Buffer.from("private maintenance evidence");
    const upload = await request(app).post(`/jobs/${jobId}/evidence`).set("Authorization", `Bearer ${token}`).attach("file", bytes, { filename: "report.txt", contentType: "text/plain" });
    expect(upload.status).toBe(201);
    expect(upload.body.sha256).toBeDefined();
    expect(upload.body.cid).toMatch(/^bafy-memory-/);

    const completedResponse = await request(app).post(`/jobs/${jobId}/complete`).set("Authorization", `Bearer ${token}`).send({ evidenceId: upload.body.evidenceId });
    expect(completedResponse.status).toBe(200);
    expect(completedResponse.body.status).toBe("COMPLETED");
    expect(chain.submitted.at(-1)?.payload).toMatchObject({ jobId, evidenceHash: upload.body.sha256 });

    const list = await request(app).get(`/jobs/${jobId}/evidence`).set("Authorization", `Bearer ${token}`);
    expect(list.status).toBe(200);
    expect(list.body).toHaveLength(1);
    expect(list.body[0].sizeBytes).toBe(bytes.length);

    const download = await request(app).get(`/jobs/${jobId}/evidence/${upload.body.evidenceId}`).set("Authorization", `Bearer ${token}`);
    expect(download.status).toBe(200);
    expect(download.headers["content-type"]).toContain("text/plain");
    expect(download.text).toBe(bytes.toString());
  });

  it("rejects unauthenticated retrieval before storage access", async () => {
    const response = await request(app).get(`/jobs/${jobId}/evidence`);
    expect(response.status).toBe(401);
  });

  it("rejects unsupported content types", async () => {
    const current = await jobs.findById(jobId);
    await jobs.save({ ...current!, status: "IN_PROGRESS" });
    const response = await request(app).post(`/jobs/${jobId}/evidence`).set("Authorization", `Bearer ${token}`).attach("file", Buffer.from("#!/bin/sh"), { filename: "script.sh", contentType: "application/x-sh" });
    expect(response.status).toBe(415);
  });
});
