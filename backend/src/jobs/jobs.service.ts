// Owner: Person 3. Backs GET/POST /jobs and the /jobs/:id/{assign,
// start,complete,approve,reject} actions (docs/API_SPEC.yaml).
// State machine per SYSTEM_SPEC.md:
//   CREATED -> ASSIGNED -> IN_PROGRESS -> COMPLETED -> VERIFIED
//                                              \-> REJECTED
// Use fake employees and fake assets initially — no dependency on
// Person 1 or 2's services to get started.

import { Job, JobStatus } from "../../../shared/types";
import { BlockchainService } from "../adapters/BlockchainService";
import { NotImplementedError } from "../errors";

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
  constructor(private readonly chain: BlockchainService) {}

  /** Exposed so the state machine can be tested without a datastore. */
  assertTransition(current: JobStatus, next: JobStatus) {
    if (!ALLOWED_TRANSITIONS[current].includes(next)) {
      throw new Error(`Invalid job transition: ${current} -> ${next}`);
    }
  }

  async list(): Promise<Job[]> {
    throw new NotImplementedError("JobsService.list()");
  }

  async create(_input: Partial<Job>): Promise<Job> {
    // TODO: JOB_CREATE tx via this.chain.
    throw new NotImplementedError("JobsService.create()");
  }

  async assign(_id: string, _technicianId: string): Promise<Job> {
    // TODO: this.assertTransition(job.status, "ASSIGNED"); JOB_ASSIGN tx.
    throw new NotImplementedError("JobsService.assign()");
  }

  async start(_id: string): Promise<Job> {
    throw new NotImplementedError("JobsService.start()");
  }

  async complete(_id: string, _evidenceHash: string): Promise<Job> {
    throw new NotImplementedError("JobsService.complete()");
  }

  async approve(_id: string): Promise<Job> {
    throw new NotImplementedError("JobsService.approve()");
  }

  async reject(_id: string, _reason: string): Promise<Job> {
    throw new NotImplementedError("JobsService.reject()");
  }
}
