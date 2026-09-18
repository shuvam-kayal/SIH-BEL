// Routes for /assets* (docs/API_SPEC.yaml). Owner: Person 2.

import { Router } from "express";
import type { Container } from "../container";
import { requirePermission } from "../auth/rbac.middleware";
import { requireSession } from "../middleware/session";
import { NotFoundError, ValidationError } from "../errors";
import type { AuthorizationGrant } from "../../../shared/types";

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
        res.status(201).json(
          await c.assets.create(req.body, {
            identityId: req.user!.identityId,
            walletAddress: req.user!.walletAddress,
          })
        );
      } catch (err) {
        next(err);
      }
    }
  );

  // TRANSFER_ASSET is an AUTH cell for ENGINEER. Grants are resolved through
  // the repository-backed grant port wired by the main container.
  router.post(
    "/assets/:id/transfer",
    requireSession,
    requirePermission("TRANSFER_ASSET", async (req) => {
      const asset = await c.assets.getById(req.params.id);
      const grants = asset
        ? await c.repositories.grants.listByIdentityId(req.user!.identityId)
        : [];
      let grant: AuthorizationGrant | undefined;
      for (const candidate of grants) {
        if (
          candidate.resourceType !== "ASSET" ||
          candidate.resourceId !== asset?.assetId ||
          candidate.action !== "TRANSFER_ASSET" ||
          candidate.status !== "ACTIVE"
        ) continue;
        if (await c.users.validateGrant(candidate.authorizationGrantId, req.user!.identityId, asset!.assetId, "TRANSFER_ASSET")) {
          grant = candidate;
          break;
        }
      }
      return {
        explicitlyAuthorized: grant !== undefined,
        authorizationGrantId: grant?.authorizationGrantId,
        resourceOwnerId: asset?.ownerId,
      };
    }),
    async (req, res, next) => {
      try {
        const newOwnerId = req.body?.newOwnerId;
        if (typeof newOwnerId !== "string") {
          throw new ValidationError(["newOwnerId is required"]);
        }
        const newCustodianId = req.body?.newCustodianId;
        if (newCustodianId !== undefined && typeof newCustodianId !== "string") {
          throw new ValidationError(["newCustodianId must be a string"]);
        }
        res.json(
          await c.assets.transfer(req.params.id, newOwnerId, newCustodianId, {
            identityId: req.user!.identityId,
            walletAddress: req.user!.walletAddress,
          })
        );
      } catch (err) {
        next(err);
      }
    }
  );

  return router;
}
