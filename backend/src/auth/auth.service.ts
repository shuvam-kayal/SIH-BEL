// Owner: Person 1. Backs POST /auth/login (docs/API_SPEC.yaml).
// Assumes a managed-device session per SYSTEM_SPEC.md security
// assumptions — no public signup, no password-based flow to design
// from scratch. Fill in the actual device/session verification here.

import { User } from "../../../shared/types";
import { NotImplementedError } from "../errors";

export interface AuthService {
  login(deviceCredential: string): Promise<{ user: User; token: string }>;
  validateSession(token: string): Promise<User | null>;
}

export class AuthServiceImpl implements AuthService {
  async login(_deviceCredential: string): Promise<{ user: User; token: string }> {
    // TODO: verify the managed-device credential, look up the bound
    // Identity/Wallet, and issue a session token.
    throw new NotImplementedError("AuthService.login()");
  }

  async validateSession(_token: string): Promise<User | null> {
    // TODO: validate session token and return the associated User.
    throw new NotImplementedError("AuthService.validateSession()");
  }
}
