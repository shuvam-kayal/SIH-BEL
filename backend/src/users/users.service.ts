import { createPublicKey, randomBytes, randomUUID, verify } from "node:crypto";
import type { CreateUserResponse, InitializeAccountRequest, PendingRegistration, ProvisioningChallengeRequest } from "../../../shared/api";
import type { AuthorizationGrant, Device, Identity, PendingIdentity, ProvisioningChallenge, Role, User, Wallet } from "../../../shared/types";
import type { Action } from "../../../shared/rbac";
import { ROLES } from "../../../shared/enums";
import { BlockchainService } from "../adapters/BlockchainService";
import { commitState, type IntegrityAdapter } from "../integrity/integrity";
import { ForbiddenError, HttpError, NotFoundError, ValidationError } from "../errors";
import { hashCredential } from "./identity.store";
import type { IdentityRepositories } from "./repositories";
import { RejectingDeviceAttestationAdapter, type DeviceAttestationAdapter, type DeviceAttestationResult } from "../devices/device-attestation";
import { assertWalletMatchesPublicKey, publicKeyToEvmAddress, verifyCompactSignature } from "../blockchain/crypto";
import { BlockchainError } from "../blockchain/errors";

export type CreateIdentityInput = Omit<Partial<Identity>, "employeeId" | "role"> & { employeeId: string; role: Role };
export interface UsersService {
  createUser(input: CreateIdentityInput, actorId?: string): Promise<CreateUserResponse>;
  registerDevice(userId: string, deviceId: string, credential?: string, publicKey?: string): Promise<Device>;
  revokeDevice(deviceId: string, actorId?: string): Promise<Device>;
  registerWallet(userId: string, deviceId: string, address: string): Promise<Wallet>;
  revokeWallet(userId: string, reason: string, actorId?: string): Promise<Wallet>;
  activateWallet(userId: string, deviceId: string, address: string, actorId?: string): Promise<Wallet>;
  assignRole(actorId: string, userId: string, role: Role): Promise<User>;
  getById(id: string): Promise<User | null>;
  getIdentity(id: string): Promise<Identity | null>;
  createGrant(actorId: string, targetId: string, input: { resourceType: "ASSET" | "JOB"; resourceId: string; action: Action; expiresAt?: string | null }): Promise<AuthorizationGrant>;
  listGrants(targetId: string): Promise<AuthorizationGrant[]>;
  revokeGrant(actorId: string, grantId: string): Promise<AuthorizationGrant>;
  validateGrant(grantId: string, actorId: string, resourceId: string, action: Action): Promise<boolean>;
  listDevices(userId: string): Promise<Device[]>;
  listWallets(userId: string): Promise<Wallet[]>;
  requestProvisioningChallenge(input: ProvisioningChallengeRequest): Promise<ProvisioningChallenge>;
  initializeAccount(input: InitializeAccountRequest): Promise<PendingRegistration>;
  listPendingRegistrations(): Promise<PendingRegistration[]>;
  verifyRegistration(actorId: string, userId: string, input: { employeeId: string; department: string }): Promise<Identity>;
  activateRegistration(actorId: string, userId: string): Promise<PendingRegistration>;
}

const SYSTEM_IDENTITY = "DID:BEL:SYSTEM";
const SYSTEM_WALLET = "SYSTEM";
class ConflictError extends HttpError { constructor(message: string) { super(409, message, "CONFLICT"); } }

export class UsersServiceImpl implements UsersService {
  private readonly repositories: IdentityRepositories;
  private readonly versions = new Map<string, number>();
  constructor(private readonly chain: BlockchainService, repositories: IdentityRepositories, private readonly integrity?: IntegrityAdapter, attestation?: DeviceAttestationAdapter) { this.repositories = repositories; this.attestation = attestation ?? new RejectingDeviceAttestationAdapter(); }
  private readonly attestation: DeviceAttestationAdapter;

