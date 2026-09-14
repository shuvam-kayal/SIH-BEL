// Routes for /assets* (docs/API_SPEC.yaml). Owner: Person 2.

import { Router } from "express";
import type { Container } from "../container";
import { requirePermission } from "../auth/rbac.middleware";
import { requireSession } from "../middleware/session";
import { NotFoundError, ValidationError } from "../errors";

export function assetsRouter(c: Container): Router {
  const router = Router();

  router.get("/assets", requireSession, async (_req, res, next) => {
    try {
      res.json(await c.assets.list());
    } catch (err) {
      next(err);
    }
  });

  router.get("/assets/:id", requireSession, async (req, res, next) => {
    try {
      const asset = await c.assets.getById(req.params.id);
      if (!asset) throw new NotFoundError(`No asset ${req.params.id}`);
      res.json(asset);
    } catch (err) {
      next(err);
    }
  });

  router.post(
    "/assets",
    requireSession,
    requirePermission("REGISTER_ASSET"),
    async (req, res, next) => {
      try {
        if (typeof req.body?.assetType !== "string") {
          throw new ValidationError(["assetType is required"]);
        }
        res.status(201).json(await c.assets.create(req.body));
      } catch (err) {
        next(err);
      }
    }
  );

  // TRANSFER_ASSET is an AUTH cell for ENGINEER: permitted only with an
  // explicit per-asset grant. The resolver below is where Person 2 looks
  // that grant up; until then only ADMIN/MANAGER pass, which is the
  // safe direction to fail.
  router.post(
    "/assets/:id/transfer",
    requireSession,
    requirePermission("TRANSFER_ASSET", async (req) => ({
      // TODO(Person 2): load the asset and return
      // { explicitlyAuthorized: grants.has(req.user.identityId) }.
      explicitlyAuthorized: false,
      resourceOwnerId: undefined,
    })),
    async (req, res, next) => {
      try {
        const newOwnerId = req.body?.newOwnerId;
        if (typeof newOwnerId !== "string") {
          throw new ValidationError(["newOwnerId is required"]);
        }
        res.json(await c.assets.transfer(req.params.id, newOwnerId));
      } catch (err) {
        next(err);
      }
    }
  );

  return router;
}
