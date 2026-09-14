// State-machine tests for the job workflow in docs/SYSTEM_SPEC.md:
//   CREATED -> ASSIGNED -> IN_PROGRESS -> COMPLETED -> VERIFIED
//                                             \-> REJECTED -> ASSIGNED
// These run without a datastore, so Person 3 can keep them green while
// the persistence layer is still being written.

import { describe, expect, it } from "vitest";
import { MockBlockchainAdapter } from "../../mocks/mock-blockchain";
import { ALLOWED_TRANSITIONS, JobsServiceImpl } from "../src/jobs/jobs.service";
import { JOB_STATUSES } from "../../shared/enums";

const jobs = new JobsServiceImpl(new MockBlockchainAdapter());

describe("job transitions", () => {
  it("covers every declared job status", () => {
    for (const status of JOB_STATUSES) {
      expect(ALLOWED_TRANSITIONS[status], status).toBeDefined();
    }
  });

  it("walks the happy path", () => {
    expect(() => jobs.assertTransition("CREATED", "ASSIGNED")).not.toThrow();
    expect(() => jobs.assertTransition("ASSIGNED", "IN_PROGRESS")).not.toThrow();
    expect(() => jobs.assertTransition("IN_PROGRESS", "COMPLETED")).not.toThrow();
    expect(() => jobs.assertTransition("COMPLETED", "VERIFIED")).not.toThrow();
  });

  it("allows rejection and re-assignment after completion", () => {
    expect(() => jobs.assertTransition("COMPLETED", "REJECTED")).not.toThrow();
    expect(() => jobs.assertTransition("REJECTED", "ASSIGNED")).not.toThrow();
  });

  it("refuses to skip the technician's work", () => {
    expect(() => jobs.assertTransition("CREATED", "COMPLETED")).toThrow(/Invalid job transition/);
    expect(() => jobs.assertTransition("ASSIGNED", "VERIFIED")).toThrow();
  });

  it("treats VERIFIED as terminal", () => {
    expect(ALLOWED_TRANSITIONS.VERIFIED).toHaveLength(0);
    expect(() => jobs.assertTransition("VERIFIED", "IN_PROGRESS")).toThrow();
  });
});