  async createUser(input: CreateIdentityInput, actorId?: string): Promise<CreateUserResponse> {
    if (!input.employeeId || !ROLES.includes(input.role)) throw new ValidationError(["employeeId and a valid role are required"]);
    if (await this.repositories.identities.findByEmployeeId(input.employeeId)) throw new ConflictError(`Employee ${input.employeeId} already exists`);
    if (input.identityId && await this.repositories.identities.findById(input.identityId)) throw new ConflictError(`Identity ${input.identityId} already exists`);
    const identity: Identity = { identityId: input.identityId ?? `DID:BEL:${randomUUID()}`, employeeId: input.employeeId, fullName: input.fullName ?? input.employeeId, role: input.role, department: input.department ?? "UNSPECIFIED", status: input.status ?? "ACTIVE", createdAt: input.createdAt ?? new Date().toISOString() };
    const onChainIdentity = this.evmCryptoEnabled() ? await this.chain.getIdentity(identity.identityId) : null;
    if (this.evmCryptoEnabled() && !onChainIdentity) {
      throw new ConflictError("Legacy user creation cannot create an EVM identity without a registered wallet; use account initialization and administrator activation");
    }
    if (onChainIdentity && onChainIdentity.role !== identity.role) {
      const actor = this.requireIdentity(await this.resolveIdentity(actorId ?? identity.identityId));
      await this.submit("ROLE_ASSIGN", actor, { identityId: identity.identityId, role: identity.role });
    }
    await this.repositories.identities.save(identity);
    const user = this.toUser(identity, "");
    await this.repositories.users.save(user);
    await this.commit("IDENTITY", identity.identityId, "IDENTITY_CREATE", identity.identityId, { entityType: "IDENTITY", entityId: identity.identityId, status: identity.status, role: identity.role });
    await this.commit("IDENTITY", identity.identityId, "ROLE_ASSIGN", identity.identityId, { entityType: "IDENTITY", entityId: identity.identityId, role: identity.role });
    if (!onChainIdentity) {
      await this.submit("IDENTITY_CREATE", identity, { identityId: identity.identityId, status: identity.status, role: identity.role });
      await this.submit("ROLE_ASSIGN", identity, { identityId: identity.identityId, role: identity.role });
    }
    return { identity: { ...identity }, user: { ...user } };
  }

  async requestProvisioningChallenge(input: ProvisioningChallengeRequest): Promise<ProvisioningChallenge> {
    if (!input?.deviceId?.trim()) throw new ValidationError(["deviceId is required"]);
    if (!input.deviceMetadata || typeof input.deviceMetadata !== "object") throw new ValidationError(["deviceMetadata is required"]);
    const attestation = await this.attestDevice(input.deviceId, input.deviceMetadata);
    this.requireAttestation(attestation);
    const now = Date.now();
    const challenge: ProvisioningChallenge = {
      challengeId: randomUUID(),
      deviceId: input.deviceId,
      challenge: randomBytes(32).toString("base64url"),
      purpose: "WALLET_INITIALIZATION",
      expiresAt: new Date(now + 5 * 60 * 1000).toISOString(),
      usedAt: null,
      metadata: { attestation: attestation.evidence ?? {}, managedDevice: attestation.managedDevice, networkApproved: attestation.networkApproved },
    };
    await this.repositories.challenges.save(challenge);
    return { ...challenge, metadata: challenge.metadata ? { ...challenge.metadata } : null };
  }

