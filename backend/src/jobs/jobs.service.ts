// Owner: Person 3. Backs GET/POST /jobs and the /jobs/:id/{assign,
// start,complete,approve,reject} actions (docs/API_SPEC.yaml).
// State machine per SYSTEM_SPEC.md:
//   CREATED -> ASSIGNED -> IN_PROGRESS -> COMPLETED -> VERIFIED
//                                              \-> REJECTED
import { Job, JobStatus } from "../../../shared/types";
import { BlockchainService } from "../adapters/BlockchainService";
import { ForbiddenError, NotFoundError, ValidationError } from "../errors";
import { randomUUID } from "node:crypto";
import { MemoryJobRepository, type AssetRepository, type JobRepository } from "../domain/repositories";

type JobActor = {
  identityId: string;
  walletAddress: string;
};

export const ALLOWED_TRANSITIONS: Record<JobStatus, JobStatus[]> = {
  CREATED: ["ASSIGNED"],
  ASSIGNED: ["IN_PROGRESS"],
  IN_PROGRESS: ["COMPLETED"],
  COMPLETED: ["VERIFIED", "REJECTED"],
  VERIFIED: [],
  REJECTED: ["ASSIGNED"], // allow re-assignment after rejection
};

export interface JobsService {
  list(): Promise<Job[]>;
  create(input: Partial<Job>, actor: JobActor): Promise<Job>;
  assign(id: string, technicianId: string, actor: JobActor): Promise<Job>;
  start(id: string, actor: JobActor): Promise<Job>;
  complete(id: string, evidenceHash: string, actor: JobActor): Promise<Job>;
  approve(id: string, actor: JobActor): Promise<Job>;
  reject(id: string, reason: string, actor: JobActor): Promise<Job>;
}

export class JobsServiceImpl implements JobsService {
  constructor(
    private readonly chain: BlockchainService,
    private readonly repository: JobRepository = new MemoryJobRepository(),
    private readonly assets?: AssetRepository,
    private readonly identityExists?: (identityId: string) => Promise<boolean>,
  ) {}

  /** Exposed so the state machine can be tested without a datastore. */
  assertTransition(current: JobStatus, next: JobStatus) {
    if (!ALLOWED_TRANSITIONS[current].includes(next)) {
      throw new Error(`Invalid job transition: ${current} -> ${next}`);
    }
  }

  async list(): Promise<Job[]> {
    return this.repository.list();
  }

  async create(input: Partial<Job>, actor: JobActor): Promise<Job> {
    const errors: string[] = [];

    if (typeof input.assetId !== "string" || !input.assetId.trim()) {
      errors.push("assetId is required");
    }

    if (typeof input.createdBy !== "string" || !input.createdBy.trim()) {
      errors.push("createdBy is required");
    }

    if (!input.priority) {
      errors.push("priority is required");
    }

    if (errors.length) {
      throw new ValidationError(errors);
    }

    const job: Job = {
      jobId: typeof input.jobId === "string" && input.jobId.trim() ? input.jobId.trim() : `JOB-${(await this.repository.list()).length + 1}`,
      assetId: input.assetId!,
      createdBy: input.createdBy!,
      assignedTo: "",
      verifierId: input.verifierId ?? null,
      status: "CREATED",
      priority: input.priority!,
      createdAt: new Date().toISOString(),
      completedAt: null,
    };

    if (this.assets && !(await this.assets.findById(job.assetId))) throw new NotFoundError(`No asset ${job.assetId}`);
    if (this.identityExists && !(await this.identityExists(job.createdBy))) throw new NotFoundError(`No identity ${job.createdBy}`);
    if (await this.repository.findById(job.jobId)) throw new ValidationError([`jobId ${job.jobId} already exists`]);
    await this.submit("JOB_CREATE", actor, {
      jobId: job.jobId,
      assetId: job.assetId,
    });

    await this.repository.save(job);

    return job;
  }

  async assign(id: string, technicianId: string, actor: JobActor): Promise<Job> {
    const job = await this.repository.findById(id);

    if (!job) {
      throw new NotFoundError(`No job ${id}`);
    }

    if (!technicianId?.trim()) {
      throw new ValidationError(["technicianId is required"]);
    }
    if (this.identityExists && !(await this.identityExists(technicianId))) throw new NotFoundError(`No identity ${technicianId}`);

    this.assertTransition(job.status, "ASSIGNED");

    await this.submit("JOB_ASSIGN", actor, {
      jobId: job.jobId,
      technicianId,
    });

    job.assignedTo = technicianId;
    job.status = "ASSIGNED";
    await this.repository.save(job);

    return job;
  }

