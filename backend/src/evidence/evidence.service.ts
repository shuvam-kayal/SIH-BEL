import { createHash } from "node:crypto";
import { randomUUID } from "node:crypto";
import { can } from "../../../shared/rbac";
import { ForbiddenError, IntegrityError, NotFoundError, PayloadTooLargeError, ServiceUnavailableError, UnsupportedMediaTypeError, ValidationError } from "../errors";
import type { JobRepository } from "../domain/repositories";
import type { Job } from "../../../shared/types";
import { EvidenceStorageError, type EvidenceStorage } from "./evidence.storage";
import type { Evidence, EvidenceActor, EvidenceUpload } from "./evidence.types";
import type { EvidenceRepository } from "./evidence.repository";

const DEFAULT_MAX_FILE_SIZE_MB = 25;
const DEFAULT_ALLOWED_MIME_TYPES = ["application/pdf", "image/jpeg", "image/png", "text/plain"];

export type EvidenceServiceOptions = {
  maxFileSizeBytes?: number;
  allowedMimeTypes?: string[];
};

export class EvidenceServiceImpl {
  private readonly maxFileSizeBytes: number;
  private readonly allowedMimeTypes: Set<string>;

  constructor(
    private readonly repository: EvidenceRepository,
    private readonly storage: EvidenceStorage,
    private readonly jobs: JobRepository,
    options: EvidenceServiceOptions = {},
  ) {
    this.maxFileSizeBytes = options.maxFileSizeBytes ?? parseMaxFileSize(process.env.EVIDENCE_MAX_FILE_SIZE_MB);
    this.allowedMimeTypes = new Set((options.allowedMimeTypes ?? parseAllowedMimeTypes(process.env.EVIDENCE_ALLOWED_MIME_TYPES)).map((item) => item.toLowerCase()));
  }

  get uploadLimitBytes() { return this.maxFileSizeBytes; }

  async upload(jobId: string, actor: EvidenceActor, input: EvidenceUpload): Promise<Evidence> {
    const job = await this.requireJob(jobId);
    this.assertCanUpload(job, actor);
    this.validateUpload(input);

    const sha256 = createHash("sha256").update(input.bytes).digest("hex");
    let stored: { cid: string; sizeBytes: number };
    try {
      stored = await this.storage.upload(input.bytes, input.contentType);
    } catch (error) {
      if (error instanceof EvidenceStorageError) throw new ServiceUnavailableError();
      throw error;
    }
    if (stored.sizeBytes !== input.bytes.length) {
      throw new ServiceUnavailableError("Evidence storage rejected the uploaded object");
    }

    const now = new Date().toISOString();
    const evidence: Evidence = {
      evidenceId: randomUUID(),
      jobId,
      cid: stored.cid,
      sha256,
      originalFilename: sanitizeFilename(input.filename),
      contentType: input.contentType.toLowerCase(),
      sizeBytes: input.bytes.length,
      uploadedBy: actor.identityId,
      createdAt: now,
      updatedAt: now,
    };
    // If this write fails, the object remains pinned/orphaned. It is safer to
    // retain it for operator reconciliation than to issue an unsafe delete.
    await this.repository.save(evidence);
    return evidence;
  }

  async list(jobId: string, actor: EvidenceActor): Promise<Evidence[]> {
    const job = await this.requireJob(jobId);
    this.assertCanView(job, actor);
    return this.repository.listByJob(jobId);
  }

  async getHash(jobId: string, evidenceId: string, actor: EvidenceActor): Promise<string> {
    const job = await this.requireJob(jobId);
    this.assertCanView(job, actor);
    const evidence = await this.repository.findById(evidenceId);
    if (!evidence || evidence.jobId !== jobId) throw new NotFoundError(`No evidence ${evidenceId}`);
    return evidence.sha256;
  }

  async download(jobId: string, evidenceId: string, actor: EvidenceActor): Promise<{ evidence: Evidence; bytes: Buffer }> {
    const job = await this.requireJob(jobId);
    this.assertCanView(job, actor);
    const evidence = await this.repository.findById(evidenceId);
    if (!evidence || evidence.jobId !== jobId) throw new NotFoundError(`No evidence ${evidenceId}`);

    let bytes: Buffer;
    try {
      bytes = await this.storage.download(evidence.cid);
    } catch (error) {
      if (error instanceof EvidenceStorageError) throw new ServiceUnavailableError();
      throw error;
    }
    const actual = createHash("sha256").update(bytes).digest("hex");
    if (actual !== evidence.sha256 || bytes.length !== evidence.sizeBytes) {
      console.error(`[backend] evidence integrity failure: ${evidence.evidenceId}`);
      throw new IntegrityError();
    }
    return { evidence, bytes };
  }

  private async requireJob(jobId: string) {
    const job = await this.jobs.findById(jobId);
    if (!job) throw new NotFoundError(`No job ${jobId}`);
    return job;
  }

  private assertCanUpload(job: Job, actor: EvidenceActor) {
    if (!can(actor.role, "PERFORM_MAINTENANCE")) throw new ForbiddenError();
    if (job.assignedTo !== actor.identityId) throw new ForbiddenError("Only the assigned technician may upload evidence");
    if (job.status !== "IN_PROGRESS") throw new ValidationError(["Evidence may only be uploaded while the job is IN_PROGRESS"]);
  }

  private assertCanView(job: Job, actor: EvidenceActor) {
    if (!can(actor.role, "VIEW_AUDIT_HISTORY", { actorId: actor.identityId, resourceOwnerId: job.assignedTo })) {
      throw new ForbiddenError("You may not view evidence for this job");
    }
  }

  private validateUpload(input: EvidenceUpload) {
    if (!Buffer.isBuffer(input.bytes) || input.bytes.length === 0) throw new ValidationError(["Evidence file must not be empty"]);
    if (input.bytes.length > this.maxFileSizeBytes) throw new PayloadTooLargeError();
    const contentType = input.contentType.toLowerCase();
    if (!this.allowedMimeTypes.has(contentType)) throw new UnsupportedMediaTypeError();
    if (contentType === "application/pdf" && !input.bytes.subarray(0, 5).equals(Buffer.from("%PDF-"))) {
      throw new ValidationError(["PDF evidence has an invalid file signature"]);
    }
    if (contentType === "image/png" && !input.bytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))) {
      throw new ValidationError(["PNG evidence has an invalid file signature"]);
    }
    if (contentType === "image/jpeg" && !(input.bytes[0] === 0xff && input.bytes[1] === 0xd8 && input.bytes.at(-2) === 0xff && input.bytes.at(-1) === 0xd9)) {
      throw new ValidationError(["JPEG evidence has an invalid file signature"]);
    }
  }
}

export function sanitizeFilename(filename: string): string {
  const normalized = filename.replace(/[\\/\0\r\n]/g, "_").replace(/[^\w.() -]/g, "_").trim();
  return normalized.slice(0, 180) || "evidence";
}

function parseMaxFileSize(value?: string): number {
  const mb = value === undefined ? DEFAULT_MAX_FILE_SIZE_MB : Number(value);
  if (!Number.isFinite(mb) || mb <= 0) return DEFAULT_MAX_FILE_SIZE_MB * 1024 * 1024;
  return Math.floor(mb * 1024 * 1024);
}

function parseAllowedMimeTypes(value?: string): string[] {
  return (value?.split(",").map((item) => item.trim()).filter(Boolean) ?? DEFAULT_ALLOWED_MIME_TYPES);
}
