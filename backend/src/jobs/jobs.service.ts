// Owner: Person 3. Backs GET/POST /jobs and the /jobs/:id/{assign,
// start,complete,approve,reject} actions (docs/API_SPEC.yaml).
// State machine per SYSTEM_SPEC.md:
//   CREATED -> ASSIGNED -> IN_PROGRESS -> COMPLETED -> VERIFIED
//                                              \-> REJECTED
// Use fake employees and fake assets initially — no dependency on
// Person 1 or 2's services to get started.

import { Job, JobStatus } from "../../../shared/types";
import { BlockchainService } from "../adapters/BlockchainService";
import { ForbiddenError, NotFoundError, ValidationError } from "../errors";
import { randomUUID } from "node:crypto";

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
  private readonly jobs: Job[] = [];
  constructor(private readonly chain: BlockchainService) {}

  /** Exposed so the state machine can be tested without a datastore. */
  assertTransition(current: JobStatus, next: JobStatus) {
    if (!ALLOWED_TRANSITIONS[current].includes(next)) {
      throw new Error(`Invalid job transition: ${current} -> ${next}`);
    }
  }

  async list(): Promise<Job[]> {
    return this.jobs;
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
      jobId: `JOB-${this.jobs.length + 1}`,
      assetId: input.assetId!,
      createdBy: input.createdBy!,
      assignedTo: "",
      verifierId: input.verifierId ?? null,
      status: "CREATED",
      priority: input.priority!,
      createdAt: new Date().toISOString(),
      completedAt: null,
    };

    await this.submit("JOB_CREATE", actor, {
      jobId: job.jobId,
      assetId: job.assetId,
    });

    this.jobs.push(job);

    return job;
  }

  async assign(id: string, technicianId: string, actor: JobActor): Promise<Job> {
    const job = this.jobs.find((item) => item.jobId === id);

    if (!job) {
      throw new NotFoundError(`No job ${id}`);
    }

    if (!technicianId?.trim()) {
      throw new ValidationError(["technicianId is required"]);
    }

    this.assertTransition(job.status, "ASSIGNED");

    await this.submit("JOB_ASSIGN", actor, {
      jobId: job.jobId,
      technicianId,
    });

    job.assignedTo = technicianId;
    job.status = "ASSIGNED";

    return job;
  }

  async start(id: string, actor: JobActor): Promise<Job> {
    const job = this.jobs.find((item) => item.jobId === id);

    if (!job) {
      throw new NotFoundError(`No job ${id}`);
    }

    this.assertTransition(job.status, "IN_PROGRESS");
    this.requireAssignedTechnician(job, actor);

    await this.submit("JOB_START", actor, {
      jobId: job.jobId,
    });

    job.status = "IN_PROGRESS";

    return job;
  }

  async complete(id: string, evidenceHash: string, actor: JobActor): Promise<Job> {
    const job = this.jobs.find((item) => item.jobId === id);

    if (!job) {
      throw new NotFoundError(`No job ${id}`);
    }

    if (!evidenceHash?.trim()) {
      throw new ValidationError(["evidenceHash is required"]);
    }

    this.assertTransition(job.status, "COMPLETED");
    this.requireAssignedTechnician(job, actor);

    await this.submit("JOB_COMPLETE", actor, {
      jobId: job.jobId,
      evidenceHash,
    });

    job.status = "COMPLETED";
    job.completedAt = new Date().toISOString();

    return job;
  }

  async approve(id: string, actor: JobActor): Promise<Job> {
    const job = this.jobs.find((item) => item.jobId === id);

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

    return job;
  }

  async reject(id: string, reason: string, actor: JobActor): Promise<Job> {
    const job = this.jobs.find((item) => item.jobId === id);

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
      throw new Error(`Blockchain rejected ${type}`);
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