  async initializeAccount(input: InitializeAccountRequest): Promise<PendingRegistration> {
    if (Object.prototype.hasOwnProperty.call(input as object, "privateKey")) throw new ValidationError(["privateKey must never be submitted"]);
    const errors: string[] = [];
    if (typeof input?.fullName !== "string" || !input.fullName.trim()) errors.push("fullName is required");
    if (typeof input?.deviceId !== "string" || !input.deviceId.trim()) errors.push("deviceId is required");
    if (typeof input?.publicKey !== "string" || !input.publicKey.trim()) errors.push("publicKey is required");
    if (typeof input?.walletAddress !== "string" || !input.walletAddress.trim()) errors.push("walletAddress is required");
    if (typeof input?.challengeId !== "string" || !input.challengeId.trim()) errors.push("challengeId is required");
    if (typeof input?.signature !== "string" || !input.signature.trim()) errors.push("signature is required");
    if (!input?.deviceMetadata || typeof input.deviceMetadata !== "object") errors.push("deviceMetadata is required");
    if (errors.length) throw new ValidationError(errors);
    this.validateEvmWalletBinding(input.walletAddress, input.publicKey);
    const attestation = await this.attestDevice(input.deviceId, input.deviceMetadata);
    this.requireAttestation(attestation);

    const challenge = await this.repositories.challenges.findById(input.challengeId);
    if (!challenge || challenge.purpose !== "WALLET_INITIALIZATION") throw new ValidationError(["challenge is invalid"]);
    if (challenge.usedAt) throw new ConflictError("challenge has already been used");
    if (Date.parse(challenge.expiresAt) <= Date.now()) throw new ValidationError(["challenge has expired"]);
    if (challenge.deviceId !== input.deviceId) throw new ValidationError(["challenge is bound to another device"]);
    if (!this.verifyProvisioningProof(challenge.challenge, input.publicKey, input.signature)) throw new ForbiddenError("Invalid provisioning proof");
    if (await this.repositories.wallets.findByAddress(input.walletAddress)) throw new ConflictError("Wallet address is already registered");
    const existingDevice = await this.repositories.devices.findById(input.deviceId);
    if (existingDevice) throw new ConflictError("Device is already registered");
    if (input.employeeId) {
      const existingIdentity = await this.repositories.identities.findByEmployeeId(input.employeeId);
      if (existingIdentity) throw new ConflictError("Employee is already registered");
    }

    const identity = {
      identityId: `DID:BEL:${randomUUID()}`,
      employeeId: input.employeeId?.trim() || null,
      fullName: input.fullName.trim(),
      role: null,
      department: input.department?.trim() || null,
      status: "PENDING",
      createdAt: new Date().toISOString(),
      verifiedAt: null,
      verifiedBy: null,
    } as unknown as PendingIdentity;
    const device: Device = {
      deviceId: input.deviceId.trim(), identityId: identity.identityId, status: "PENDING",
      registeredAt: identity.createdAt, activatedAt: null, revokedAt: null,
      publicKey: input.publicKey, metadata: { attestation: attestation.evidence ?? {}, managedDevice: attestation.managedDevice, networkApproved: attestation.networkApproved },
    };
    const wallet: Wallet = {
      address: input.walletAddress.trim(), identityId: identity.identityId, deviceId: device.deviceId,
      status: "PENDING", activatedAt: null, revokedAt: null, revokedReason: null, publicKey: input.publicKey,
    };
    await this.repositories.identities.save(identity as unknown as Identity);
    await this.repositories.devices.save(device);
    await this.repositories.wallets.save(wallet);
    challenge.usedAt = new Date().toISOString();
    await this.repositories.challenges.save(challenge);
    await this.commit("IDENTITY", identity.identityId, "ACCOUNT_INITIALIZATION", identity.identityId, { entityType: "IDENTITY", entityId: identity.identityId, status: identity.status, fullName: identity.fullName });
    await this.commit("DEVICE", device.deviceId, "DEVICE_REGISTER", identity.identityId, { entityType: "DEVICE", entityId: device.deviceId, identityId: identity.identityId, status: device.status, publicKey: device.publicKey });
    await this.commit("WALLET", wallet.address, "WALLET_REGISTER", identity.identityId, { entityType: "WALLET", entityId: wallet.address, identityId: identity.identityId, deviceId: wallet.deviceId, status: wallet.status, publicKey: wallet.publicKey });
    return { identity: { ...identity }, device: { ...device, metadata: device.metadata ? { ...device.metadata } : null }, wallet: { ...wallet } };
  }

