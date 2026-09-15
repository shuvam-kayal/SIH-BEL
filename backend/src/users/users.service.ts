import { randomUUID } from "node:crypto";
import type { CreateUserResponse } from "../../../shared/api";
import type { AuthorizationGrant, Device, Identity, Role, User, Wallet } from "../../../shared/types";
import type { Action } from "../../../shared/rbac";
import { ROLES } from "../../../shared/enums";
import { BlockchainService } from "../adapters/BlockchainService";
import { commitState, type IntegrityAdapter } from "../integrity/integrity";
import { ForbiddenError, HttpError, NotFoundError, ValidationError } from "../errors";
import { hashCredential, identityStore, IdentityStore } from "./identity.store";
import { createMemoryRepositories } from "./repository-implementations";
import type { IdentityRepositories } from "./repositories";

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
  validateGrant(grantId: string, actorId: string, resourceId: string, action: Action): Promise<boolean>;
  listDevices(userId: string): Promise<Device[]>;
  listWallets(userId: string): Promise<Wallet[]>;
}

const SYSTEM_IDENTITY = "DID:BEL:SYSTEM";
const SYSTEM_WALLET = "SYSTEM";
class ConflictError extends HttpError { constructor(message: string) { super(409, message, "CONFLICT"); } }

export class UsersServiceImpl implements UsersService {
  private readonly repositories: IdentityRepositories;
  private readonly versions = new Map<string, number>();
  constructor(private readonly chain: BlockchainService, repositories?: IdentityRepositories | IdentityStore, private readonly integrity?: IntegrityAdapter) {
    this.repositories = repositories instanceof IdentityStore ? createMemoryRepositories(repositories) : repositories ?? createMemoryRepositories(identityStore);
  }

  async createUser(input: CreateIdentityInput): Promise<CreateUserResponse> {
    if (!input.employeeId || !ROLES.includes(input.role)) throw new ValidationError(["employeeId and a valid role are required"]);
    if (await this.repositories.identities.findByEmployeeId(input.employeeId)) throw new ConflictError(`Employee ${input.employeeId} already exists`);
    if (input.identityId && await this.repositories.identities.findById(input.identityId)) throw new ConflictError(`Identity ${input.identityId} already exists`);
    const identity: Identity = { identityId: input.identityId ?? `DID:BEL:${randomUUID()}`, employeeId: input.employeeId, fullName: input.fullName ?? input.employeeId, role: input.role, department: input.department ?? "UNSPECIFIED", status: input.status ?? "ACTIVE", createdAt: input.createdAt ?? new Date().toISOString() };
    await this.repositories.identities.save(identity);
    const wallet: Wallet = { address: `0xBEL${randomUUID().replaceAll("-", "").slice(0, 40)}`, identityId: identity.identityId, deviceId: "PENDING", status: "PENDING", activatedAt: null, revokedAt: null, revokedReason: null };
    await this.repositories.wallets.save(wallet);
    const user = this.toUser(identity, wallet.address);
    await this.repositories.users.save(user);
    await this.commit("IDENTITY", identity.identityId, "IDENTITY_CREATE", identity.identityId, { entityType: "IDENTITY", entityId: identity.identityId, status: identity.status, role: identity.role });
    await this.submit("IDENTITY_CREATE", identity, { identityId: identity.identityId, status: identity.status, role: identity.role });
    await this.commit("IDENTITY", identity.identityId, "ROLE_ASSIGN", identity.identityId, { entityType: "IDENTITY", entityId: identity.identityId, role: identity.role });
    await this.submit("ROLE_ASSIGN", identity, { identityId: identity.identityId, role: identity.role });
    return { identity: { ...identity }, user: { ...user } };
  }

