// Routes for /assets* (docs/API_SPEC.yaml). Owner: Person 2.

import { Router } from "express";
import type { Container } from "../container";
import { requirePermission } from "../auth/rbac.middleware";
import { requireSession } from "../middleware/session";
import { requireFreshAuthentication } from "../auth/fresh-auth.middleware";
import { NotFoundError, ValidationError } from "../errors";
import type { AuthorizationGrant } from "../../../shared/types";
import { randomUUID } from "node:crypto";

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
            signature: typeof req.body?.signature === "string" ? req.body.signature : undefined,
          })
        );
      } catch (err) {
        next(err);
      }
    }
  );

  router.post("/assets/prepare", requireSession, requirePermission("REGISTER_ASSET"), async (req, res, next) => {
    try {
      if (typeof req.body?.assetType !== "string") throw new ValidationError(["assetType is required"]);
      const prepare = c.chain.prepareTransaction;
      if (!prepare) return res.status(501).json({ code: "NOT_IMPLEMENTED", message: "Device transaction preparation is unavailable" });
      const assetId = typeof req.body.assetId === "string" && req.body.assetId.trim() ? req.body.assetId.trim() : `AST-${randomUUID()}`;
      const tx = { txId: randomUUID(), type: "ASSET_MINT" as const, actorIdentity: req.user!.identityId, actorWallet: req.user!.walletAddress,
        payload: { assetId, assetType: req.body.assetType, ownerId: req.body.ownerId, custodianId: req.body.custodianId, parentAssetId: req.body.parentAssetId ?? null },
        timestamp: new Date().toISOString(), signature: "development" };
      res.json({ intent: { ...req.body, assetId }, transaction: await prepare.call(c.chain, tx) });
    } catch (err) { next(err); }
  });

  // TRANSFER_ASSET is an AUTH cell for ENGINEER. Grants are resolved through
  // the repository-backed grant port wired by the main container.
  router.post(
    "/assets/:id/transfer",
    requireSession,
    requireFreshAuthentication(c.auth, "ASSET_TRANSFER", (req) => req.params.id),
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

  router.post(
    "/assets/:id/state",
    requireSession,
    requireFreshAuthentication(c.auth, "ASSET_STATE_CHANGE", (req) => req.params.id),
    requirePermission("REGISTER_ASSET"),
    async (req, res, next) => {
      try {
        const newState = req.body?.newState ?? req.body?.status;
        if (typeof newState !== "string") throw new ValidationError(["newState is required"]);
        res.json(await c.assets.changeAssetState(req.params.id, newState as Parameters<typeof c.assets.changeAssetState>[1], {
          identityId: req.user!.identityId,
          walletAddress: req.user!.walletAddress,
        }));
      } catch (err) {
        next(err);
      }
    },
  );

  router.post(
    "/assets/:id/components",
    requireSession,
    requireFreshAuthentication(c.auth, "COMPONENT_ATTACH", (req) => req.params.id),
    requirePermission("REGISTER_ASSET"),
    async (req, res, next) => {
      try {
        if (typeof req.body?.componentId !== "string") throw new ValidationError(["componentId is required"]);
        res.json(await c.assets.attachComponent(req.params.id, req.body.componentId, {
          identityId: req.user!.identityId,
          walletAddress: req.user!.walletAddress,
        }));
      } catch (err) {
        next(err);
      }
    },
  );

  router.delete(
    "/assets/:id/components/:componentId",
    requireSession,
    requireFreshAuthentication(c.auth, "COMPONENT_REMOVE", (req) => req.params.componentId),
    requirePermission("REGISTER_ASSET"),
    async (req, res, next) => {
      try {
        res.json(await c.assets.removeComponent(req.params.id, req.params.componentId, {
          identityId: req.user!.identityId,
          walletAddress: req.user!.walletAddress,
        }));
      } catch (err) {
        next(err);
      }
    },
  );

  return router;
}