  async listPendingRegistrations(): Promise<PendingRegistration[]> {
    const identities = await this.repositories.identities.listByStatus("PENDING");
    const result: PendingRegistration[] = [];
    for (const identity of identities) {
      const device = (await this.repositories.devices.listByIdentityId(identity.identityId)).find((item) => item.status === "PENDING");
      const wallet = (await this.repositories.wallets.listByIdentityId(identity.identityId)).find((item) => item.status === "PENDING");
      if (device && wallet) result.push({ identity: identity as unknown as PendingIdentity, device, wallet });
    }
    return result;
  }

  async verifyRegistration(actorId: string, userId: string, input: { employeeId: string; department: string }): Promise<Identity> {
    const actor = this.requireIdentity(await this.resolveIdentity(actorId));
    if (actor.status !== "ACTIVE" || actor.role !== "ADMIN") throw new ForbiddenError("Only an active admin may verify registrations");
    if (!input?.employeeId?.trim() || !input?.department?.trim()) throw new ValidationError(["employeeId and department are required"]);
    const target = this.requireIdentity(await this.resolveIdentity(userId));
    if (target.status !== "PENDING") throw new ConflictError("Only pending registrations can be verified");
    const existing = await this.repositories.identities.findByEmployeeId(input.employeeId);
    if (existing && existing.identityId !== target.identityId) throw new ConflictError("Employee is already registered");
    target.employeeId = input.employeeId.trim(); target.department = input.department.trim(); target.verifiedAt = new Date().toISOString(); target.verifiedBy = actor.identityId;
    await this.repositories.identities.save(target);
    await this.commit("IDENTITY", target.identityId, "ADMIN_VERIFY", actor.identityId, { entityType: "IDENTITY", entityId: target.identityId, employeeId: target.employeeId, department: target.department, status: target.status });
    return { ...target };
  }

  async activateRegistration(actorId: string, userId: string): Promise<PendingRegistration> {
    const actor = this.requireIdentity(await this.resolveIdentity(actorId));
    if (actor.status !== "ACTIVE" || actor.role !== "ADMIN") throw new ForbiddenError("Only an active admin may activate registrations");
    const identity = this.requireIdentity(await this.resolveIdentity(userId));
    if (identity.status !== "PENDING" || !identity.employeeId || !identity.department || !identity.role) throw new ConflictError("Registration must be verified and assigned a role before activation");
    const device = (await this.repositories.devices.listByIdentityId(identity.identityId)).find((item) => item.status === "PENDING");
    const wallet = (await this.repositories.wallets.listByIdentityId(identity.identityId)).find((item) => item.status === "PENDING");
    if (!device || !wallet) throw new ConflictError("Pending device and wallet are required");
    // The chain owns the activation transition. Keep all PostgreSQL records
    // pending until the complete on-chain sequence has been confirmed.
    await this.ensureIdentityCreated(actor, identity, wallet.address);
    await this.ensureRoleAssigned(actor, identity, wallet.address);
    await this.ensureWalletActive(actor, wallet.address, device.deviceId, identity.identityId);

    const now = new Date().toISOString();
    identity.status = "ACTIVE"; await this.repositories.identities.save(identity);
    device.status = "ACTIVE"; device.activatedAt = now; await this.repositories.devices.save(device);
    wallet.status = "ACTIVE"; wallet.activatedAt = now; await this.repositories.wallets.save(wallet);
    await this.repositories.users.save(this.toUser(identity, wallet.address));
    await this.commit("IDENTITY", identity.identityId, "ROLE_ASSIGN", actor.identityId, { entityType: "IDENTITY", entityId: identity.identityId, role: identity.role });
    await this.commit("DEVICE", device.deviceId, "DEVICE_REGISTER", actor.identityId, { entityType: "DEVICE", entityId: device.deviceId, status: device.status });
    await this.commit("WALLET", wallet.address, "WALLET_ACTIVATE", actor.identityId, { entityType: "WALLET", entityId: wallet.address, status: wallet.status });
    return { identity: { ...identity }, device: { ...device }, wallet: { ...wallet } };
  }