  async registerDevice(userId: string, deviceId: string, credential = deviceId): Promise<Device> {
    if (!deviceId?.trim() || !credential?.trim()) throw new ValidationError(["deviceId and credential are required"]);
    const identity = this.requireIdentity(await this.resolveIdentity(userId));
    const existing = await this.repositories.devices.findById(deviceId);
    if (existing && existing.identityId !== identity.identityId) throw new ConflictError(`Device ${deviceId} is already registered`);
    if (existing?.status === "ACTIVE") throw new ConflictError(`Device ${deviceId} is already active`);
    const device: Device = { deviceId, identityId: identity.identityId, status: "ACTIVE", registeredAt: existing?.registeredAt ?? new Date().toISOString(), revokedAt: null };
    await this.repositories.devices.save(device);
    await this.repositories.credentials.save(hashCredential(credential), deviceId);
    await this.commit("DEVICE", deviceId, "DEVICE_REGISTER", identity.identityId, { entityType: "DEVICE", entityId: deviceId, identityId: identity.identityId, status: device.status });
    return { ...device };
  }

  async revokeDevice(deviceId: string): Promise<Device> {
    const device = await this.repositories.devices.findById(deviceId);
    if (!device) throw new NotFoundError(`No device ${deviceId}`);
    device.status = "REVOKED"; device.revokedAt = new Date().toISOString();
    await this.repositories.devices.save(device); await this.repositories.credentials.revokeForDevice(deviceId);
    for (const wallet of await this.repositories.wallets.listByIdentityId(device.identityId)) if (wallet.deviceId === deviceId && wallet.status === "ACTIVE") { wallet.status = "REVOKED"; wallet.revokedAt = new Date().toISOString(); wallet.revokedReason = "Device revoked"; await this.repositories.wallets.save(wallet); await this.commit("WALLET", wallet.address, "WALLET_REVOKE", device.identityId, { entityType: "WALLET", entityId: wallet.address, identityId: wallet.identityId, deviceId: wallet.deviceId, status: wallet.status, reason: wallet.revokedReason }); }
    await this.commit("DEVICE", deviceId, "DEVICE_REVOKE", device.identityId, { entityType: "DEVICE", entityId: deviceId, identityId: device.identityId, status: device.status });
    return { ...device };
  }

  async registerWallet(userId: string, deviceId: string, address = `0xBEL${randomUUID().replaceAll("-", "").slice(0, 40)}`): Promise<Wallet> {
    const identity = this.requireIdentity(await this.resolveIdentity(userId)); this.requireActiveIdentity(identity);
    const device = await this.repositories.devices.findById(deviceId);
    if (!device || device.identityId !== identity.identityId || device.status !== "ACTIVE") throw new ForbiddenError("Device is not active for this identity");
    if (await this.repositories.wallets.findByAddress(address)) throw new ConflictError(`Wallet ${address} already exists`);
    const wallet: Wallet = { address, identityId: identity.identityId, deviceId, status: "PENDING", activatedAt: null, revokedAt: null, revokedReason: null }; await this.repositories.wallets.save(wallet); return { ...wallet };
  }

  async revokeWallet(userId: string, reason: string): Promise<Wallet> {
    if (!reason.trim()) throw new ValidationError(["reason is required to revoke a wallet"]);
    const identity = this.requireIdentity(await this.resolveIdentity(userId));
    const wallet = (await this.repositories.wallets.listByIdentityId(identity.identityId)).find((item) => item.status === "ACTIVE");
    if (!wallet) throw new NotFoundError(`No active wallet for ${identity.employeeId}`);
    await this.revokeWalletObject(wallet, reason);
    await this.commit("WALLET", wallet.address, "WALLET_REVOKE", identity.identityId, { entityType: "WALLET", entityId: wallet.address, identityId: wallet.identityId, deviceId: wallet.deviceId, status: wallet.status, reason });
    await this.submit("WALLET_REVOKE", identity, { address: wallet.address, reason }); return { ...wallet };
  }

