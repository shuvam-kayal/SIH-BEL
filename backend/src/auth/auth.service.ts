// Owner: Person 1. Backs POST /auth/login (docs/API_SPEC.yaml).
// Assumes a managed-device session per SYSTEM_SPEC.md security
// assumptions — no public signup, no password-based flow to design
// from scratch. Fill in the actual device/session verification here.

import { createHash, createPublicKey, randomBytes, randomUUID, verify } from "node:crypto";
import { ProvisioningChallenge, User } from "../../../shared/types";
import { ForbiddenError, UnauthorizedError } from "../errors";
import { hashCredential } from "../users/identity.store";
import type { IdentityRepositories } from "../users/repositories";
import { assertWalletMatchesPublicKey, verifyCompactSignature } from "../blockchain/crypto";

export interface AuthService {
  login(deviceCredential: string | LoginProofInput): Promise<{ user: User; token: string }>;
  requestAuthenticationChallenge(deviceId: string): Promise<ProvisioningChallenge>;
  requestFreshAuthenticationChallenge(token: string, operation: string, resourceId?: string): Promise<ProvisioningChallenge>;
  verifyFreshAuthentication(token: string, input: FreshAuthProofInput, operation: string, resourceId?: string): Promise<void>;
  validateSession(token: string): Promise<User | null>;
  logout(token: string): Promise<void>;
}

export type LoginProofInput = { deviceId: string; challengeId: string; publicKey: string; signature: string };
export type FreshAuthProofInput = { challengeId: string; publicKey: string; signature: string };

export class AuthServiceImpl implements AuthService {
  private readonly repositories: IdentityRepositories;

  constructor(repositories: IdentityRepositories) { this.repositories = repositories; }

  async requestAuthenticationChallenge(deviceId: string): Promise<ProvisioningChallenge> {
    const device = await this.repositories.devices.findById(deviceId);
    const identity = device ? await this.repositories.identities.findById(device.identityId) : null;
    const wallet = identity ? (await this.repositories.wallets.listByIdentityId(identity.identityId)).find((item) => item.status === "ACTIVE" && item.deviceId === deviceId) : null;
    if (!device || device.status !== "ACTIVE" || !identity || identity.status !== "ACTIVE" || !wallet) throw new UnauthorizedError("Device, identity, or wallet is not active");
    const challenge: ProvisioningChallenge = {
      challengeId: randomUUID(), deviceId, challenge: randomBytes(32).toString("base64url"), purpose: "AUTHENTICATION",
      expiresAt: new Date(Date.now() + 5 * 60 * 1000).toISOString(), usedAt: null, metadata: null,
    };
    await this.repositories.challenges.save(challenge);
    return { ...challenge };
  }

  async requestFreshAuthenticationChallenge(token: string, operation: string, resourceId?: string): Promise<ProvisioningChallenge> {
    const session = await this.repositories.sessions.find(token);
    if (!session || session.expiresAt <= Date.now() || !await this.activeSession(session)) throw new UnauthorizedError("No valid session");
    if (!operation?.trim()) throw new UnauthorizedError("Fresh-auth operation is required");
    const challenge: ProvisioningChallenge = {
      challengeId: randomUUID(),
      deviceId: session.deviceId,
      challenge: randomBytes(32).toString("base64url"),
      purpose: "FRESH_AUTHENTICATION",
      expiresAt: new Date(Date.now() + 2 * 60 * 1000).toISOString(),
      usedAt: null,
      metadata: { operation: operation.trim(), resourceId: resourceId?.trim() || null, sessionHash: this.sessionHash(token) },
    };
    await this.repositories.challenges.save(challenge);
    return { ...challenge };
  }