  async registerDevice(userId: string, deviceId: string, credential = deviceId, publicKey?: string): Promise<Device> {
    if (!deviceId?.trim() || !credential?.trim()) throw new ValidationError(["deviceId and credential are required"]);
    if (this.evmCryptoEnabled() && !publicKey) throw new ValidationError(["publicKey is required for EVM wallet registration"]);
    if (this.evmCryptoEnabled() && publicKey) {
      try { publicKeyToEvmAddress(publicKey); } catch { throw new ValidationError(["publicKey must be exactly the canonical 64-byte secp256k1 X || Y representation"]); }
    }
    const identity = this.requireIdentity(await this.resolveIdentity(userId));
    const existing = await this.repositories.devices.findById(deviceId);
    if (existing && existing.identityId !== identity.identityId) throw new ConflictError(`Device ${deviceId} is already registered`);
    if (existing?.status === "ACTIVE") throw new ConflictError(`Device ${deviceId} is already active`);
    const device: Device = { deviceId, identityId: identity.identityId, status: "ACTIVE", registeredAt: existing?.registeredAt ?? new Date().toISOString(), activatedAt: new Date().toISOString(), revokedAt: null, publicKey: publicKey ?? existing?.publicKey ?? null };
    await this.repositories.devices.save(device);
    await this.repositories.credentials.save(hashCredential(credential), deviceId);
    await this.commit("DEVICE", deviceId, "DEVICE_REGISTER", identity.identityId, { entityType: "DEVICE", entityId: deviceId, identityId: identity.identityId, status: device.status });
    return { ...device };
  }

  async revokeDevice(deviceId: string, actorId?: string): Promise<Device> {
    const device = await this.repositories.devices.findById(deviceId);
    if (!device) throw new NotFoundError(`No device ${deviceId}`);
    const wasRevoked = device.status === "REVOKED";
    const actor = this.requireIdentity(await this.resolveIdentity(actorId ?? device.identityId));
    const wallets = (await this.repositories.wallets.listByIdentityId(device.identityId)).filter((wallet) => wallet.deviceId === deviceId && wallet.status === "ACTIVE");

    // Confirm every required chain transition before changing any local
    // lifecycle state. This prevents PostgreSQL REVOKED / chain ACTIVE.
    for (const wallet of wallets) {
      await this.ensureWalletRevoked(actor, wallet.address, "Device revoked");
    }

    const now = new Date().toISOString();
    if (!wasRevoked) {
      device.status = "REVOKED"; device.revokedAt = now;
      await this.repositories.devices.save(device);
    }
    await this.repositories.credentials.revokeForDevice(deviceId);
    for (const wallet of wallets) { wallet.status = "REVOKED"; wallet.revokedAt = now; wallet.revokedReason = "Device revoked"; await this.repositories.wallets.save(wallet); await this.commit("WALLET", wallet.address, "WALLET_REVOKE", device.identityId, { entityType: "WALLET", entityId: wallet.address, identityId: wallet.identityId, deviceId: wallet.deviceId, status: wallet.status, reason: wallet.revokedReason }); }
    if (!wasRevoked) await this.commit("DEVICE", deviceId, "DEVICE_REVOKE", device.identityId, { entityType: "DEVICE", entityId: deviceId, identityId: device.identityId, status: device.status });
    return { ...device };
  }

