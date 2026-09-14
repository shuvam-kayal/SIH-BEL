// Owner: Person 1. Backs POST /auth/login (docs/API_SPEC.yaml).
// Assumes a managed-device session per SYSTEM_SPEC.md security
// assumptions — no public signup, no password-based flow to design
// from scratch. Fill in the actual device/session verification here.

import { randomUUID } from "node:crypto";
import { User } from "../../../shared/types";
import { ForbiddenError, UnauthorizedError } from "../errors";
import { identityStore, IdentityStore } from "../users/identity.store";

export interface AuthService {
  login(deviceCredential: string): Promise<{ user: User; token: string }>;
  validateSession(token: string): Promise<User | null>;
}

export class AuthServiceImpl implements AuthService {
  constructor(private readonly store: IdentityStore = identityStore) {}

  async login(deviceCredential: string): Promise<{ user: User; token: string }> {
    if (!deviceCredential.trim()) throw new UnauthorizedError("Invalid device credential");
    const deviceId = this.store.credentials.get(deviceCredential);
    if (!deviceId) throw new UnauthorizedError("Invalid device credential");
    const device = this.store.devices.get(deviceId);
    const identity = device ? this.store.identities.get(device.identityId) : undefined;
    const user = identity ? this.store.userForIdentity(identity.identityId) : undefined;
    const wallet = identity ? this.store.walletForIdentity(identity.identityId, "ACTIVE") : undefined;
    if (!device || device.status !== "ACTIVE" || !identity || !user || !wallet || wallet.deviceId !== device.deviceId) {
      throw new UnauthorizedError("Device, identity, or wallet is not active");
    }
    if (identity.status !== "ACTIVE") throw new ForbiddenError(`Identity is ${identity.status}`);
    const token = `bel_${randomUUID()}`;
    this.store.sessions.set(token, { token, identityId: identity.identityId, deviceId: device.deviceId });
    return { user: { ...user, walletAddress: wallet.address, role: identity.role, status: identity.status }, token };
  }

  async validateSession(token: string): Promise<User | null> {
    const session = this.store.sessions.get(token);
    if (!session) return null;
    const identity = this.store.identities.get(session.identityId);
    const device = this.store.devices.get(session.deviceId);
    const wallet = identity ? this.store.walletForIdentity(identity.identityId, "ACTIVE") : undefined;
    const user = identity ? this.store.userForIdentity(identity.identityId) : undefined;
    if (!identity || !user || !device || device.status !== "ACTIVE" || identity.status !== "ACTIVE" || !wallet || wallet.deviceId !== device.deviceId) {
      this.store.sessions.delete(token);
      return null;
    }
    return { ...user, walletAddress: wallet.address, role: identity.role, status: identity.status };
  }
}
