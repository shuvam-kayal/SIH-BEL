// Owner: Person 1. Backs POST /auth/login (docs/API_SPEC.yaml).
// Assumes a managed-device session per SYSTEM_SPEC.md security
// assumptions — no public signup, no password-based flow to design
// from scratch. Fill in the actual device/session verification here.

import { randomUUID } from "node:crypto";
import { User } from "../../../shared/types";
import { ForbiddenError, UnauthorizedError } from "../errors";
import { hashCredential, identityStore, IdentityStore } from "../users/identity.store";
import { createMemoryRepositories } from "../users/repository-implementations";
import type { IdentityRepositories } from "../users/repositories";

export interface AuthService {
  login(deviceCredential: string): Promise<{ user: User; token: string }>;
  validateSession(token: string): Promise<User | null>;
  logout(token: string): Promise<void>;
}

export class AuthServiceImpl implements AuthService {
  private readonly repositories: IdentityRepositories;

  constructor(repositories?: IdentityRepositories | IdentityStore) {
    this.repositories = repositories instanceof IdentityStore ? createMemoryRepositories(repositories) : repositories ?? createMemoryRepositories(identityStore);
  }

  async login(deviceCredential: string): Promise<{ user: User; token: string }> {
    if (!deviceCredential.trim()) throw new UnauthorizedError("Invalid device credential");
    const deviceId = await this.repositories.credentials.findDeviceId(hashCredential(deviceCredential));
    if (!deviceId) throw new UnauthorizedError("Invalid device credential");
    const device = await this.repositories.devices.findById(deviceId);
    const identity = device ? await this.repositories.identities.findById(device.identityId) : null;
    const user = identity ? await this.repositories.users.findByIdentityId(identity.identityId) : null;
    const wallets = identity ? await this.repositories.wallets.listByIdentityId(identity.identityId) : [];
    const wallet = wallets.find((item) => item.status === "ACTIVE");
    if (!device || device.status !== "ACTIVE" || !identity || !user || !wallet || wallet.deviceId !== device.deviceId) {
      throw new UnauthorizedError("Device, identity, or wallet is not active");
    }
    if (identity.status !== "ACTIVE") throw new ForbiddenError(`Identity is ${identity.status}`);
    const token = `bel_${randomUUID()}`;
    const ttl = Number(process.env.BEL_SESSION_TTL_SECONDS ?? 3600);
    await this.repositories.sessions.save({ token, identityId: identity.identityId, deviceId: device.deviceId, walletAddress: wallet.address, expiresAt: Date.now() + Math.max(60, ttl) * 1000 });
    return { user: { ...user, walletAddress: wallet.address, role: identity.role, status: identity.status }, token };
  }

  async validateSession(token: string): Promise<User | null> {
    const session = await this.repositories.sessions.find(token);
    if (!session) return null;
    if (session.expiresAt <= Date.now()) { await this.repositories.sessions.delete(token); return null; }
    const identity = await this.repositories.identities.findById(session.identityId);
    const device = await this.repositories.devices.findById(session.deviceId);
    const wallet = await this.repositories.wallets.findByAddress(session.walletAddress);
    const user = identity ? await this.repositories.users.findByIdentityId(identity.identityId) : null;
    if (!identity || !user || !device || device.status !== "ACTIVE" || identity.status !== "ACTIVE" || !wallet || wallet.deviceId !== device.deviceId) {
      await this.repositories.sessions.delete(token);
      return null;
    }
    return { ...user, walletAddress: wallet.address, role: identity.role, status: identity.status };
  }

  async logout(token: string): Promise<void> { await this.repositories.sessions.delete(token); }
}