  async activateWallet(userId: string, deviceId: string, address?: string): Promise<Wallet> {
    const identity = this.requireIdentity(await this.resolveIdentity(userId)); this.requireActiveIdentity(identity);
    const device = await this.repositories.devices.findById(deviceId);
    if (!device || device.identityId !== identity.identityId || device.status !== "ACTIVE") throw new ForbiddenError("Device is not active for this identity");
    const existing = address ? await this.repositories.wallets.findByAddress(address) : null;
    if (existing && existing.identityId !== identity.identityId) throw new ForbiddenError("Wallet belongs to another identity");
    const wallet = existing ?? (await this.repositories.wallets.listByIdentityId(identity.identityId)).find((item) => item.status === "PENDING") ?? { address: address ?? `0xBEL${randomUUID().replaceAll("-", "").slice(0, 40)}`, identityId: identity.identityId, deviceId, status: "PENDING" as const, activatedAt: null, revokedAt: null, revokedReason: null };
    for (const current of await this.repositories.wallets.listByIdentityId(identity.identityId)) if (current.status === "ACTIVE" && current.address !== wallet.address) { await this.revokeWalletObject(current, "Replaced by wallet activation"); await this.commit("WALLET", current.address, "WALLET_REVOKE", identity.identityId, { entityType: "WALLET", entityId: current.address, identityId: current.identityId, deviceId: current.deviceId, status: current.status, reason: current.revokedReason }); }
    wallet.deviceId = deviceId; wallet.status = "ACTIVE"; wallet.activatedAt = new Date().toISOString(); wallet.revokedAt = null; wallet.revokedReason = null; await this.repositories.wallets.save(wallet);
    const user = await this.repositories.users.findByIdentityId(identity.identityId); if (user) { user.walletAddress = wallet.address; await this.repositories.users.save(user); }
    await this.commit("WALLET", wallet.address, "WALLET_ACTIVATE", identity.identityId, { entityType: "WALLET", entityId: wallet.address, identityId: wallet.identityId, deviceId: wallet.deviceId, status: wallet.status });
    await this.submit("WALLET_ACTIVATE", identity, { address: wallet.address, deviceId }); return { ...wallet };
  }

  async assignRole(actorId: string, userId: string, role: Role): Promise<User> {
    if (!ROLES.includes(role)) throw new ValidationError(["role is invalid"]);
    const actor = this.requireIdentity(await this.resolveIdentity(actorId)); if (actor.role !== "ADMIN" || actor.status !== "ACTIVE") throw new ForbiddenError("Only an active admin may assign roles");
    const target = this.requireIdentity(await this.resolveIdentity(userId)); if (target.status === "REVOKED") throw new ForbiddenError("Revoked identities cannot receive roles"); target.role = role; await this.repositories.identities.save(target);
    const user = await this.repositories.users.findByIdentityId(target.identityId); if (!user) throw new NotFoundError(`No user for ${target.employeeId}`); user.role = role; await this.repositories.users.save(user);
    await this.commit("IDENTITY", target.identityId, "ROLE_ASSIGN", actor.identityId, { entityType: "IDENTITY", entityId: target.identityId, role: target.role }); await this.submit("ROLE_ASSIGN", actor, { identityId: target.identityId, role }); return { ...user };
  }

  async getById(id: string): Promise<User | null> { const direct = await this.repositories.users.findById(id); if (direct) return { ...direct }; const identity = await this.resolveIdentity(id); const user = identity ? await this.repositories.users.findByIdentityId(identity.identityId) : null; return user ? { ...user } : null; }
  async getIdentity(id: string): Promise<Identity | null> { return this.resolveIdentity(id); }
  async listDevices(userId: string) { const identity = this.requireIdentity(await this.resolveIdentity(userId)); return this.repositories.devices.listByIdentityId(identity.identityId); }
  async listWallets(userId: string) { const identity = this.requireIdentity(await this.resolveIdentity(userId)); return this.repositories.wallets.listByIdentityId(identity.identityId); }

