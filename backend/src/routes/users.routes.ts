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
import { requireFreshAuthentication } from "../auth/fresh-auth.middleware";
import { ForbiddenError, NotFoundError, ValidationError } from "../errors";
import { isValidRole } from "../../../shared/schemas";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

// Resolve from this module's repository location, not process.cwd(). The
// backend may be started from the repo root, backend workspace, or a test.
const OPENAPI_SPEC_PATH = fileURLToPath(new URL("../../../docs/API_SPEC.yaml", import.meta.url));

export function usersRouter(c: Container): Router {
  const router = Router();

  router.get("/docs/openapi.yaml", (_req, res, next) => {
    try {
      res.type("text/yaml").send(readFileSync(OPENAPI_SPEC_PATH, "utf8"));
    } catch (err) { next(err); }
  });
  router.get("/docs", (_req, res) => {
    res.type("html").send(`<!doctype html>
<html>
<head>
  <title>BEL API</title>
  <link
    rel="stylesheet"
    href="https://unpkg.com/swagger-ui-dist/swagger-ui.css"
  />
</head>
<body>
  <div id="swagger-ui"></div>

  <script src="https://unpkg.com/swagger-ui-dist/swagger-ui-bundle.js"></script>
  <script>
    window.ui = SwaggerUIBundle({
      url: "/docs/openapi.yaml",
      dom_id: "#swagger-ui",
      persistAuthorization: true
    });
  </script>
</body>
</html>`);
  });

  // POST /auth/login — managed-device session, no public signup.
  router.post("/auth/login-challenge", async (req, res, next) => {
    try {
      if (typeof req.body?.deviceId !== "string") throw new ValidationError(["deviceId must be a string"]);
      res.status(201).json(await c.auth.requestAuthenticationChallenge(req.body.deviceId));
    } catch (err) { next(err); }
  });

  router.post("/auth/login", async (req, res, next) => {
    try {
      const credential = req.body?.deviceCredential;
      if (typeof credential === "string") {
        res.json(await c.auth.login(credential));
      } else if (typeof req.body?.deviceId === "string" && typeof req.body?.challengeId === "string" && typeof req.body?.publicKey === "string" && typeof req.body?.signature === "string") {
        res.json(await c.auth.login({ deviceId: req.body.deviceId, challengeId: req.body.challengeId, publicKey: req.body.publicKey, signature: req.body.signature }));
      } else {
        throw new ValidationError(["deviceCredential or device proof fields are required"]);
      }
    } catch (err) {
      next(err);
    }
  });

  router.post("/auth/fresh-challenge", requireSession, async (req, res, next) => {
    try {
      const operation = req.body?.operation;
      if (typeof operation !== "string" || !operation.trim()) throw new ValidationError(["operation is required"]);
      const resourceId = req.body?.resourceId;
      if (resourceId !== undefined && typeof resourceId !== "string") throw new ValidationError(["resourceId must be a string"]);
      const token = req.header("authorization")!.slice(7).trim();
      res.status(201).json(await c.auth.requestFreshAuthenticationChallenge(token, operation, resourceId));
    } catch (err) { next(err); }
  });

  // Device-side onboarding. The private key is deliberately not part of
  // either request; it must remain inside the managed device wallet.
  router.post("/auth/provisioning-challenge", async (req, res, next) => {
    try {
      res.status(201).json(await c.users.requestProvisioningChallenge({ deviceId: req.body?.deviceId, deviceMetadata: req.body?.deviceMetadata }));
    } catch (err) { next(err); }
  });

  router.post("/auth/initialize-account", async (req, res, next) => {
    try {
      res.status(202).json(await c.users.initializeAccount(req.body));
    } catch (err) { next(err); }
  });

  router.get("/admin/registrations/pending", requireSession, requireRole("ADMIN"), async (_req, res, next) => {
    try { res.json(await c.users.listPendingRegistrations()); } catch (err) { next(err); }
  });

  router.post("/admin/users/:id/verify", requireSession, requireRole("ADMIN"), async (req, res, next) => {
    try {
      res.json(await c.users.verifyRegistration(req.user!.identityId, req.params.id, { employeeId: req.body?.employeeId, department: req.body?.department }));
    } catch (err) { next(err); }
  });

  router.post("/admin/users/:id/activate", requireSession, requireRole("ADMIN"), async (req, res, next) => {
    try { res.json(await c.users.activateRegistration(req.user!.identityId, req.params.id)); } catch (err) { next(err); }
  });

  // POST /admin/users — Admin only (RBAC_MATRIX: Create employee).
  router.post(
    "/admin/users",
    requireSession,
    requirePermission("CREATE_EMPLOYEE"),
    async (req, res, next) => {
      try {
        if (process.env.BEL_ENV === "production") throw new ForbiddenError("Legacy administrator user creation is disabled in production; use account initialization");
        const errors: string[] = [];
        if (typeof req.body?.employeeId !== "string" || !req.body.employeeId.trim()) errors.push("employeeId is required");
        if (typeof req.body?.fullName !== "string" || !req.body.fullName.trim()) errors.push("fullName is required");
        if (typeof req.body?.department !== "string" || !req.body.department.trim()) errors.push("department is required");
        if (!isValidRole(req.body?.role)) errors.push("role is invalid");
        if (errors.length) throw new ValidationError(errors);
        res.status(201).json(await c.users.createUser(req.body, req.user!.identityId));
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
    requireFreshAuthentication(c.auth, "WALLET_REVOKE", (req) => req.params.id),
    requirePermission("REVOKE_WALLET"),
    async (req, res, next) => {
      try {
        const reason = req.body?.reason;
        if (typeof reason !== "string" || reason.trim() === "") {
          throw new ValidationError(["reason is required to revoke a wallet"]);
        }
        res.json({ wallet: await c.users.revokeWallet(req.params.id, reason, req.user!.identityId) });
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
    requireFreshAuthentication(c.auth, "WALLET_ACTIVATE", (req) => req.params.id),
    requirePermission("ACTIVATE_WALLET"),
    async (req, res, next) => {
      try {
        const deviceId = req.body?.deviceId;
        const walletAddress = req.body?.walletAddress;
        if (typeof deviceId !== "string" || typeof walletAddress !== "string" || !walletAddress.trim()) {
          throw new ValidationError(["deviceId and device-generated walletAddress are required"]);
        }
        res.json({ wallet: await c.users.activateWallet(req.params.id, deviceId, walletAddress, req.user!.identityId) });
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
  router.post("/admin/devices/:deviceId/revoke", requireSession, requireFreshAuthentication(c.auth, "WALLET_REVOKE", (req) => req.params.deviceId), requirePermission("REVOKE_WALLET"), async (req, res, next) => {
    try { res.json(await c.users.revokeDevice(req.params.deviceId, req.user!.identityId)); } catch (err) { next(err); }
  });
  router.post("/admin/users/:id/wallets", requireSession, requirePermission("ACTIVATE_WALLET"), async (req, res, next) => {
    try { res.status(201).json(await c.users.registerWallet(req.params.id, req.body?.deviceId, req.body?.walletAddress)); } catch (err) { next(err); }
  });
  router.get("/admin/users/:id/wallets", requireSession, requirePermission("CREATE_EMPLOYEE"), async (req, res, next) => {
    try { res.json(await c.users.listWallets(req.params.id)); } catch (err) { next(err); }
  });
  router.post("/admin/users/:id/role", requireSession, requireFreshAuthentication(c.auth, "ROLE_ASSIGN", (req) => req.params.id), requirePermission("CREATE_EMPLOYEE"), async (req, res, next) => {
    try { res.json(await c.users.assignRole(req.user!.identityId, req.params.id, req.body?.role)); } catch (err) { next(err); }
  });
  router.post("/admin/users/:id/grants", requireSession, requireFreshAuthentication(c.auth, "GRANT_CREATE", (req) => req.body?.resourceId), requireRole("ADMIN"), async (req, res, next) => {
    try { res.status(201).json(await c.users.createGrant(req.user!.identityId, req.params.id, req.body)); } catch (err) { next(err); }
  });
  router.get("/admin/users/:id/grants", requireSession, requirePermission("CREATE_EMPLOYEE"), async (req, res, next) => {
    try { res.json(await c.users.listGrants(req.params.id)); } catch (err) { next(err); }
  });
  router.post("/admin/users/:id/grants/:grantId/revoke", requireSession, requireFreshAuthentication(c.auth, "GRANT_REVOKE", (req) => req.params.grantId), requirePermission("CREATE_EMPLOYEE"), async (req, res, next) => {
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
