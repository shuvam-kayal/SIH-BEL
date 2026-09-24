import type { PrismaClient } from "@prisma/client";
import { randomUUID } from "node:crypto";
import type { Evidence } from "./evidence.types";

export interface EvidenceRepository {
  findById(evidenceId: string): Promise<Evidence | null>;
  listByJob(jobId: string): Promise<Evidence[]>;
  save(evidence: Evidence): Promise<void>;
}

export class MemoryEvidenceRepository implements EvidenceRepository {
  constructor(private readonly records = new Map<string, Evidence>()) {}
  async findById(id: string) { const item = this.records.get(id); return item ? { ...item } : null; }
  async listByJob(jobId: string) { return [...this.records.values()].filter((item) => item.jobId === jobId).map((item) => ({ ...item })); }
  async save(evidence: Evidence) { this.records.set(evidence.evidenceId, { ...evidence }); }
}

export class PrismaEvidenceRepository implements EvidenceRepository {
  constructor(private readonly prisma: PrismaClient) {}

  async findById(evidenceId: string) { return map(await this.prisma.evidenceRecord.findUnique({ where: { evidenceId } })); }

  async listByJob(jobId: string) {
    return (await this.prisma.evidenceRecord.findMany({ where: { jobId }, orderBy: { createdAt: "asc" } })).map(map);
  }

  async save(evidence: Evidence) {
    await this.prisma.evidenceRecord.create({
      data: {
        evidenceId: evidence.evidenceId || randomUUID(),
        jobId: evidence.jobId,
        cid: evidence.cid,
        sha256: evidence.sha256,
        originalFilename: evidence.originalFilename,
        contentType: evidence.contentType,
        sizeBytes: evidence.sizeBytes,
        uploadedBy: evidence.uploadedBy,
        createdAt: new Date(evidence.createdAt),
        updatedAt: new Date(evidence.updatedAt),
      },
    });
  }
}

const map = (row: any): Evidence => ({
  evidenceId: row.evidenceId,
  jobId: row.jobId,
  cid: row.cid,
  sha256: row.sha256,
  originalFilename: row.originalFilename,
  contentType: row.contentType,
  sizeBytes: row.sizeBytes,
  uploadedBy: row.uploadedBy,
  createdAt: row.createdAt.toISOString(),
  updatedAt: row.updatedAt.toISOString(),
});