  async createGrant(actorId: string, targetId: string, input: { resourceType: "ASSET" | "JOB"; resourceId: string; action: Action; expiresAt?: string | null }): Promise<AuthorizationGrant> {
    const actor = this.requireIdentity(await this.resolveIdentity(actorId)); const target = this.requireIdentity(await this.resolveIdentity(targetId)); if (actor.status !== "ACTIVE" || target.status !== "ACTIVE") throw new ForbiddenError("Inactive identity cannot grant authorization"); if (actor.role !== "ADMIN") throw new ForbiddenError("Only an admin may create an authorization grant"); if (input.action !== "TRANSFER_ASSET") throw new ForbiddenError("Only AUTH actions may be granted");
    const grant: AuthorizationGrant = { authorizationGrantId: `GRANT-${randomUUID()}`, actorIdentityId: target.identityId, resourceType: input.resourceType, resourceId: input.resourceId, action: input.action, grantedByIdentityId: actor.identityId, issuedAt: new Date().toISOString(), expiresAt: input.expiresAt ?? null, status: "ACTIVE" }; await this.repositories.grants.save(grant);
    await this.commit("GRANT", grant.authorizationGrantId, "GRANT_CREATE", actor.identityId, { entityType: "GRANT", entityId: grant.authorizationGrantId, actorIdentityId: grant.actorIdentityId, resourceType: grant.resourceType, resourceId: grant.resourceId, action: grant.action, grantedByIdentityId: grant.grantedByIdentityId, status: grant.status, expiresAt: grant.expiresAt }); return { ...grant };
  }
  async listGrants(targetId: string) { const identity = this.requireIdentity(await this.resolveIdentity(targetId)); return this.repositories.grants.listByIdentityId(identity.identityId); }
  async revokeGrant(actorId: string, grantId: string): Promise<AuthorizationGrant> { const actor = this.requireIdentity(await this.resolveIdentity(actorId)); const grant = await this.repositories.grants.findById(grantId); if (!grant) throw new NotFoundError(`No grant ${grantId}`); if (grant.grantedByIdentityId !== actor.identityId && actor.role !== "ADMIN") throw new ForbiddenError("Only the grantor or admin may revoke a grant"); grant.status = "REVOKED"; await this.repositories.grants.save(grant); await this.commit("GRANT", grant.authorizationGrantId, "GRANT_REVOKE", actor.identityId, { entityType: "GRANT", entityId: grant.authorizationGrantId, actorIdentityId: grant.actorIdentityId, resourceType: grant.resourceType, resourceId: grant.resourceId, action: grant.action, grantedByIdentityId: grant.grantedByIdentityId, status: grant.status, expiresAt: grant.expiresAt }); return { ...grant }; }
  async validateGrant(grantId: string, actorId: string, resourceId: string, action: Action): Promise<boolean> { const grant = await this.repositories.grants.findById(grantId); if (!grant || grant.status !== "ACTIVE" || grant.actorIdentityId !== actorId || grant.resourceId !== resourceId || grant.action !== action) return false; if (grant.expiresAt && Date.parse(grant.expiresAt) <= Date.now()) { grant.status = "EXPIRED"; await this.repositories.grants.save(grant); return false; } return true; }

  private async resolveIdentity(id: string): Promise<Identity | null> { return (await this.repositories.identities.findById(id)) ?? this.repositories.identities.findByEmployeeId(id); }
  private requireIdentity(identity: Identity | null): Identity { if (!identity) throw new NotFoundError("No identity"); return identity; }
  private requireActiveIdentity(identity: Identity): void { if (identity.status !== "ACTIVE") throw new ForbiddenError(`Identity is ${identity.status}`); }
  private toUser(identity: Identity, walletAddress: string): User { return { employeeId: identity.employeeId, identityId: identity.identityId, walletAddress, role: identity.role, department: identity.department, status: identity.status }; }
  private async revokeWalletObject(wallet: Wallet, reason: string): Promise<void> { wallet.status = "REVOKED"; wallet.revokedAt = new Date().toISOString(); wallet.revokedReason = reason; await this.repositories.wallets.save(wallet); }
  private async commit(entityType: "IDENTITY" | "DEVICE" | "WALLET" | "GRANT", entityId: string, eventType: string, actorIdentityId: string, state: Record<string, unknown>): Promise<void> { if (!this.integrity) return; const version = (this.versions.get(entityId) ?? 0) + 1; this.versions.set(entityId, version); await commitState(this.integrity, { entityType, entityId, eventType, version, actorIdentityId, state }); }
  private async submit(type: "IDENTITY_CREATE" | "ROLE_ASSIGN" | "WALLET_ACTIVATE" | "WALLET_REVOKE", identity: Identity, payload: Record<string, unknown>): Promise<void> { const user = await this.repositories.users.findByIdentityId(identity.identityId); const result = await this.chain.submitTransaction({ txId: randomUUID(), type, actorIdentity: identity.identityId || SYSTEM_IDENTITY, actorWallet: user?.walletAddress ?? SYSTEM_WALLET, payload, timestamp: new Date().toISOString(), signature: "development" }); if (result.status !== "SUCCESS") throw new Error(`Blockchain rejected ${type}`); }
}
