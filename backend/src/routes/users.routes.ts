// Routes for /auth/login, /admin/users*, /users* — exactly the paths in
// docs/API_SPEC.yaml. Owner: Person 1.
//
// Every handler is a thin adapter: validate, check permission, call the
// service, serialize. Business logic belongs in the service so it stays
// testable without HTTP.

import { Router } from "express";
import type { Container } from "../container";
import { requirePermission, requireRole } from "../auth/rbac.middleware";
import { requireSession } from "../middleware/session";
import { requireActiveIdentity } from "../auth/rbac.middleware";
import { NotFoundError, ValidationError } from "../errors";
import { isValidRole } from "../../../shared/schemas";

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
        const errors: string[] = [];
        if (typeof req.body?.employeeId !== "string" || !req.body.employeeId.trim()) errors.push("employeeId is required");
        if (typeof req.body?.fullName !== "string" || !req.body.fullName.trim()) errors.push("fullName is required");
        if (typeof req.body?.department !== "string" || !req.body.department.trim()) errors.push("department is required");
        if (!isValidRole(req.body?.role)) errors.push("role is invalid");
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
    requireActiveIdentity,
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
    requireActiveIdentity,
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

  router.post("/auth/logout", requireSession, async (req, res, next) => {
    try {
      const token = req.header("authorization")!.slice(7).trim();
      await c.auth.logout(token);
      res.status(204).send();
    } catch (err) { next(err); }
  });

  router.post("/admin/users/:id/devices", requireSession, requirePermission("CREATE_EMPLOYEE"), async (req, res, next) => {
    try { res.status(201).json(await c.users.registerDevice(req.params.id, req.body?.deviceId, req.body?.credential)); } catch (err) { next(err); }
  });
  router.get("/admin/users/:id/devices", requireSession, requirePermission("CREATE_EMPLOYEE"), async (req, res, next) => {
    try { res.json(await c.users.listDevices(req.params.id)); } catch (err) { next(err); }
  });
  router.post("/admin/devices/:deviceId/revoke", requireSession, requirePermission("REVOKE_WALLET"), async (req, res, next) => {
    try { res.json(await c.users.revokeDevice(req.params.deviceId)); } catch (err) { next(err); }
  });
  router.post("/admin/users/:id/wallets", requireSession, requirePermission("ACTIVATE_WALLET"), async (req, res, next) => {
    try { res.status(201).json(await c.users.registerWallet(req.params.id, req.body?.deviceId, req.body?.walletAddress)); } catch (err) { next(err); }
  });
  router.get("/admin/users/:id/wallets", requireSession, requirePermission("CREATE_EMPLOYEE"), async (req, res, next) => {
    try { res.json(await c.users.listWallets(req.params.id)); } catch (err) { next(err); }
  });
  router.post("/admin/users/:id/role", requireSession, requirePermission("CREATE_EMPLOYEE"), async (req, res, next) => {
    try { res.json(await c.users.assignRole(req.user!.identityId, req.params.id, req.body?.role)); } catch (err) { next(err); }
  });
  router.post("/admin/users/:id/grants", requireSession, requireRole("ADMIN"), async (req, res, next) => {
    try { res.status(201).json(await c.users.createGrant(req.user!.identityId, req.params.id, req.body)); } catch (err) { next(err); }
  });
  router.get("/admin/users/:id/grants", requireSession, requirePermission("CREATE_EMPLOYEE"), async (req, res, next) => {
    try { res.json(await c.users.listGrants(req.params.id)); } catch (err) { next(err); }
  });
  router.post("/admin/users/:id/grants/:grantId/revoke", requireSession, requirePermission("CREATE_EMPLOYEE"), async (req, res, next) => {
    try { res.json(await c.users.revokeGrant(req.user!.identityId, req.params.grantId)); } catch (err) { next(err); }
  });

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
