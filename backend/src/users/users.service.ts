import { randomUUID } from "node:crypto";
import type { CreateUserResponse } from "../../../shared/api";
import type { AuthorizationGrant, Device, Identity, Role, User, Wallet } from "../../../shared/types";
import type { Action } from "../../../shared/rbac";
import { ROLES } from "../../../shared/enums";
import { BlockchainService } from "../adapters/BlockchainService";
import { ForbiddenError, HttpError, NotFoundError, ValidationError } from "../errors";
import { hashCredential, identityStore, IdentityStore } from "./identity.store";

export type CreateIdentityInput = Partial<Identity> & Pick<Identity, "employeeId" | "role">;

export interface UsersService {
  createUser(input: CreateIdentityInput): Promise<CreateUserResponse>;
  registerDevice(userId: string, deviceId: string, credential?: string): Promise<Device>;
  revokeDevice(deviceId: string): Promise<Device>;
  registerWallet(userId: string, deviceId: string, address?: string): Promise<Wallet>;
  revokeWallet(userId: string, reason: string): Promise<Wallet>;
  activateWallet(userId: string, deviceId: string, address?: string): Promise<Wallet>;
  assignRole(actorId: string, userId: string, role: Role): Promise<User>;
  getById(id: string): Promise<User | null>;
  getIdentity(id: string): Promise<Identity | null>;
  createGrant(actorId: string, targetId: string, input: { resourceType: "ASSET" | "JOB"; resourceId: string; action: Action; expiresAt?: string | null }): Promise<AuthorizationGrant>;
  listGrants(targetId: string): Promise<AuthorizationGrant[]>;
  revokeGrant(actorId: string, grantId: string): Promise<AuthorizationGrant>;
  validateGrant(grantId: string, actorId: string, resourceId: string, action: Action): boolean;
  listDevices(userId: string): Promise<Device[]>;
  listWallets(userId: string): Promise<Wallet[]>;
}

const SYSTEM_IDENTITY = "DID:BEL:SYSTEM";
const SYSTEM_WALLET = "SYSTEM";
class ConflictError extends HttpError {
  constructor(message: string) { super(409, message, "CONFLICT"); }
}

export class UsersServiceImpl implements UsersService {
  constructor(
    private readonly chain: BlockchainService,
    private readonly store: IdentityStore = identityStore,
  ) {}

  async createUser(input: CreateIdentityInput): Promise<CreateUserResponse> {
    if (!input.employeeId || !ROLES.includes(input.role)) {
      throw new ValidationError(["employeeId and a valid role are required"]);
    }
    if ([...this.store.identities.values()].some((item) => item.employeeId === input.employeeId)) {
      throw new ConflictError(`Employee ${input.employeeId} already exists`);
    }
    if (input.identityId && this.store.identities.has(input.identityId)) {
      throw new ConflictError(`Identity ${input.identityId} already exists`);
    }

    const identity: Identity = {
      identityId: input.identityId ?? this.store.nextIdentityId(),
      employeeId: input.employeeId,
      fullName: input.fullName ?? input.employeeId,
      role: input.role,
      department: input.department ?? "UNSPECIFIED",
      status: input.status ?? "ACTIVE",
      createdAt: input.createdAt ?? new Date().toISOString(),
    };
    this.store.identities.set(identity.identityId, identity);

    const wallet: Wallet = {
      address: this.store.nextWalletAddress(),
      identityId: identity.identityId,
      deviceId: "PENDING",
      status: "PENDING",
      activatedAt: null,
      revokedAt: null,
      revokedReason: null,
    };
    this.store.wallets.set(wallet.address, wallet);
    const user: User = this.toUser(identity, wallet.address);
    this.store.users.set(identity.employeeId, user);

    await this.submit("IDENTITY_CREATE", identity, { identity });
    if (identity.role) await this.submit("ROLE_ASSIGN", identity, { identityId: identity.identityId, role: identity.role });
    return { identity: { ...identity }, user: { ...user } };
  }

  async registerDevice(userId: string, deviceId: string, credential = deviceId): Promise<Device> {
    if (!deviceId.trim() || !credential.trim()) throw new ValidationError(["deviceId and credential are required"]);
    const identity = this.requireIdentity(userId);
    const existing = this.store.devices.get(deviceId);
    if (existing && existing.identityId !== identity.identityId) throw new ConflictError(`Device ${deviceId} is already registered`);
    if (existing?.status === "ACTIVE") throw new ConflictError(`Device ${deviceId} is already active`);
    const device: Device = {
      deviceId,
      identityId: identity.identityId,
      status: "ACTIVE",
      registeredAt: existing?.registeredAt ?? new Date().toISOString(),
      revokedAt: null,
    };
    this.store.devices.set(deviceId, device);
    this.store.credentials.set(hashCredential(credential), deviceId);
    return { ...device };
  }

