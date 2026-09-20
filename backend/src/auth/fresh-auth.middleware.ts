import type { NextFunction, Request, Response } from "express";
import type { AuthService, FreshAuthProofInput } from "./auth.service";
import { UnauthorizedError } from "../errors";

type ResourceResolver = (req: Request) => string | undefined;

/**
 * Fresh authentication is opt-in by configuration. Production defaults to
 * the high-impact operations; development and tests remain compatible with
 * the existing bearer-session workflow until a platform authenticator is
 * configured.
 */
export function freshAuthRequired(operation: string): boolean {
  const configured = process.env.BEL_FRESH_AUTH_REQUIRED_ACTIONS;
  if (configured !== undefined) return configured.split(",").map((value) => value.trim()).filter(Boolean).includes(operation);
  return process.env.BEL_ENV === "production" && [
    "WALLET_ACTIVATE", "WALLET_REVOKE", "ROLE_ASSIGN", "GRANT_CREATE", "GRANT_REVOKE", "ASSET_TRANSFER", "JOB_VERIFY",
  ].includes(operation);
}

export function requireFreshAuthentication(auth: AuthService, operation: string, resource?: ResourceResolver) {
  return async (req: Request, _res: Response, next: NextFunction) => {
    if (!freshAuthRequired(operation)) return next();
    const header = req.header("x-bel-fresh-auth");
    if (!header) return next(new UnauthorizedError("Fresh authentication is required"));
    try {
      const proof = JSON.parse(header) as Partial<FreshAuthProofInput>;
      if (typeof proof.challengeId !== "string" || typeof proof.publicKey !== "string" || typeof proof.signature !== "string") {
        throw new UnauthorizedError("Fresh authentication proof is malformed");
      }
      const token = req.header("authorization")?.slice(7).trim();
      if (!token) throw new UnauthorizedError("No valid session");
      await auth.verifyFreshAuthentication(token, proof as FreshAuthProofInput, operation, resource?.(req));
      next();
    } catch (error) {
      next(error instanceof SyntaxError ? new UnauthorizedError("Fresh authentication proof is malformed") : error);
    }
  };
}
