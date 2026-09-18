// Owner: Person 3. Backs GET/POST /jobs and the /jobs/:id/{assign,
// start,complete,approve,reject} actions (docs/API_SPEC.yaml).
// State machine per SYSTEM_SPEC.md:
//   CREATED -> ASSIGNED -> IN_PROGRESS -> COMPLETED -> VERIFIED
//                                              \-> REJECTED
// Use fake employees and fake assets initially — no dependency on
// Person 1 or 2's services to get started.

import { Job, JobStatus } from "../../../shared/types";
import { BlockchainService } from "../adapters/BlockchainService";
import { NotFoundError, ValidationError } from "../errors";

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
  create(input: Partial<Job>): Promise<Job>;
  assign(id: string, technicianId: string): Promise<Job>;
  start(id: string): Promise<Job>;
  complete(id: string, evidenceHash: string): Promise<Job>;
  approve(id: string): Promise<Job>;
  reject(id: string, reason: string): Promise<Job>;
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

  async create(input: Partial<Job>): Promise<Job> {
    // TODO: JOB_CREATE tx via this.chain.
    if (!input.assetId) {
      throw new ValidationError(["assetId is required"]);
    }

    if (!input.createdBy) {
      throw new ValidationError(["createdBy is required"]);
    }

    if (!input.priority) {
      throw new ValidationError(["priority is required"]);
    }

    const job: Job = {
      jobId: `JOB-${this.jobs.length + 1}`,
      assetId: input.assetId,
      createdBy: input.createdBy,
      assignedTo: "",
      verifierId: input.verifierId ?? null,
      status: "CREATED",
      priority: input.priority,
      createdAt: new Date().toISOString(),
      completedAt: null,
    };

    this.jobs.push(job);

    return job;
  }

  async assign(id: string, technicianId: string): Promise<Job> {
    // TODO: this.assertTransition(job.status, "ASSIGNED"); JOB_ASSIGN tx.
    const job = this.jobs.find((job) => job.jobId === id);

    if (!job) {
      throw new NotFoundError(`No job ${id}`);
    }

    if (!technicianId) {
      throw new ValidationError(["technicianId is required"]);
    }

    this.assertTransition(job.status, "ASSIGNED");

    job.assignedTo = technicianId;
    job.status = "ASSIGNED";

    // TODO: JOB_ASSIGN tx via this.chain.

    return job;
  }

  async start(id: string): Promise<Job> {
    const job = this.jobs.find((job) => job.jobId === id);

    if (!job) {
      throw new NotFoundError(`No job ${id}`);
    }

    this.assertTransition(job.status, "IN_PROGRESS");

    job.status = "IN_PROGRESS";

    // TODO: JOB_START tx via this.chain.

    return job;
  }

  async complete(id: string, evidenceHash: string): Promise<Job> {
    const job = this.jobs.find((job) => job.jobId === id);

    if (!job) {
      throw new NotFoundError(`No job ${id}`);
    }

    this.assertTransition(job.status, "COMPLETED");

    job.status = "COMPLETED";
    job.completedAt = new Date().toISOString();

    // TODO: JOB_COMPLETE tx via this.chain.

    return job;
  }

  async approve(id: string): Promise<Job> {
    const job = this.jobs.find((job) => job.jobId === id);

    if (!job) {
      throw new NotFoundError(`No job ${id}`);
    }

    this.assertTransition(job.status, "VERIFIED");

    job.status = "VERIFIED";

    // TODO: JOB_APPROVE tx via this.chain.

    return job;
  }

  async reject(id: string, reason: string): Promise<Job> {
    const job = this.jobs.find((job) => job.jobId === id);

    if (!job) {
      throw new NotFoundError(`No job ${id}`);
    }

    if (!reason) {
      throw new ValidationError(["reason is required"]);
    }

    this.assertTransition(job.status, "REJECTED");

    job.status = "REJECTED";

    // TODO: JOB_REJECT tx via this.chain.

    return job;
  }
}