  async revokeDevice(deviceId: string): Promise<Device> {
    const device = this.store.devices.get(deviceId);
    if (!device) throw new NotFoundError(`No device ${deviceId}`);
    device.status = "REVOKED";
    device.revokedAt = new Date().toISOString();
    for (const [credential, boundDevice] of this.store.credentials) if (boundDevice === deviceId) this.store.credentials.delete(credential);
    for (const wallet of this.store.wallets.values()) {
      if (wallet.deviceId === deviceId && wallet.status === "ACTIVE") this.revokeWalletObject(wallet, "Device revoked");
    }
    return { ...device };
  }

  async registerWallet(userId: string, deviceId: string, address = this.store.nextWalletAddress()): Promise<Wallet> {
    const identity = this.requireIdentity(userId);
    this.requireActiveIdentity(identity);
    const device = this.store.devices.get(deviceId);
    if (!device || device.identityId !== identity.identityId || device.status !== "ACTIVE") throw new ForbiddenError("Device is not active for this identity");
    if (this.store.wallets.has(address)) throw new ConflictError(`Wallet ${address} already exists`);
    const wallet: Wallet = { address, identityId: identity.identityId, deviceId, status: "PENDING", activatedAt: null, revokedAt: null, revokedReason: null };
    this.store.wallets.set(address, wallet);
    return { ...wallet };
  }

  async revokeWallet(userId: string, reason: string): Promise<Wallet> {
    if (!reason.trim()) throw new ValidationError(["reason is required to revoke a wallet"]);
    const identity = this.requireIdentity(userId);
    const wallet = this.store.walletForIdentity(identity.identityId, "ACTIVE");
    if (!wallet) throw new NotFoundError(`No active wallet for ${identity.employeeId}`);
    this.revokeWalletObject(wallet, reason);
    await this.submit("WALLET_REVOKE", identity, { address: wallet.address, reason });
    return { ...wallet };
  }

  async activateWallet(userId: string, deviceId: string, address?: string): Promise<Wallet> {
    const identity = this.requireIdentity(userId);
    this.requireActiveIdentity(identity);
    const device = this.store.devices.get(deviceId);
    if (!device || device.identityId !== identity.identityId || device.status !== "ACTIVE") throw new ForbiddenError("Device is not active for this identity");
    const existing = address ? this.store.wallets.get(address) : undefined;
    if (existing && existing.identityId !== identity.identityId) throw new ForbiddenError("Wallet belongs to another identity");
    const wallet = existing ?? this.store.walletForIdentity(identity.identityId, "PENDING") ?? {
      address: address ?? this.store.nextWalletAddress(), identityId: identity.identityId, deviceId, status: "PENDING" as const, activatedAt: null, revokedAt: null, revokedReason: null,
    };
    for (const current of this.store.wallets.values()) if (current.identityId === identity.identityId && current.status === "ACTIVE") this.revokeWalletObject(current, "Replaced by wallet activation");
    wallet.deviceId = deviceId;
    wallet.status = "ACTIVE";
    wallet.activatedAt = new Date().toISOString();
    wallet.revokedAt = null;
    wallet.revokedReason = null;
    this.store.wallets.set(wallet.address, wallet);
    const user = this.store.userForIdentity(identity.identityId);
    if (user) user.walletAddress = wallet.address;
    await this.submit("WALLET_ACTIVATE", identity, { address: wallet.address, deviceId });
    return { ...wallet };
  }

  async assignRole(actorId: string, userId: string, role: Role): Promise<User> {
    if (!ROLES.includes(role)) throw new ValidationError(["role is invalid"]);
    const actor = this.requireIdentity(actorId);
    if (actor.role !== "ADMIN" || actor.status !== "ACTIVE") throw new ForbiddenError("Only an active admin may assign roles");
    const target = this.requireIdentity(userId);
    if (target.status === "REVOKED") throw new ForbiddenError("Revoked identities cannot receive roles");
    target.role = role;
    const user = this.store.userForIdentity(target.identityId);
    if (!user) throw new NotFoundError(`No user for ${target.employeeId}`);
    user.role = role;
    await this.submit("ROLE_ASSIGN", actor, { identityId: target.identityId, role });
    return { ...user };
  }

  async getById(id: string): Promise<User | null> {
    const user = this.store.users.get(id) ?? [...this.store.users.values()].find((item) => item.employeeId === id || item.identityId === id);
    return user ? { ...user } : null;
  }