  async verifyFreshAuthentication(token: string, input: FreshAuthProofInput, operation: string, resourceId?: string): Promise<void> {
    const session = await this.repositories.sessions.find(token);
    if (!session || session.expiresAt <= Date.now() || !await this.activeSession(session)) throw new UnauthorizedError("No valid session");
    const challenge = await this.repositories.challenges.findById(input.challengeId);
    const metadata = challenge?.metadata;
    if (!challenge || challenge.purpose !== "FRESH_AUTHENTICATION" || challenge.usedAt || challenge.deviceId !== session.deviceId || metadata?.sessionHash !== this.sessionHash(token) || metadata.operation !== operation || (metadata.resourceId ?? null) !== (resourceId ?? null)) {
      throw new UnauthorizedError("Invalid fresh-authentication challenge");
    }
    if (Date.parse(challenge.expiresAt) <= Date.now()) throw new UnauthorizedError("Fresh-authentication challenge has expired");
    const device = await this.repositories.devices.findById(session.deviceId);
    const identity = device ? await this.repositories.identities.findById(device.identityId) : null;
    const wallet = identity ? (await this.repositories.wallets.listByIdentityId(identity.identityId)).find((item) => item.address === session.walletAddress && item.status === "ACTIVE" && item.deviceId === session.deviceId) : null;
    if (!device || device.status !== "ACTIVE" || !identity || identity.status !== "ACTIVE" || !wallet || !device.publicKey || input.publicKey !== device.publicKey) throw new UnauthorizedError("Device, identity, or wallet is not active");
    if (this.evmCryptoEnabled()) {
      try { assertWalletMatchesPublicKey(wallet.address, device.publicKey); } catch { throw new UnauthorizedError("Wallet address does not match device public key"); }
    }
    if (!this.verifyProof(challenge.challenge, device.publicKey, input.signature)) throw new UnauthorizedError("Invalid fresh-authentication proof");
    if (!await this.repositories.challenges.consumeIfUnused(challenge.challengeId, new Date().toISOString())) throw new UnauthorizedError("Fresh-authentication challenge has already been used");
  }

  async login(deviceCredential: string | LoginProofInput): Promise<{ user: User; token: string }> {
    if (typeof deviceCredential !== "string") return this.loginWithProof(deviceCredential);
    if (process.env.BEL_ENV === "production") throw new ForbiddenError("Legacy device-credential login is disabled in production");
    if (!deviceCredential.trim()) throw new UnauthorizedError("Invalid device credential");
    const deviceId = await this.repositories.credentials.findDeviceId(hashCredential(deviceCredential));
    if (!deviceId) throw new UnauthorizedError("Invalid device credential");
    const device = await this.repositories.devices.findById(deviceId);
    const identity = device ? await this.repositories.identities.findById(device.identityId) : null;
    const user = identity ? await this.repositories.users.findByIdentityId(identity.identityId) : null;
    const wallets = identity ? await this.repositories.wallets.listByIdentityId(identity.identityId) : [];
    const wallet = wallets.find((item) => item.status === "ACTIVE");
    if (!device || device.status !== "ACTIVE" || !identity || !identity.employeeId || !identity.role || !identity.department || !user || !wallet || wallet.deviceId !== device.deviceId) {
      throw new UnauthorizedError("Device, identity, or wallet is not active");
    }
    if (identity.status !== "ACTIVE") throw new ForbiddenError(`Identity is ${identity.status}`);
    const token = `bel_${randomUUID()}`;
    const ttl = Number(process.env.BEL_SESSION_TTL_SECONDS ?? 3600);
    await this.repositories.sessions.save({ token, identityId: identity.identityId, deviceId: device.deviceId, walletAddress: wallet.address, expiresAt: Date.now() + Math.max(60, ttl) * 1000 });
    return { user: { ...user, walletAddress: wallet.address, role: identity.role, status: identity.status }, token };
  }

