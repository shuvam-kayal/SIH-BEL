// Owner: Person 1. This is the single enforcement point for
// docs/RBAC_MATRIX.md on the backend — the frontend also gates on the
// same matrix for UX, but this is the boundary that actually matters.
// Smart contracts enforce it again independently (Phase 5/6); the two
// must never drift, which is exactly why RBAC_MATRIX.md is frozen.
//
// The matrix itself lives in shared/rbac so the frontend imports the
// exact same table. Nothing here hardcodes a role list.

import type { NextFunction, Request, Response } from "express";
import { can, type Action, type PermissionContext } from "../../../shared/rbac";
import type { Role } from "../../../shared/types";
import { ForbiddenError, UnauthorizedError } from "../errors";
import { identityStore } from "../users/identity.store";

/**
 * Resolves the extra context an AUTH or OWN cell needs. Routes supply
 * this when the target record's owner isn't known until it's loaded —
 * e.g. "Technician may view audit history for their own jobs".
 */
export type ContextResolver = (req: Request) => PermissionContext | Promise<PermissionContext>;

/** Gate a route on a docs/RBAC_MATRIX.md action. */
export function requirePermission(action: Action, resolveContext?: ContextResolver) {
  return async (req: Request, _res: Response, next: NextFunction) => {
    if (!req.user) return next(new UnauthorizedError());

    try {
      const ctx = resolveContext ? await resolveContext(req) : {};
      const context: PermissionContext = { actorId: req.user.identityId, ...ctx };

      const wallet = identityStore.wallets.get(req.user.walletAddress);
      const device = wallet ? identityStore.devices.get(wallet.deviceId) : undefined;
      if (req.user.status !== "ACTIVE" || !wallet || wallet.identityId !== req.user.identityId || wallet.status !== "ACTIVE" || !device || device.status !== "ACTIVE") {
        return next(new ForbiddenError("Identity, device, or wallet is not active"));
      }

      if (!can(req.user.role, action, context)) {
        return next(
          new ForbiddenError(`Role ${req.user.role} may not perform ${action}`)
        );
      }
      next();
    } catch (err) {
      next(err);
    }
  };
}

/**
 * Coarser gate for routes that are role-scoped rather than
 * action-scoped (e.g. an admin-only sub-router). Prefer
 * requirePermission — it keeps the matrix as the only source of truth.
 */
export function requireRole(...allowed: Role[]) {
  return (req: Request, _res: Response, next: NextFunction) => {
    if (!req.user) return next(new UnauthorizedError());
    if (!allowed.includes(req.user.role)) {
      return next(new ForbiddenError(`Role ${req.user.role} is not permitted here`));
    }
    next();
  };
}

/** Reject any request from a wallet/identity that is no longer active. */
export function requireActiveIdentity(req: Request, _res: Response, next: NextFunction) {
  if (!req.user) return next(new UnauthorizedError());
  if (req.user.status !== "ACTIVE") {
    return next(new ForbiddenError(`Identity is ${req.user.status}`));
  }
  const wallet = identityStore.wallets.get(req.user.walletAddress);
  const device = wallet ? identityStore.devices.get(wallet.deviceId) : undefined;
  if (!wallet || wallet.identityId !== req.user.identityId || wallet.status !== "ACTIVE" || !device || device.status !== "ACTIVE") {
    return next(new ForbiddenError("Wallet or device is not active"));
  }
  next();
}
