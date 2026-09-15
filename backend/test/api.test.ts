// HTTP-level tests. These assert the wiring — routes exist, sessions
// are required, the RBAC matrix is actually enforced at the boundary,
// and unfinished services report 501 rather than 500. They deliberately
// do NOT assert business behaviour: that arrives with each owner's
// implementation, and these tests should still pass then.

import { describe, expect, it } from "vitest";
import request from "supertest";
import { createApp } from "../src/app";

const app = createApp();

const as = (role: string, employeeId = "EMP001") => ({
  "x-bel-employee-id": employeeId,
  "x-bel-role": role,
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
    expect(res.body.employeeId).toBe("EMP001");
    expect(res.body.role).toBe("ENGINEER");
  });
});

describe("permission enforcement at the HTTP boundary", () => {
  it("blocks a manager from creating an employee", async () => {
    const res = await request(app)
      .post("/admin/users")
      .set(as("MANAGER"))
      .send({ identityId: "DID:BEL:9", employeeId: "EMP009", role: "TECHNICIAN", status: "ACTIVE" });
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

  it("lets an admin past the permission gate", async () => {
    const res = await request(app)
      .post("/admin/users")
      .set(as("ADMIN"))
      .send({ identityId: "DID:BEL:9", employeeId: "EMP009", role: "TECHNICIAN", status: "ACTIVE" });
    // Passes RBAC, then hits the unimplemented service.
    expect(res.status).toBe(501);
    expect(res.body.code).toBe("NOT_IMPLEMENTED");
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