  private async loginWithProof(input: LoginProofInput): Promise<{ user: User; token: string }> {
    const challenge = await this.repositories.challenges.findById(input.challengeId);
    if (!challenge || challenge.purpose !== "AUTHENTICATION" || challenge.usedAt || challenge.deviceId !== input.deviceId) throw new UnauthorizedError("Invalid authentication challenge");
    if (Date.parse(challenge.expiresAt) <= Date.now()) throw new UnauthorizedError("Authentication challenge has expired");
    const device = await this.repositories.devices.findById(input.deviceId);
    const identity = device ? await this.repositories.identities.findById(device.identityId) : null;
    const user = identity ? await this.repositories.users.findByIdentityId(identity.identityId) : null;
    const wallet = identity ? (await this.repositories.wallets.listByIdentityId(identity.identityId)).find((item) => item.status === "ACTIVE" && item.deviceId === input.deviceId) : null;
    if (!device || device.status !== "ACTIVE" || !identity || !identity.employeeId || !identity.role || !identity.department || identity.status !== "ACTIVE" || !user || !wallet || !device.publicKey || device.publicKey !== input.publicKey) throw new UnauthorizedError("Device, identity, or wallet is not active");
    if (this.evmCryptoEnabled()) {
      try { assertWalletMatchesPublicKey(wallet.address, device.publicKey); } catch { throw new UnauthorizedError("Wallet address does not match device public key"); }
    }
    if (!this.verifyProof(challenge.challenge, device.publicKey, input.signature)) throw new UnauthorizedError("Invalid authentication proof");
    if (!await this.repositories.challenges.consumeIfUnused(challenge.challengeId, new Date().toISOString())) throw new UnauthorizedError("Authentication challenge has already been used");
    const token = `bel_${randomUUID()}`;
    const ttl = Number(process.env.BEL_SESSION_TTL_SECONDS ?? 3600);
    await this.repositories.sessions.save({ token, identityId: identity.identityId, deviceId: device.deviceId, walletAddress: wallet.address, expiresAt: Date.now() + Math.max(60, ttl) * 1000 });
    return { user: { ...user, walletAddress: wallet.address, role: identity.role, status: identity.status }, token };
  }

  private verifyProof(challenge: string, publicKey: string, signature: string): boolean {
    if (this.evmCryptoEnabled()) return verifyCompactSignature(challenge, publicKey, signature);
    try {
      const key = publicKey.includes("BEGIN") ? createPublicKey(publicKey) : createPublicKey({ key: Buffer.from(publicKey, "base64"), format: "der", type: "spki" });
      const bytes = /^[0-9a-f]+$/i.test(signature) ? Buffer.from(signature, "hex") : Buffer.from(signature, "base64url");
      return verify(null, Buffer.from(challenge), key, bytes) || verify("sha256", Buffer.from(challenge), key, bytes);
    } catch { return false; }
  }

  private evmCryptoEnabled(): boolean { return (process.env.BEL_BLOCKCHAIN ?? "mock").trim().toLowerCase() === "evm"; }

  async validateSession(token: string): Promise<User | null> {
    const session = await this.repositories.sessions.find(token);
    if (!session) return null;
    if (session.expiresAt <= Date.now()) { await this.repositories.sessions.delete(token); return null; }
    const identity = await this.repositories.identities.findById(session.identityId);
    const device = await this.repositories.devices.findById(session.deviceId);
    const wallet = await this.repositories.wallets.findByAddress(session.walletAddress);
    const user = identity ? await this.repositories.users.findByIdentityId(identity.identityId) : null;
    if (!identity || !identity.employeeId || !identity.role || !identity.department || !user || !device || device.status !== "ACTIVE" || identity.status !== "ACTIVE" || !wallet || wallet.status !== "ACTIVE" || wallet.deviceId !== device.deviceId) {
      await this.repositories.sessions.delete(token);
      return null;
    }
    if (this.evmCryptoEnabled() && (!device.publicKey || (() => { try { assertWalletMatchesPublicKey(wallet.address, device.publicKey!); return false; } catch { return true; } })())) {
      await this.repositories.sessions.delete(token);
      return null;
    }
    return { ...user, walletAddress: wallet.address, role: identity.role, status: identity.status };
  }

  async logout(token: string): Promise<void> { await this.repositories.sessions.delete(token); }

  private sessionHash(token: string): string { return createHash("sha256").update(token).digest("hex"); }

  private async activeSession(session: { identityId: string; deviceId: string; walletAddress: string }): Promise<boolean> {
    const identity = await this.repositories.identities.findById(session.identityId);
    const device = await this.repositories.devices.findById(session.deviceId);
    const wallet = await this.repositories.wallets.findByAddress(session.walletAddress);
    return Boolean(identity?.status === "ACTIVE" && device?.status === "ACTIVE" && wallet?.status === "ACTIVE" && wallet.deviceId === device.deviceId && wallet.identityId === identity.identityId);
  }
}
