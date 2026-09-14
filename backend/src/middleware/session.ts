// Bearer-session middleware. Device credentials are exchanged only at the
// public login endpoint; protected requests are resolved from server state.

import type { NextFunction, Request, Response } from "express";
import type { User } from "../../../shared/types";
import { UnauthorizedError } from "../errors";
import { AuthServiceImpl } from "../auth/auth.service";

declare global {
  namespace Express {
    interface Request {
      user?: User;
    }
  }
}

const auth = new AuthServiceImpl();

async function resolveUser(req: Request): Promise<User | undefined> {
  const header = req.header("authorization");
  if (!header?.startsWith("Bearer ")) return undefined;
  return (await auth.validateSession(header.slice(7).trim())) ?? undefined;
}

/** Attaches req.user when a valid bearer session is present. Never rejects. */
export async function attachSession(req: Request, _res: Response, next: NextFunction) {
  try { req.user = await resolveUser(req); next(); } catch (error) { next(error); }
}

/** Rejects the request when no session is present. */
export function requireSession(req: Request, _res: Response, next: NextFunction) {
  if (!req.user) return next(new UnauthorizedError());
  next();
}
