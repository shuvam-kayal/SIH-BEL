// Routes for /auth/login, /admin/users*, /users* — exactly the paths in
// docs/API_SPEC.yaml. Owner: Person 1.
//
// Every handler is a thin adapter: validate, check permission, call the
// service, serialize. Business logic belongs in the service so it stays
// testable without HTTP.

import { Router } from "express";
import type { Container } from "../container";
import { requirePermission } from "../auth/rbac.middleware";
import { requireSession } from "../middleware/session";
import { NotFoundError, ValidationError } from "../errors";
import { validateIdentity } from "../../../shared/schemas";

export function usersRouter(c: Container): Router {
  const router = Router();

  // POST /auth/login — managed-device session, no public signup.
  router.post("/auth/login", async (req, res, next) => {
    try {
      const credential = req.body?.deviceCredential;
      if (typeof credential !== "string") {
        throw new ValidationError(["deviceCredential must be a string"]);
      }
      res.json(await c.auth.login(credential));
    } catch (err) {
      next(err);
    }
  });

  // POST /admin/users — Admin only (RBAC_MATRIX: Create employee).
  router.post(
    "/admin/users",
    requireSession,
    requirePermission("CREATE_EMPLOYEE"),
    async (req, res, next) => {
      try {
        const errors = validateIdentity(req.body);
        if (errors.length) throw new ValidationError(errors);
        res.status(201).json(await c.users.createUser(req.body));
      } catch (err) {
        next(err);
      }
    }
  );

  // POST /admin/users/:id/revoke-wallet — Admin only.
  router.post(
    "/admin/users/:id/revoke-wallet",
    requireSession,
    requirePermission("REVOKE_WALLET"),
    async (req, res, next) => {
      try {
        const reason = req.body?.reason;
        if (typeof reason !== "string" || reason.trim() === "") {
          throw new ValidationError(["reason is required to revoke a wallet"]);
        }
        res.json(await c.users.revokeWallet(req.params.id, reason));
      } catch (err) {
        next(err);
      }
    }
  );

  // POST /admin/users/:id/activate-wallet — Admin or Issuer.
  // Not in API_SPEC.yaml yet; WALLET_ACTIVATE is a frozen transaction
  // type in CONTRACT_SPEC.md, so the route exists here and the spec
  // needs the matching path added (flagged for Person 1).
  router.post(
    "/admin/users/:id/activate-wallet",
    requireSession,
    requirePermission("ACTIVATE_WALLET"),
    async (req, res, next) => {
      try {
        const deviceId = req.body?.deviceId;
        if (typeof deviceId !== "string") {
          throw new ValidationError(["deviceId is required to bind a wallet"]);
        }
        res.json(await c.users.activateWallet(req.params.id, deviceId));
      } catch (err) {
        next(err);
      }
    }
  );

  // GET /users/me
  router.get("/users/me", requireSession, (req, res) => {
    res.json(req.user);
  });

  // GET /users/:id
  router.get("/users/:id", requireSession, async (req, res, next) => {
    try {
      const user = await c.users.getById(req.params.id);
      if (!user) throw new NotFoundError(`No user ${req.params.id}`);
      res.json(user);
    } catch (err) {
      next(err);
    }
  });

  return router;
}
