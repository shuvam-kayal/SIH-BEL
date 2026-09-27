// Routes for /jobs* (docs/API_SPEC.yaml). Owner: Person 3.
// Route-level permission comes from docs/RBAC_MATRIX.md; the legal
// status transition comes from the state machine in jobs.service.ts.
// Both must pass — a Manager still can't approve a job that is not yet
// COMPLETED.

import { Router } from "express";
import type { Container } from "../container";
import { requirePermission } from "../auth/rbac.middleware";
import { requireSession } from "../middleware/session";
import { requireFreshAuthentication } from "../auth/fresh-auth.middleware";
import { NotFoundError, ValidationError } from "../errors";

function actor(req: Express.Request) {
  return {
    identityId: req.user!.identityId,
    walletAddress: req.user!.walletAddress,
  };
}

export function jobsRouter(c: Container): Router {
  const router = Router();

  router.get("/jobs", requireSession, async (_req, res, next) => {
    try {
      res.json(await c.jobs.list());
    } catch (err) {
      next(err);
    }
  });

  router.get("/jobs/:id", requireSession, async (req, res, next) => {
    try {
      const jobs = await c.jobs.list();
      const job = jobs.find((item) => item.jobId === req.params.id);
      if (!job) throw new NotFoundError(`No job ${req.params.id}`);
      res.json(job);
    } catch (err) {
      next(err);
    }
  });

  router.post("/jobs", requireSession, requirePermission("CREATE_JOB"), async (req, res, next) => {
    try {
      if (typeof req.body?.assetId !== "string") {
        throw new ValidationError(["assetId is required"]);
      }
      res.status(201).json(await c.jobs.create({ ...req.body, createdBy: req.user!.identityId }, actor(req)));
    } catch (err) {
      next(err);
    }
  });

  router.post(
    "/jobs/:id/assign",
    requireSession,
    requirePermission("ASSIGN_TECHNICIAN"),
    async (req, res, next) => {
      try {
        if (typeof req.body?.technicianId !== "string") {
          throw new ValidationError(["technicianId is required"]);
        }
        res.json(await c.jobs.assign(req.params.id, req.body.technicianId, actor(req)));
      } catch (err) {
        next(err);
      }
    }
  );

  router.post(
    "/jobs/:id/start",
    requireSession,
    requirePermission("PERFORM_MAINTENANCE"),
    async (req, res, next) => {
      try {
        res.json(await c.jobs.start(req.params.id,actor(req)));
      } catch (err) {
        next(err);
      }
    }
  );

  router.post(
    "/jobs/:id/complete",
    requireSession,
    requirePermission("PERFORM_MAINTENANCE"),
    async (req, res, next) => {
      try {
        let evidenceHash = req.body?.evidenceHash;
        const evidenceId = req.body?.evidenceId;
        if (typeof evidenceId === "string" && evidenceId.trim()) {
          const storedHash = await c.evidence.getHash(req.params.id, evidenceId, {
            identityId: req.user!.identityId,
            walletAddress: req.user!.walletAddress,
            role: req.user!.role,
          });
          if (evidenceHash !== undefined && (typeof evidenceHash !== "string" || evidenceHash.toLowerCase().replace(/^0x/, "") !== storedHash)) {
            throw new ValidationError(["evidenceHash does not match the selected evidence"]);
          }
          evidenceHash = storedHash;
        }
        if (typeof evidenceHash !== "string" || evidenceHash.trim() === "") {
          throw new ValidationError(["evidenceHash is required"]);
        }
        res.json(await c.jobs.complete(req.params.id, evidenceHash, actor(req)));
      } catch (err) {
        next(err);
      }
    }
  );

  router.post(
    "/jobs/:id/approve",
    requireSession,
    requireFreshAuthentication(c.auth, "JOB_VERIFY", (req) => req.params.id),
    requirePermission("VERIFY_MAINTENANCE"),
    async (req, res, next) => {
      try {
        res.json(await c.jobs.approve(req.params.id, actor(req)));
      } catch (err) {
        next(err);
      }
    }
  );

  router.post(
    "/jobs/:id/reject",
    requireSession,
    requireFreshAuthentication(c.auth, "JOB_VERIFY", (req) => req.params.id),
    requirePermission("VERIFY_MAINTENANCE"),
    async (req, res, next) => {
      try {
        const reason = req.body?.reason;
        if (typeof reason !== "string" || reason.trim() === "") {
          throw new ValidationError(["reason is required"]);
        }
        res.json(await c.jobs.reject(req.params.id, reason, actor(req)));
      } catch (err) {
        next(err);
      }
    }
  );

  return router;
}