  async start(id: string, actor: JobActor): Promise<Job> {
    const job = await this.repository.findById(id);

    if (!job) {
      throw new NotFoundError(`No job ${id}`);
    }

    this.assertTransition(job.status, "IN_PROGRESS");
    this.requireAssignedTechnician(job, actor);

    await this.submit("JOB_START", actor, {
      jobId: job.jobId,
    });

    job.status = "IN_PROGRESS";
    await this.repository.save(job);

    return job;
  }

  async complete(id: string, evidenceHash: string, actor: JobActor): Promise<Job> {
    const job = await this.repository.findById(id);

    if (!job) {
      throw new NotFoundError(`No job ${id}`);
    }

    if (!/^[0-9a-f]{64}$/i.test(evidenceHash ?? "")) {
      throw new ValidationError(["evidenceHash must be a 64-character SHA-256 hex digest"]);
    }

    this.assertTransition(job.status, "COMPLETED");
    this.requireAssignedTechnician(job, actor);

    await this.submit("JOB_COMPLETE", actor, {
      jobId: job.jobId,
      evidenceHash,
    });

    job.status = "COMPLETED";
    job.completedAt = new Date().toISOString();
    await this.repository.save(job);

    return job;
  }

  async approve(id: string, actor: JobActor): Promise<Job> {
    const job = await this.repository.findById(id);

    if (!job) {
      throw new NotFoundError(`No job ${id}`);
    }

    this.assertTransition(job.status, "VERIFIED");
    this.requireIndependentVerifier(job, actor);

    await this.submit("JOB_APPROVE", actor, {
      jobId: job.jobId,
    });

    job.status = "VERIFIED";
    job.verifierId = actor.identityId;
    await this.repository.save(job);

    return job;
  }

  async reject(id: string, reason: string, actor: JobActor): Promise<Job> {
    const job = await this.repository.findById(id);

    if (!job) {
      throw new NotFoundError(`No job ${id}`);
    }

    if (!reason?.trim()) {
      throw new ValidationError(["reason is required"]);
    }

    this.assertTransition(job.status, "REJECTED");
    this.requireIndependentVerifier(job, actor);

    await this.submit("JOB_REJECT", actor, {
      jobId: job.jobId,
      reason,
    });

    job.status = "REJECTED";
    job.verifierId = actor.identityId;
    await this.repository.save(job);

    return job;
  }

  private async submit(
    type:
      | "JOB_CREATE"
      | "JOB_ASSIGN"
      | "JOB_START"
      | "JOB_COMPLETE"
      | "JOB_APPROVE"
      | "JOB_REJECT",
    actor: JobActor,
    payload: Record<string, unknown>
  ): Promise<void> {
    const result = await this.chain.submitTransaction({
      txId: randomUUID(),
      type,
      actorIdentity: actor.identityId,
      actorWallet: actor.walletAddress,
      payload,
      timestamp: new Date().toISOString(),
      signature: "development",
    });

    if (result.status !== "SUCCESS") {
      const revert = result.revert;
      const detail = revert ? `: ${revert.name}(${revert.args.join(", ")}) — ${revert.message}` : "";
      throw new Error(`Blockchain rejected ${type}${detail}`);
    }
  }

  /** Resource-level OWN semantics. The contract checks this too, but the
   * backend must reject before spending a transaction on an impossible call. */
  private requireAssignedTechnician(job: Job, actor: JobActor): void {
    if (!job.assignedTo || job.assignedTo !== actor.identityId) {
      throw new ForbiddenError("Only the assigned technician may perform maintenance");
    }
  }

  /** Separation of duties: the technician who performed the work cannot
   * verify it. A pre-selected verifier, when present, is also authoritative. */
  private requireIndependentVerifier(job: Job, actor: JobActor): void {
    if (job.assignedTo === actor.identityId) {
      throw new ForbiddenError("The assigned technician cannot verify their own work");
    }
    if (job.verifierId && job.verifierId !== actor.identityId) {
      throw new ForbiddenError("Only the assigned verifier may verify this job");
    }
  }
}
