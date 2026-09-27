import { describe, expect, it } from "vitest";
import { createHash } from "node:crypto";
import { MemoryJobRepository } from "../src/domain/repositories";
import { EvidenceServiceImpl } from "../src/evidence/evidence.service";
import { MemoryEvidenceRepository } from "../src/evidence/evidence.repository";
import { EvidenceStorageError, MemoryEvidenceStorage, type EvidenceStorage } from "../src/evidence/evidence.storage";

const job = { jobId: "JOB-EVIDENCE", assetId: "ASSET-1", createdBy: "DID:CREATOR", assignedTo: "DID:TECH", verifierId: null, status: "IN_PROGRESS" as const, priority: "LOW" as const, createdAt: new Date().toISOString(), completedAt: null };
const actor = { identityId: "DID:TECH", walletAddress: "0xTECH", role: "TECHNICIAN" as const };

function service(storage: EvidenceStorage = new MemoryEvidenceStorage()) {
  const jobs = new MemoryJobRepository();
  const records = new MemoryEvidenceRepository();
  void jobs.save(job);
  return { service: new EvidenceServiceImpl(records, storage, jobs), records, storage };
}

describe("EvidenceService", () => {
  it("hashes exact bytes and persists metadata after storage upload", async () => {
    const { service: evidence } = service();
    const bytes = Buffer.from("maintenance report\n");
    const result = await evidence.upload("JOB-EVIDENCE", actor, { bytes, filename: "report.txt", contentType: "text/plain" });
    expect(result.sha256).toBe(createHash("sha256").update(bytes).digest("hex"));
    expect(result.sizeBytes).toBe(bytes.length);
    expect(result.cid).toContain("bafy-memory-");
  });

  it("rejects unauthorized upload and viewing", async () => {
    const { service: evidence } = service();
    await expect(evidence.upload("JOB-EVIDENCE", { ...actor, identityId: "DID:OTHER" }, { bytes: Buffer.from("x"), filename: "x.txt", contentType: "text/plain" })).rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(evidence.list("JOB-EVIDENCE", { ...actor, identityId: "DID:OTHER" })).rejects.toMatchObject({ code: "FORBIDDEN" });
  });

  it("rejects a changed object before returning it", async () => {
    const corrupted: EvidenceStorage = {
      async upload() { return { cid: "bafy-corrupt", sizeBytes: 4 }; },
      async download() { return Buffer.from("evil"); },
      async exists() { return true; },
    };
    const { service: evidence } = service(corrupted);
    const result = await evidence.upload("JOB-EVIDENCE", actor, { bytes: Buffer.from("good"), filename: "report.txt", contentType: "text/plain" });
    expect(result.sha256).not.toBe(createHash("sha256").update("evil").digest("hex"));
    await expect(evidence.download("JOB-EVIDENCE", result.evidenceId, actor)).rejects.toMatchObject({ code: "INTEGRITY_FAILURE" });
  });

  it("maps storage outages without leaking provider details", async () => {
    const unavailable: EvidenceStorage = {
      async upload() { throw new EvidenceStorageError("secret node address"); },
      async download() { throw new EvidenceStorageError("secret node address"); },
      async exists() { return false; },
    };
    const { service: evidence } = service(unavailable);
    await expect(evidence.upload("JOB-EVIDENCE", actor, { bytes: Buffer.from("x"), filename: "x.txt", contentType: "text/plain" })).rejects.toMatchObject({ status: 503, message: "Evidence storage is temporarily unavailable" });
  });
});
