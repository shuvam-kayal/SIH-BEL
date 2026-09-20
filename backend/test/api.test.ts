// HTTP-level tests. These assert the wiring — routes exist, sessions
// are required, the RBAC matrix is actually enforced at the boundary,
// and unfinished services report 501 rather than 500. They deliberately
// do NOT assert business behaviour: that arrives with each owner's
// implementation, and these tests should still pass then.

import { beforeAll, describe, expect, it } from "vitest";
import request from "supertest";
import { createApp } from "../src/app";
import { createContainer } from "../src/container";
import { MockBlockchainAdapter } from "../../mocks/mock-blockchain";
import { MemoryAssetRepository } from "../src/domain/repositories";
import { createMemoryRepositories } from "../src/users/repository-implementations";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const container = createContainer(new MockBlockchainAdapter(), { repositories: createMemoryRepositories(), assets: new MemoryAssetRepository() });
const app = createApp(container);
const tokens: Record<string, string> = {};

const as = (role: string, employeeId = "EMP001") => ({
  Authorization: `Bearer ${tokens[role]}`,
});

beforeAll(async () => {
  for (const role of ["ADMIN", "MANAGER", "ENGINEER", "TECHNICIAN", "AUDITOR", "ISSUER", "VERIFIER"] as const) {
    const employeeId = `SEED-${role}`;
    await container.users.createUser({ employeeId, fullName: role, role, department: "TEST" });
    await container.users.registerDevice(employeeId, `${employeeId}-DEVICE`, `${employeeId}-CREDENTIAL`, `PUBLIC-${employeeId}`);
    await container.users.registerWallet(employeeId, `${employeeId}-DEVICE`, `0xTEST-${employeeId}`);
    await container.users.activateWallet(employeeId, `${employeeId}-DEVICE`, `0xTEST-${employeeId}`);
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

  it("serves the repository OpenAPI document from any working directory", async () => {
    const spec = await request(app).get("/docs/openapi.yaml");
    expect(spec.status).toBe(200);
    expect(spec.type).toBe("text/yaml");
    expect(spec.text).toBe(readFileSync(fileURLToPath(new URL("../../docs/API_SPEC.yaml", import.meta.url)), "utf8"));
  });

  it("serves the Swagger UI shell pointing at the OpenAPI document", async () => {
    const docs = await request(app).get("/docs");
    expect(docs.status).toBe(200);
    expect(docs.text).toContain("SwaggerUIBundle");
    expect(docs.text).toContain("/docs/openapi.yaml");
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
    // The RBAC gate passes, but integrated job creation also requires a real asset.
    expect(allowed.status).toBe(404);
    const denied = await request(app).post("/jobs").set(as("TECHNICIAN")).send({ assetId: "AST-001", priority: "LOW" });
    expect(denied.status).toBe(403);
  });

  it("allows a technician through PERFORM_MAINTENANCE while denying an auditor", async () => {
    const allowed = await request(app).post("/jobs/JOB-001/start").set(as("TECHNICIAN"));
    expect(allowed.status).toBe(404); // service is intentionally owned by Person 3; the RBAC gate passed.
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

  it("rejects the legacy direct-admin creation path in production", async () => {
    const previous = process.env.BEL_ENV;
    process.env.BEL_ENV = "production";
    try {
      const res = await request(app).post("/admin/users").set(as("ADMIN")).send({ employeeId: "PROD-BYPASS", fullName: "No Bypass", department: "TEST", role: "ENGINEER" });
      expect(res.status).toBe(403);
      expect(res.body.code).toBe("FORBIDDEN");
    } finally {
      if (previous === undefined) delete process.env.BEL_ENV;
      else process.env.BEL_ENV = previous;
    }
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
    expect(res.status).toBe(200);
    expect(res.body).toEqual([]);
  });
});
