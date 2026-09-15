// HTTP-level tests. These assert the wiring — routes exist, sessions
// are required, the RBAC matrix is actually enforced at the boundary,
// and unfinished services report 501 rather than 500. They deliberately
// do NOT assert business behaviour: that arrives with each owner's
// implementation, and these tests should still pass then.

import { beforeAll, describe, expect, it } from "vitest";
import request from "supertest";
import { createApp } from "../src/app";
import { createContainer } from "../src/container";
import { createMemoryRepositories } from "../src/users/repository-implementations";

const container = createContainer(undefined, { repositories: createMemoryRepositories() });
const app = createApp(container);
const tokens: Record<string, string> = {};

const as = (role: string, employeeId = "EMP001") => ({
  Authorization: `Bearer ${tokens[role]}`,
});

beforeAll(async () => {
  for (const role of ["ADMIN", "MANAGER", "ENGINEER", "TECHNICIAN", "AUDITOR", "ISSUER", "VERIFIER"] as const) {
    const employeeId = `SEED-${role}`;
    await container.users.createUser({ employeeId, fullName: role, role, department: "TEST" });
    await container.users.registerDevice(employeeId, `${employeeId}-DEVICE`, `${employeeId}-CREDENTIAL`);
    await container.users.activateWallet(employeeId, `${employeeId}-DEVICE`);
    tokens[role] = (await container.auth.login(`${employeeId}-CREDENTIAL`)).token;
  }
});

describe("infrastructure", () => {
  it("reports health", async () => {
    const res = await request(app).get("/health");
    expect(res.status).toBe(200);
    expect(res.body.status).toBe("ok");
  });

  it("404s an unknown route with a structured error", async () => {
    const res = await request(app).get("/nope");
    expect(res.status).toBe(404);
    expect(res.body.code).toBe("NOT_FOUND");
  });
});

describe("sessions", () => {
  it("rejects an unauthenticated request", async () => {
    const res = await request(app).get("/assets");
    expect(res.status).toBe(401);
    expect(res.body.code).toBe("UNAUTHORIZED");
  });

  it("returns the caller's own identity", async () => {
    const res = await request(app).get("/users/me").set(as("ENGINEER"));
    expect(res.status).toBe(200);
    expect(res.body.employeeId).toBe("SEED-ENGINEER");
    expect(res.body.role).toBe("ENGINEER");
  });
});

describe("permission enforcement at the HTTP boundary", () => {
  it("blocks a manager from creating an employee", async () => {
    const res = await request(app)
      .post("/admin/users")
      .set(as("MANAGER"))
      .send({ employeeId: "EMP009", fullName: "Employee 009", department: "TEST", role: "TECHNICIAN" });
    expect(res.status).toBe(403);
    expect(res.body.code).toBe("FORBIDDEN");
  });

  it("blocks a technician from assigning a job", async () => {
    const res = await request(app)
      .post("/jobs/JOB-001/assign")
      .set(as("TECHNICIAN"))
      .send({ technicianId: "DID:BEL:2" });
    expect(res.status).toBe(403);
  });

  it("blocks an engineer from transferring without an explicit grant", async () => {
    const res = await request(app)
      .post("/assets/AST-001/transfer")
      .set(as("ENGINEER"))
      .send({ newOwnerId: "DID:BEL:2" });
    expect(res.status).toBe(403);
  });

  it("allows an engineer through CREATE_JOB while denying a technician", async () => {
    const allowed = await request(app).post("/jobs").set(as("ENGINEER")).send({ assetId: "AST-001", priority: "LOW" });
    expect(allowed.status).toBe(501); // service is intentionally owned by Person 3; the RBAC gate passed.
    const denied = await request(app).post("/jobs").set(as("TECHNICIAN")).send({ assetId: "AST-001", priority: "LOW" });
    expect(denied.status).toBe(403);
  });

  it("allows a technician through PERFORM_MAINTENANCE while denying an auditor", async () => {
    const allowed = await request(app).post("/jobs/JOB-001/start").set(as("TECHNICIAN"));
    expect(allowed.status).toBe(501); // service is intentionally owned by Person 3; the RBAC gate passed.
    const denied = await request(app).post("/jobs/JOB-001/start").set(as("AUDITOR"));
    expect(denied.status).toBe(403);
  });

  it("lets an admin past the permission gate", async () => {
    const res = await request(app)
      .post("/admin/users")
      .set(as("ADMIN"))
      .send({ employeeId: "EMP009", fullName: "Employee 009", department: "TEST", role: "TECHNICIAN" });
    expect(res.status).toBe(201);
    expect(res.body.identity.employeeId).toBe("EMP009");
    expect(res.body.user.status).toBe("ACTIVE");
  });
});

describe("request validation", () => {
  it("rejects a wallet revocation with no reason", async () => {
    const res = await request(app).post("/admin/users/EMP002/revoke-wallet").set(as("ADMIN")).send({});
    expect(res.status).toBe(400);
    expect(res.body.code).toBe("VALIDATION_FAILED");
  });

  it("rejects a non-numeric committee height", async () => {
    const res = await request(app).get("/blockchain/committee/abc").set(as("AUDITOR"));
    expect(res.status).toBe(400);
  });
});

describe("chain pass-through", () => {
  it("serves validators from the injected adapter", async () => {
    const res = await request(app).get("/blockchain/validators").set(as("TECHNICIAN"));
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body)).toBe(true);
    expect(res.body[0].validatorId).toBe("val_0");
  });
});

describe("unimplemented modules", () => {
  it("reports 501 rather than 500 for services awaiting their owner", async () => {
    const res = await request(app).get("/assets").set(as("ENGINEER"));
    expect(res.status).toBe(501);
    expect(res.body.message).toContain("AssetsService.list()");
  });
});
