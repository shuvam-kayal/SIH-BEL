import { describe, expect, it } from "vitest";
import { JobsServiceImpl } from "../src/jobs/jobs.service";
import type { BlockchainService } from "../src/adapters/BlockchainService";
import { MockBlockchainAdapter } from "../../mocks/mock-blockchain";

const actor = {
  identityId: "DID:BEL:USER",
  walletAddress: "0x0000000000000000000000000000000000000001",
};

const mockChain: BlockchainService = {
  submitTransaction: async () => ({
    txId: "TX-001",
    status: "SUCCESS",
  }),

  getIdentity: async () => null,
  getWallet: async () => null,
  getAsset: async () => null,
  getJob: async () => null,
  getValidators: async () => [],
  getCommittee: async () => [],
  getBlock: async () => null,

  getStatus: async () => ({
    height: 0,
    healthy: true,
    finalityLag: 0,
    lastFinalizedHeight: 0,
  }),
};

describe("JobsService", () => {
  it("list() initially returns an empty array", async () => {
    const service = new JobsServiceImpl(mockChain);

    const jobs = await service.list();

    expect(jobs).toEqual([]);
  });

  it("create() creates a new job", async () => {
    const service = new JobsServiceImpl(mockChain);

    const job = await service.create(
      {
        assetId: "ASSET-001",
        createdBy: "IDENTITY-001",
        priority: "HIGH",
      },
      actor
    );

    expect(job.jobId).toBe("JOB-1");
    expect(job.assetId).toBe("ASSET-001");
    expect(job.createdBy).toBe("IDENTITY-001");
    expect(job.assignedTo).toBe("");
    expect(job.verifierId).toBeNull();
    expect(job.status).toBe("CREATED");
    expect(job.priority).toBe("HIGH");
    expect(job.createdAt).toBeTruthy();
    expect(job.completedAt).toBeNull();
  });

  it("create() adds the job to list()", async () => {
    const service = new JobsServiceImpl(mockChain);

    const job = await service.create(
      {
        assetId: "ASSET-001",
        createdBy: "IDENTITY-001",
        priority: "HIGH",
      },
      actor
    );

    const jobs = await service.list();

    expect(jobs).toContain(job);
  });

  it("create() rejects a missing assetId", async () => {
    const service = new JobsServiceImpl(mockChain);

    await expect(
      service.create(
        {
          createdBy: "IDENTITY-001",
          priority: "HIGH",
        },
        actor
      )
    ).rejects.toThrow("assetId is required");
  });

  it("create() rejects a missing createdBy", async () => {
    const service = new JobsServiceImpl(mockChain);

    await expect(
      service.create(
        {
          assetId: "ASSET-001",
          priority: "HIGH",
        },
        actor
      )
    ).rejects.toThrow("createdBy is required");
  });

  it("create() rejects a missing priority", async () => {
    const service = new JobsServiceImpl(mockChain);

    await expect(
      service.create(
        {
          assetId: "ASSET-001",
          createdBy: "IDENTITY-001",
        },
        actor
      )
    ).rejects.toThrow("priority is required");
  });

  it("assign() assigns a technician to a created job", async () => {
    const service = new JobsServiceImpl(mockChain);

    await service.create(
      {
        assetId: "ASSET-001",
        createdBy: "IDENTITY-001",
        priority: "HIGH",
      },
      actor
    );

    const job = await service.assign("JOB-1", "TECH-001", actor);

    expect(job.assignedTo).toBe("TECH-001");
    expect(job.status).toBe("ASSIGNED");
  });

  it("assign() rejects a non-existent job", async () => {
    const service = new JobsServiceImpl(mockChain);

    await expect(
      service.assign("JOB-999", "TECH-001", actor)
    ).rejects.toThrow("No job JOB-999");
  });

  it("assign() rejects a missing technicianId", async () => {
    const service = new JobsServiceImpl(mockChain);

    await service.create(
      {
        assetId: "ASSET-001",
        createdBy: "IDENTITY-001",
        priority: "HIGH",
      },
      actor
    );

    await expect(
      service.assign("JOB-1", "", actor)
    ).rejects.toThrow("technicianId is required");
  });

  it("assign() rejects assigning a job that is not in CREATED state", async () => {
    const service = new JobsServiceImpl(mockChain);

    await service.create(
      {
        assetId: "ASSET-001",
        createdBy: "IDENTITY-001",
        priority: "HIGH",
      },
      actor
    );

    await service.assign("JOB-1", "TECH-001", actor);

    await expect(
      service.assign("JOB-1", "TECH-002", actor)
    ).rejects.toThrow(
      "Invalid job transition: ASSIGNED -> ASSIGNED"
    );
  });

  it("start() starts an assigned job", async () => {
    const service = new JobsServiceImpl(mockChain);

    await service.create(
      {
        assetId: "ASSET-001",
        createdBy: "IDENTITY-001",
        priority: "HIGH",
      },
      actor
    );

    await service.assign("JOB-1", "TECH-001", actor);

    const job = await service.start("JOB-1", actor);

    expect(job.status).toBe("IN_PROGRESS");
    expect(job.assignedTo).toBe("TECH-001");
  });

  it("start() rejects a non-existent job", async () => {
    const service = new JobsServiceImpl(mockChain);

    await expect(
      service.start("JOB-999", actor)
    ).rejects.toThrow("No job JOB-999");
  });

  it("start() rejects starting a job that is still CREATED", async () => {
    const service = new JobsServiceImpl(mockChain);

    await service.create(
      {
        assetId: "ASSET-001",
        createdBy: "IDENTITY-001",
        priority: "HIGH",
      },
      actor
    );

    await expect(
      service.start("JOB-1", actor)
    ).rejects.toThrow(
      "Invalid job transition: CREATED -> IN_PROGRESS"
    );
  });

  it("start() rejects starting an already started job", async () => {
    const service = new JobsServiceImpl(mockChain);

    await service.create(
      {
        assetId: "ASSET-001",
        createdBy: "IDENTITY-001",
        priority: "HIGH",
      },
      actor
    );

    await service.assign("JOB-1", "TECH-001", actor);
    await service.start("JOB-1", actor);

    await expect(
      service.start("JOB-1", actor)
    ).rejects.toThrow(
      "Invalid job transition: IN_PROGRESS -> IN_PROGRESS"
    );
  });

  it("complete() completes an in-progress job", async () => {
    const service = new JobsServiceImpl(mockChain);

    await service.create(
      {
        assetId: "ASSET-001",
        createdBy: "IDENTITY-001",
        priority: "HIGH",
      },
      actor
    );

    await service.assign("JOB-1", "TECH-001", actor);
    await service.start("JOB-1", actor);

    const job = await service.complete(
      "JOB-1",
      "HASH-001",
      actor
    );

    expect(job.status).toBe("COMPLETED");
    expect(job.assignedTo).toBe("TECH-001");
    expect(job.completedAt).toBeTruthy();
  });

  it("complete() rejects a non-existent job", async () => {
    const service = new JobsServiceImpl(mockChain);

    await expect(
      service.complete("JOB-999", "HASH-001", actor)
    ).rejects.toThrow("No job JOB-999");
  });

  it("complete() rejects completing a CREATED job", async () => {
    const service = new JobsServiceImpl(mockChain);

    await service.create(
      {
        assetId: "ASSET-001",
        createdBy: "IDENTITY-001",
        priority: "HIGH",
      },
      actor
    );

    await expect(
      service.complete("JOB-1", "HASH-001", actor)
    ).rejects.toThrow(
      "Invalid job transition: CREATED -> COMPLETED"
    );
  });

  it("complete() rejects completing an ASSIGNED job", async () => {
    const service = new JobsServiceImpl(mockChain);

    await service.create(
      {
        assetId: "ASSET-001",
        createdBy: "IDENTITY-001",
        priority: "HIGH",
      },
      actor
    );

    await service.assign("JOB-1", "TECH-001", actor);

    await expect(
      service.complete("JOB-1", "HASH-001", actor)
    ).rejects.toThrow(
      "Invalid job transition: ASSIGNED -> COMPLETED"
    );
  });

  it("complete() rejects completing an already completed job", async () => {
    const service = new JobsServiceImpl(mockChain);

    await service.create(
      {
        assetId: "ASSET-001",
        createdBy: "IDENTITY-001",
        priority: "HIGH",
      },
      actor
    );

    await service.assign("JOB-1", "TECH-001", actor);
    await service.start("JOB-1", actor);
    await service.complete("JOB-1", "HASH-001", actor);

    await expect(
      service.complete("JOB-1", "HASH-002", actor)
    ).rejects.toThrow(
      "Invalid job transition: COMPLETED -> COMPLETED"
    );
  });

  it("approves a completed job", async () => {
    const service = new JobsServiceImpl(mockChain);

    const job = await service.create(
      {
        assetId: "ASSET-1",
        createdBy: "USER-1",
        priority: "HIGH",
      },
      actor
    );

    await service.assign(job.jobId, "TECH-1", actor);
    await service.start(job.jobId, actor);
    await service.complete(job.jobId, "hash-123", actor);

    const approved = await service.approve(job.jobId, actor);

    expect(approved.status).toBe("VERIFIED");
  });

  it("rejects approval for a missing job", async () => {
    const service = new JobsServiceImpl(mockChain);

    await expect(
      service.approve("JOB-999", actor)
    ).rejects.toThrow("No job JOB-999");
  });

  it("rejects approval when the job is not completed", async () => {
    const service = new JobsServiceImpl(mockChain);

    const job = await service.create(
      {
        assetId: "ASSET-1",
        createdBy: "USER-1",
        priority: "HIGH",
      },
      actor
    );

    await expect(
      service.approve(job.jobId, actor)
    ).rejects.toThrow(/Invalid job transition/);
  });

  it("does not allow approval of an already verified job", async () => {
    const service = new JobsServiceImpl(mockChain);

    const job = await service.create(
      {
        assetId: "ASSET-1",
        createdBy: "USER-1",
        priority: "HIGH",
      },
      actor
    );

    await service.assign(job.jobId, "TECH-1", actor);
    await service.start(job.jobId, actor);
    await service.complete(job.jobId, "hash-123", actor);
    await service.approve(job.jobId, actor);

    await expect(
      service.approve(job.jobId, actor)
    ).rejects.toThrow(/Invalid job transition/);
  });

  it("rejects a completed job", async () => {
    const service = new JobsServiceImpl(mockChain);

    const job = await service.create(
      {
        assetId: "ASSET-1",
        createdBy: "USER-1",
        priority: "HIGH",
      },
      actor
    );

    await service.assign(job.jobId, "TECH-1", actor);
    await service.start(job.jobId, actor);
    await service.complete(job.jobId, "hash-123", actor);

    const rejected = await service.reject(
      job.jobId,
      "Maintenance work is incomplete",
      actor
    );

    expect(rejected.status).toBe("REJECTED");
  });

  it("rejects a missing job", async () => {
    const service = new JobsServiceImpl(mockChain);

    await expect(
      service.reject(
        "JOB-999",
        "Invalid maintenance",
        actor
      )
    ).rejects.toThrow("No job JOB-999");
  });

  it("rejects a rejection without a reason", async () => {
    const service = new JobsServiceImpl(mockChain);

    const job = await service.create(
      {
        assetId: "ASSET-1",
        createdBy: "USER-1",
        priority: "HIGH",
      },
      actor
    );

    await service.assign(job.jobId, "TECH-1", actor);
    await service.start(job.jobId, actor);
    await service.complete(job.jobId, "hash-123", actor);

    await expect(
      service.reject(job.jobId, "", actor)
    ).rejects.toThrow("reason is required");
  });

  it("rejects a job that is not completed", async () => {
    const service = new JobsServiceImpl(mockChain);

    const job = await service.create(
      {
        assetId: "ASSET-1",
        createdBy: "USER-1",
        priority: "HIGH",
      },
      actor
    );

    await expect(
      service.reject(
        job.jobId,
        "Invalid maintenance",
        actor
      )
    ).rejects.toThrow(/Invalid job transition/);
  });
});