  async getIdentity(id: string): Promise<Identity | null> {
    const identity = this.store.identityForUserId(id);
    return identity ? { ...identity } : null;
  }

  async listDevices(userId: string): Promise<Device[]> {
    const identity = this.requireIdentity(userId);
    return [...this.store.devices.values()].filter((device) => device.identityId === identity.identityId).map((device) => ({ ...device }));
  }

  async listWallets(userId: string): Promise<Wallet[]> {
    const identity = this.requireIdentity(userId);
    return [...this.store.wallets.values()].filter((wallet) => wallet.identityId === identity.identityId).map((wallet) => ({ ...wallet }));
  }

  async createGrant(actorId: string, targetId: string, input: { resourceType: "ASSET" | "JOB"; resourceId: string; action: Action; expiresAt?: string | null }): Promise<AuthorizationGrant> {
    const actor = this.requireIdentity(actorId);
    const target = this.requireIdentity(targetId);
    if (actor.status !== "ACTIVE" || target.status !== "ACTIVE") throw new ForbiddenError("Inactive identity cannot grant authorization");
    if (input.action !== "TRANSFER_ASSET") throw new ForbiddenError("Only AUTH actions may be granted");
    const grant: AuthorizationGrant = { authorizationGrantId: `GRANT-${randomUUID()}`, actorIdentityId: target.identityId, resourceType: input.resourceType, resourceId: input.resourceId, action: input.action, grantedByIdentityId: actor.identityId, issuedAt: new Date().toISOString(), expiresAt: input.expiresAt ?? null, status: "ACTIVE" };
    this.store.grants.set(grant.authorizationGrantId, grant);
    return { ...grant };
  }

  async listGrants(targetId: string): Promise<AuthorizationGrant[]> {
    const identity = this.requireIdentity(targetId);
    return [...this.store.grants.values()].filter((grant) => grant.actorIdentityId === identity.identityId).map((grant) => ({ ...grant }));
  }

  async revokeGrant(actorId: string, grantId: string): Promise<AuthorizationGrant> {
    const actor = this.requireIdentity(actorId);
    const grant = this.store.grants.get(grantId);
    if (!grant) throw new NotFoundError(`No grant ${grantId}`);
    if (grant.grantedByIdentityId !== actor.identityId && actor.role !== "ADMIN") throw new ForbiddenError("Only the grantor or admin may revoke a grant");
    grant.status = "REVOKED";
    return { ...grant };
  }

  validateGrant(grantId: string, actorId: string, resourceId: string, action: Action): boolean {
    const grant = this.store.grants.get(grantId);
    if (!grant || grant.status !== "ACTIVE" || grant.actorIdentityId !== actorId || grant.resourceId !== resourceId || grant.action !== action) return false;
    if (grant.expiresAt && Date.parse(grant.expiresAt) <= Date.now()) { grant.status = "EXPIRED"; return false; }
    return true;
  }

  private requireIdentity(id: string): Identity {
    const identity = this.store.identityForUserId(id);
    if (!identity) throw new NotFoundError(`No identity ${id}`);
    return identity;
  }

  private requireActiveIdentity(identity: Identity): void {
    if (identity.status !== "ACTIVE") throw new ForbiddenError(`Identity is ${identity.status}`);
  }

  private toUser(identity: Identity, walletAddress: string): User {
    return { employeeId: identity.employeeId, identityId: identity.identityId, walletAddress, role: identity.role, department: identity.department, status: identity.status };
  }

  private revokeWalletObject(wallet: Wallet, reason: string): void {
    wallet.status = "REVOKED";
    wallet.revokedAt = new Date().toISOString();
    wallet.revokedReason = reason;
    for (const [token, session] of this.store.sessions) if (session.identityId === wallet.identityId && session.deviceId === wallet.deviceId) this.store.sessions.delete(token);
  }

  private async submit(type: "IDENTITY_CREATE" | "ROLE_ASSIGN" | "WALLET_ACTIVATE" | "WALLET_REVOKE", identity: Identity, payload: Record<string, unknown>): Promise<void> {
    const result = await this.chain.submitTransaction({ txId: randomUUID(), type, actorIdentity: identity.identityId || SYSTEM_IDENTITY, actorWallet: this.store.userForIdentity(identity.identityId)?.walletAddress ?? SYSTEM_WALLET, payload, timestamp: new Date().toISOString(), signature: "development" });
    if (result.status !== "SUCCESS") throw new Error(`Blockchain rejected ${type}`);
  }
}
