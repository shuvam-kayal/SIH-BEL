// Routes for /audit/* and /blockchain/* (docs/API_SPEC.yaml).
// Read-only surfaces: audit is owned by whoever writes the events,
// blockchain is a pass-through to the injected BlockchainService.

import { Router } from "express";
import type { Container } from "../container";
import { requirePermission } from "../auth/rbac.middleware";
import { requireSession } from "../middleware/session";
import { ValidationError } from "../errors";

export function chainRouter(c: Container): Router {
  const router = Router();

  // VIEW_AUDIT_HISTORY is an OWN cell for TECHNICIAN — they may only
  // read trails for assets tied to their own jobs.
  router.get(
    "/audit/assets/:id",
    requireSession,
    requirePermission("VIEW_AUDIT_HISTORY", async (_req) => ({
      // TODO(Person 3): resolve the asset's related job assignee so a
      // TECHNICIAN's OWN check can succeed for their own work.
      resourceOwnerId: undefined,
    })),
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

  return router;
}