  async registerWallet(userId: string, deviceId: string, address: string): Promise<Wallet> {
    if (!address?.trim()) throw new ValidationError(["device-generated walletAddress is required"]);
    const identity = this.requireIdentity(await this.resolveIdentity(userId)); this.requireActiveIdentity(identity);
    const device = await this.repositories.devices.findById(deviceId);
    if (!device || device.identityId !== identity.identityId || device.status !== "ACTIVE") throw new ForbiddenError("Device is not active for this identity");
    if (!device.publicKey) throw new ForbiddenError("A device-generated public key is required to register a wallet");
    this.validateEvmWalletBinding(address, device.publicKey);
    if (await this.repositories.wallets.findByAddress(address)) throw new ConflictError(`Wallet ${address} already exists`);
    const wallet: Wallet = { address: address.trim(), identityId: identity.identityId, deviceId, status: "PENDING", activatedAt: null, revokedAt: null, revokedReason: null, publicKey: device.publicKey ?? null }; await this.repositories.wallets.save(wallet); return { ...wallet };
  }

  async revokeWallet(userId: string, reason: string, actorId = userId): Promise<Wallet> {
    if (!reason.trim()) throw new ValidationError(["reason is required to revoke a wallet"]);
    const identity = this.requireIdentity(await this.resolveIdentity(userId));
    const wallet = (await this.repositories.wallets.listByIdentityId(identity.identityId)).find((item) => item.status === "ACTIVE");
    if (!wallet) throw new NotFoundError(`No active wallet for ${identity.employeeId}`);
    const actor = this.requireIdentity(await this.resolveIdentity(actorId));
    await this.submit("WALLET_REVOKE", actor, { address: wallet.address, reason });
    await this.revokeWalletObject(wallet, reason);
    await this.commit("WALLET", wallet.address, "WALLET_REVOKE", identity.identityId, { entityType: "WALLET", entityId: wallet.address, identityId: wallet.identityId, deviceId: wallet.deviceId, status: wallet.status, reason });
    return { ...wallet };
  }

  async activateWallet(userId: string, deviceId: string, address: string, actorId = userId): Promise<Wallet> {
    if (!address?.trim()) throw new ValidationError(["device-generated walletAddress is required"]);
    const identity = this.requireIdentity(await this.resolveIdentity(userId)); this.requireActiveIdentity(identity);
    const device = await this.repositories.devices.findById(deviceId);
    if (!device || device.identityId !== identity.identityId || device.status !== "ACTIVE") throw new ForbiddenError("Device is not active for this identity");
    const existing = await this.repositories.wallets.findByAddress(address.trim());
    if (existing && existing.identityId !== identity.identityId) throw new ForbiddenError("Wallet belongs to another identity");
    if (!existing || existing.identityId !== identity.identityId || existing.deviceId !== deviceId || existing.status !== "PENDING") throw new NotFoundError("No pending wallet registered for this device and public address");
    if (!existing.publicKey) throw new ForbiddenError("A device-generated public key is required to activate a wallet");
    this.validateEvmWalletBinding(address, existing.publicKey);
    const wallet = existing;
    const actor = this.requireIdentity(await this.resolveIdentity(actorId));
    for (const current of await this.repositories.wallets.listByIdentityId(identity.identityId)) if (current.status === "ACTIVE" && current.address !== wallet.address) {
      await this.submit("WALLET_REVOKE", actor, { address: current.address, reason: "Replaced by wallet activation" });
      await this.revokeWalletObject(current, "Replaced by wallet activation");
      await this.commit("WALLET", current.address, "WALLET_REVOKE", actor.identityId, { entityType: "WALLET", entityId: current.address, identityId: current.identityId, deviceId: current.deviceId, status: current.status, reason: current.revokedReason });
    }
    // A replacement is a new on-chain registration for the same DID.
    await this.ensureIdentityCreated(actor, identity, wallet.address);
    await this.ensureWalletActive(actor, wallet.address, deviceId, identity.identityId);
    wallet.deviceId = deviceId; wallet.status = "ACTIVE"; wallet.activatedAt = new Date().toISOString(); wallet.revokedAt = null; wallet.revokedReason = null; await this.repositories.wallets.save(wallet);
    const user = await this.repositories.users.findByIdentityId(identity.identityId); if (user) { user.walletAddress = wallet.address; await this.repositories.users.save(user); }
    await this.commit("WALLET", wallet.address, "WALLET_ACTIVATE", identity.identityId, { entityType: "WALLET", entityId: wallet.address, identityId: wallet.identityId, deviceId: wallet.deviceId, status: wallet.status });
    return { ...wallet };
  }

