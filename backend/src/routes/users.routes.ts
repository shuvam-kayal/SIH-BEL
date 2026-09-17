import { Router } from "express";
import type { AppContainer } from "../container";
import { requirePermission, requireRole } from "../auth/rbac.middleware";
import { requireSession, requireActiveIdentity } from "../middleware/session";
import { ValidationError, NotFoundError } from "../errors";

export function usersRouter(c: AppContainer) {
  const router = Router();

  router.get("/admin/users/pending", requireSession, requirePermission("CREATE_EMPLOYEE"), async (_req, res, next) => {
    try { res.json(await c.users.listPendingRegistrations()); } catch (err) { next(err); }
  });

  router.post("/admin/users/:id/verify", requireSession, requirePermission("CREATE_EMPLOYEE"), async (req, res, next) => {
    try {
      res.json(await c.users.verifyRegistration(req.user!.identityId, req.params.id, req.body));
    } catch (err) { next(err); }
  });

  router.post("/admin/users/:id/activate", requireSession, requirePermission("CREATE_EMPLOYEE"), async (req, res, next) => {
    try { res.json(await c.users.activateRegistration(req.user!.identityId, req.params.id)); } catch (err) { next(err); }
  });

  router.post(
    "/admin/users/:id/revoke",
    requireSession,
    requireActiveIdentity,
    requirePermission("REVOKE_WALLET"),
    async (req, res, next) => {
      try {
        const reason = req.body?.reason;
        if (typeof reason !== "string" || reason.trim() === "") {
          throw new ValidationError(["reason is required to revoke a wallet"]);
        }
        res.json({ wallet: await c.users.revokeWallet(req.params.id, reason) });
      } catch (err) {
        next(err);
      }
    }
  );

  // POST /admin/users/:id/activate-wallet — activates an already registered device-generated wallet.
  router.post(
    "/admin/users/:id/activate-wallet",
    requireSession,
    requireActiveIdentity,
    requirePermission("ACTIVATE_WALLET"),
    async (req, res, next) => {
      try {
        const deviceId = req.body?.deviceId;
        const walletAddress = req.body?.walletAddress;
        if (typeof deviceId !== "string" || typeof walletAddress !== "string" || !walletAddress.trim()) {
          throw new ValidationError(["deviceId and device-generated walletAddress are required"]);
        }
        res.json({ wallet: await c.users.activateWallet(req.params.id, deviceId, walletAddress) });
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
    try { res.status(201).json(await c.users.registerDevice(req.params.id, req.body?.deviceId, req.body?.credential, req.body?.publicKey)); } catch (err) { next(err); }
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

  router.get("/users/me", requireSession, (req, res) => {
    res.json(req.user);
  });

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
