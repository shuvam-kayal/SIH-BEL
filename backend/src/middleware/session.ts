// Development session shim. SYSTEM_SPEC.md assumes a BEL-managed
// workstation with a device-bound credential, so there is deliberately
// no password flow here to "finish" — Person 1 replaces the body of
// resolveUser() with real device/session verification and everything
// downstream (rbac.middleware, routes) keeps working unchanged.
//
// Until then the dev shim reads x-bel-employee-id / x-bel-role headers
// so the frontend and API tests can exercise every role.

import type { NextFunction, Request, Response } from "express";
import { ROLES } from "../../../shared/enums";
import type { Role, User } from "../../../shared/types";
import { UnauthorizedError } from "../errors";

declare global {
  namespace Express {
    interface Request {
      user?: User;
    }
  }
}

const devSessionsEnabled = () => process.env.BEL_DEV_SESSIONS !== "false";

function resolveUser(req: Request): User | undefined {
  // TODO(Person 1): replace with managed-device credential verification
  // and a real session store. See backend/src/auth/auth.service.ts.
  if (!devSessionsEnabled()) return undefined;

  const employeeId = req.header("x-bel-employee-id");
  const role = req.header("x-bel-role") as Role | undefined;
  if (!employeeId || !role || !ROLES.includes(role)) return undefined;

  return {
    employeeId,
    identityId: req.header("x-bel-identity-id") ?? `DID:BEL:${employeeId}`,
    walletAddress: req.header("x-bel-wallet") ?? "0xDevWallet",
    role,
    department: req.header("x-bel-department") ?? "UNSPECIFIED",
    status: "ACTIVE",
  };
}

/** Attaches req.user when a session is present. Never rejects. */
export function attachSession(req: Request, _res: Response, next: NextFunction) {
  req.user = resolveUser(req);
  next();
}

/** Rejects the request when no session is present. */
export function requireSession(req: Request, _res: Response, next: NextFunction) {
  if (!req.user) return next(new UnauthorizedError());
  next();
}