  async assignRole(actorId: string, userId: string, role: Role): Promise<User> {
    if (!ROLES.includes(role)) throw new ValidationError(["role is invalid"]);
    const actor = this.requireIdentity(await this.resolveIdentity(actorId)); if (actor.role !== "ADMIN" || actor.status !== "ACTIVE") throw new ForbiddenError("Only an active admin may assign roles");
    const target = this.requireIdentity(await this.resolveIdentity(userId)); if (target.status === "REVOKED") throw new ForbiddenError("Revoked identities cannot receive roles");
    const user = await this.repositories.users.findByIdentityId(target.identityId);
    if (!user) {
      if (target.status !== "PENDING") throw new NotFoundError(`No user for ${target.employeeId}`);
      target.role = role; await this.repositories.identities.save(target);
      // Pending identities are assigned on-chain during activation, after
      // IDENTITY_CREATE has made the DID resolvable by RoleRegistry.
      await this.commit("IDENTITY", target.identityId, "ROLE_ASSIGN", actor.identityId, { entityType: "IDENTITY", entityId: target.identityId, role: target.role });
      return this.toUser(target, "");
    }
    await this.submit("ROLE_ASSIGN", actor, { identityId: target.identityId, role });
    target.role = role; await this.repositories.identities.save(target);
    user.role = role; await this.repositories.users.save(user);
    await this.commit("IDENTITY", target.identityId, "ROLE_ASSIGN", actor.identityId, { entityType: "IDENTITY", entityId: target.identityId, role: target.role }); return { ...user };
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
  private toUser(identity: Identity, walletAddress: string): User { return { employeeId: identity.employeeId ?? "", identityId: identity.identityId, walletAddress, role: identity.role ?? "ENGINEER", department: identity.department ?? "UNSPECIFIED", status: identity.status }; }
  private async attestDevice(deviceId: string, metadata: Record<string, unknown>): Promise<DeviceAttestationResult> {
    const sensitiveKey = (key: string): boolean => /private.?key|secret.?key|mnemonic|seed(?:.?phrase)?|backup/i.test(key);
    const containsSensitiveKey = (value: unknown, seen = new Set<object>()): boolean => {
      if (!value || typeof value !== "object") return false;
      if (seen.has(value)) return false;
      seen.add(value);
      return Object.entries(value as Record<string, unknown>).some(([key, child]) => sensitiveKey(key) || containsSensitiveKey(child, seen));
    };
    if (containsSensitiveKey(metadata)) throw new ValidationError(["private-key material is not accepted"]);
    return this.attestation.attest({ deviceId, metadata });
  }
  private requireAttestation(result: DeviceAttestationResult): void {
    if (!result.verified || !result.managedDevice || !result.networkApproved) throw new ForbiddenError("Device attestation was not approved");
  }
  private verifyProvisioningProof(challenge: string, publicKey: string, signature: string): boolean {
    if (this.evmCryptoEnabled()) return verifyCompactSignature(challenge, publicKey, signature);
    try {
      const key = publicKey.includes("BEGIN")
        ? createPublicKey(publicKey)
        : createPublicKey({ key: Buffer.from(publicKey, "base64"), format: "der", type: "spki" });
      const normalized = /^[0-9a-f]+$/i.test(signature) ? Buffer.from(signature, "hex") : Buffer.from(signature, "base64url");
      return verify(null, Buffer.from(challenge), key, normalized) || verify("sha256", Buffer.from(challenge), key, normalized);
    } catch {
      return false;
    }
  }
  private evmCryptoEnabled(): boolean { return (process.env.BEL_BLOCKCHAIN ?? "mock").trim().toLowerCase() === "evm"; }
  private validateEvmWalletBinding(address: string, publicKey: string): void {
    if (!this.evmCryptoEnabled()) return;
    try { assertWalletMatchesPublicKey(address, publicKey); }
    catch { throw new ValidationError(["walletAddress must be the EVM address derived from the canonical 64-byte public key"]); }
  }
  private async revokeWalletObject(wallet: Wallet, reason: string): Promise<void> { wallet.status = "REVOKED"; wallet.revokedAt = new Date().toISOString(); wallet.revokedReason = reason; await this.repositories.wallets.save(wallet); }
  private async ensureIdentityCreated(actor: Identity, identity: Identity, walletAddress: string): Promise<void> {
    if (this.evmCryptoEnabled() && await this.chain.getWallet(walletAddress)) return;
    await this.submit("IDENTITY_CREATE", actor, { walletAddress, identityId: identity.identityId });
  }
  private async ensureRoleAssigned(actor: Identity, identity: Identity, walletAddress: string): Promise<void> {
    if (this.evmCryptoEnabled()) {
      const onChain = await this.chain.getIdentity(identity.identityId);
      if (onChain?.role === identity.role) return;
    }
    await this.submit("ROLE_ASSIGN", actor, { walletAddress, identityId: identity.identityId, role: identity.role });
  }
  private async ensureWalletActive(actor: Identity, walletAddress: string, deviceId: string, identityId: string): Promise<void> {
    if (this.evmCryptoEnabled()) {
      const onChain = await this.chain.getWallet(walletAddress);
      if (onChain?.status === "ACTIVE") return;
      if (onChain?.status === "REVOKED") throw new ConflictError(`Wallet ${walletAddress} is already revoked on-chain`);
    }
    await this.submit("WALLET_ACTIVATE", actor, { address: walletAddress, deviceId, identityId });
  }
  private async ensureWalletRevoked(actor: Identity, walletAddress: string, reason: string): Promise<void> {
    if (this.evmCryptoEnabled()) {
      const onChain = await this.chain.getWallet(walletAddress);
      if (onChain?.status === "REVOKED") return;
    }
    await this.submit("WALLET_REVOKE", actor, { address: walletAddress, reason });
  }
  private async commit(entityType: "IDENTITY" | "DEVICE" | "WALLET" | "GRANT", entityId: string, eventType: string, actorIdentityId: string, state: Record<string, unknown>): Promise<void> { if (!this.integrity) return; const version = (this.versions.get(entityId) ?? 0) + 1; this.versions.set(entityId, version); await commitState(this.integrity, { entityType, entityId, eventType, version, actorIdentityId, state }); }
  private async submit(type: "IDENTITY_CREATE" | "ROLE_ASSIGN" | "WALLET_ACTIVATE" | "WALLET_REVOKE", actor: Identity, payload: Record<string, unknown>): Promise<void> {
    const user = await this.repositories.users.findByIdentityId(actor.identityId);
    const wallet = user?.walletAddress ? await this.repositories.wallets.findByAddress(user.walletAddress) : null;
    const actorWallet = wallet?.status === "ACTIVE" ? wallet.address : undefined;
    if (!actorWallet && this.evmCryptoEnabled()) throw new BlockchainError("SIGNER", `No active actor wallet for ${actor.identityId}`);
    const result = await this.chain.submitTransaction({ txId: randomUUID(), type, actorIdentity: actor.identityId || SYSTEM_IDENTITY, actorWallet: actorWallet ?? SYSTEM_WALLET, payload, timestamp: new Date().toISOString(), signature: "development" });
    if (result.status !== "SUCCESS") throw new BlockchainError("REVERTED", `Blockchain rejected ${type}`, { type, actorIdentity: actor.identityId });
  }
}
