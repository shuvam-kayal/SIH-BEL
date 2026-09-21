// Routes for /audit/* and /blockchain/* (docs/API_SPEC.yaml).
// Read-only surfaces: audit is owned by whoever writes the events,
// blockchain is a pass-through to the injected BlockchainService.

import { Router } from "express";
import type { Container } from "../container";
import { requirePermission } from "../auth/rbac.middleware";
import { requireSession } from "../middleware/session";
import { requireFreshAuthentication } from "../auth/fresh-auth.middleware";
import { ValidationError } from "../errors";

export function chainRouter(c: Container): Router {
  const router = Router();

  // VIEW_AUDIT_HISTORY is an OWN cell for TECHNICIAN — they may only
  // read trails for assets tied to their own jobs.
  router.get(
    "/audit/assets/:id",
    requireSession,
    requirePermission("VIEW_AUDIT_HISTORY", async (req) => {
      const asset = await c.assets.getById(req.params.id);
      const jobs = await c.jobs.list();
      const ownJob = jobs.find((job) => job.assetId === req.params.id && (job.assignedTo === req.user!.identityId || job.createdBy === req.user!.identityId));
      return { resourceOwnerId: ownJob?.assignedTo ?? asset?.ownerId };
    }),
    async (req, res, next) => {
      try {
        res.json(await c.audit.getTrailForAsset(req.params.id));
      } catch (err) {
        next(err);
      }
    }
  );

  router.get("/blockchain/status", async (_req, res, next) => {
    try {
      res.json(await c.blockchain.getStatus());
    } catch (err) {
      next(err);
    }
  });

  router.get(
    "/blockchain/validators",
    requireSession,
    requirePermission("VIEW_VALIDATOR_STATUS"),
    async (_req, res, next) => {
      try {
        res.json(await c.blockchain.getValidators());
      } catch (err) {
        next(err);
      }
    }
  );

  router.get(
    "/blockchain/committee/:height",
    requireSession,
    requirePermission("VIEW_VALIDATOR_STATUS"),
    async (req, res, next) => {
      try {
        const height = Number(req.params.height);
        if (!Number.isInteger(height) || height < 0) {
          throw new ValidationError(["height must be a non-negative integer"]);
        }
        res.json(await c.blockchain.getCommittee(height));
      } catch (err) {
        next(err);
      }
    }
  );

  router.get("/admin/validators", requireSession, requirePermission("MANAGE_VALIDATORS"), async (_req, res, next) => {
    try { res.json(await c.validators.list()); } catch (err) { next(err); }
  });
  router.get("/admin/validators/history", requireSession, requirePermission("MANAGE_VALIDATORS"), async (_req, res, next) => {
    try { res.json(await c.validators.getHistory()); } catch (err) { next(err); }
  });
  router.post("/admin/validators", requireSession, requirePermission("MANAGE_VALIDATORS"), requireFreshAuthentication(c.auth, "VALIDATOR_ADD", (req) => req.body?.validatorId), async (req, res, next) => {
    try { res.status(201).json(await c.validators.addValidator(req.user!.identityId, req.body)); } catch (err) { next(err); }
  });
  router.post("/admin/validators/:id/remove", requireSession, requirePermission("MANAGE_VALIDATORS"), requireFreshAuthentication(c.auth, "VALIDATOR_REMOVE", (req) => req.params.id), async (req, res, next) => {
    try { res.json(await c.validators.removeValidator(req.user!.identityId, req.params.id, { removalHeight: Number(req.body?.removalHeight), reason: req.body?.reason })); } catch (err) { next(err); }
  });
  router.post("/admin/validators/:id/restore", requireSession, requirePermission("MANAGE_VALIDATORS"), requireFreshAuthentication(c.auth, "VALIDATOR_RESTORE", (req) => req.params.id), async (req, res, next) => {
    try { res.json(await c.validators.restoreValidator(req.user!.identityId, req.params.id, req.body)); } catch (err) { next(err); }
  });
  return router;
}
