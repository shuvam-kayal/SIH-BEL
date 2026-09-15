import { createHash } from "node:crypto";
import { PrismaClient } from "@prisma/client";
import type { AuthorizationGrant, Device, Identity, User, Wallet } from "../../../shared/types";
import type {
  AuthorizationGrantRepository,
  CredentialRepository,
  DeviceRepository,
  IdentityRepository,
  IdentityRepositories,
  SessionRepository,
  UserRepository,
  WalletRepository,
} from "./repositories";
import { hashCredential, type SessionRecord, IdentityStore } from "./identity.store";

const asDate = (value: string): Date => new Date(value);
const asIso = (value: Date): string => value.toISOString();

export class PrismaIdentityRepository implements IdentityRepository {
  constructor(private readonly prisma: PrismaClient) {}
  async findById(id: string) { return mapIdentity(await this.prisma.identity.findUnique({ where: { identityId: id } })); }
  async findByEmployeeId(employeeId: string) { return mapIdentity(await this.prisma.identity.findUnique({ where: { employeeId } })); }
  async save(identity: Identity) {
    await this.prisma.identity.upsert({ where: { identityId: identity.identityId }, create: identityData(identity), update: identityData(identity) });
  }
}

export class PrismaUserRepository implements UserRepository {
  constructor(private readonly prisma: PrismaClient) {}
  async findById(id: string) { return mapUser(await this.prisma.user.findUnique({ where: { employeeId: id } })); }
  async findByIdentityId(identityId: string) { return mapUser(await this.prisma.user.findUnique({ where: { identityId } })); }
  async save(user: User) {
    await this.prisma.user.upsert({ where: { employeeId: user.employeeId }, create: userData(user), update: userData(user) });
  }
}

export class PrismaDeviceRepository implements DeviceRepository {
  constructor(private readonly prisma: PrismaClient) {}
  async findById(deviceId: string) { return mapDevice(await this.prisma.device.findUnique({ where: { deviceId } })); }
  async listByIdentityId(identityId: string) { return (await this.prisma.device.findMany({ where: { identityId }, orderBy: { registeredAt: "asc" } })).map((row: any) => mapDevice(row)!); }
  async save(device: Device) {
    await this.prisma.device.upsert({ where: { deviceId: device.deviceId }, create: deviceData(device), update: deviceData(device) });
  }
}

export class PrismaWalletRepository implements WalletRepository {
  constructor(private readonly prisma: PrismaClient) {}
  async findByAddress(address: string) { return mapWallet(await this.prisma.wallet.findUnique({ where: { address } })); }
  async listByIdentityId(identityId: string) { return (await this.prisma.wallet.findMany({ where: { identityId }, orderBy: { address: "asc" } })).map((row: any) => mapWallet(row)!); }
  async save(wallet: Wallet) {
    await this.prisma.wallet.upsert({ where: { address: wallet.address }, create: walletData(wallet), update: walletData(wallet) });
  }
}

export class PrismaCredentialRepository implements CredentialRepository {
  constructor(private readonly prisma: PrismaClient) {}
  async findDeviceId(verifier: string) {
    const credential = await this.prisma.credential.findUnique({ where: { verifier } });
    return credential?.active ? credential.deviceId : null;
  }
  async save(verifier: string, deviceId: string) {
    await this.prisma.credential.upsert({
      where: { verifier },
      create: { id: hashCredential(verifier), verifier, deviceId, active: true },
      update: { deviceId, active: true },
    });
  }
  async revoke(verifier: string) { await this.prisma.credential.updateMany({ where: { verifier }, data: { active: false } }); }
  async revokeForDevice(deviceId: string) { await this.prisma.credential.updateMany({ where: { deviceId }, data: { active: false } }); }
}

export class PrismaSessionRepository implements SessionRepository {
  constructor(private readonly prisma: PrismaClient) {}
  private key(token: string) { return createHash("sha256").update(token).digest("hex"); }
  async find(token: string) {
    const row = await this.prisma.session.findUnique({ where: { tokenHash: this.key(token) } });
    if (!row || row.revokedAt) return null;
    return { token, identityId: row.identityId, deviceId: row.deviceId, walletAddress: row.walletAddress, expiresAt: row.expiresAt.getTime() };
  }
  async save(session: SessionRecord) {
    await this.prisma.session.upsert({
      where: { tokenHash: this.key(session.token) },
      create: { tokenHash: this.key(session.token), identityId: session.identityId, deviceId: session.deviceId, walletAddress: session.walletAddress, expiresAt: new Date(session.expiresAt), revokedAt: null },
      update: { identityId: session.identityId, deviceId: session.deviceId, walletAddress: session.walletAddress, expiresAt: new Date(session.expiresAt), revokedAt: null },
    });
  }
  async delete(token: string) { await this.prisma.session.updateMany({ where: { tokenHash: this.key(token) }, data: { revokedAt: new Date() } }); }
}

export class PrismaAuthorizationGrantRepository implements AuthorizationGrantRepository {
  constructor(private readonly prisma: PrismaClient) {}
  async findById(id: string) { return mapGrant(await this.prisma.authorizationGrant.findUnique({ where: { authorizationGrantId: id } })); }
  async listByIdentityId(identityId: string) { return (await this.prisma.authorizationGrant.findMany({ where: { actorIdentityId: identityId }, orderBy: { issuedAt: "asc" } })).map((row: any) => mapGrant(row)!); }
  async save(grant: AuthorizationGrant) {
    await this.prisma.authorizationGrant.upsert({ where: { authorizationGrantId: grant.authorizationGrantId }, create: grantData(grant), update: grantData(grant) });
  }
}

export function createPrismaRepositories(prisma: PrismaClient): IdentityRepositories {
  return { identities: new PrismaIdentityRepository(prisma), users: new PrismaUserRepository(prisma), devices: new PrismaDeviceRepository(prisma), wallets: new PrismaWalletRepository(prisma), credentials: new PrismaCredentialRepository(prisma), sessions: new PrismaSessionRepository(prisma), grants: new PrismaAuthorizationGrantRepository(prisma) };
}

/** Test/development adapters with the same ports as the Prisma adapters. */
class MemoryIdentityRepository implements IdentityRepository {
  constructor(private readonly store: IdentityStore) {}
  async findById(id: string) { return this.store.identities.get(id) ? { ...this.store.identities.get(id)! } : null; }
  async findByEmployeeId(employeeId: string) { return [...this.store.identities.values()].find((item) => item.employeeId === employeeId) ? { ...[...this.store.identities.values()].find((item) => item.employeeId === employeeId)! } : null; }
  async save(value: Identity) { this.store.identities.set(value.identityId, { ...value }); }
}
class MemoryUserRepository implements UserRepository {
  constructor(private readonly store: IdentityStore) {}
  async findById(id: string) { const value = this.store.users.get(id); return value ? { ...value } : null; }
  async findByIdentityId(identityId: string) { const value = [...this.store.users.values()].find((item) => item.identityId === identityId); return value ? { ...value } : null; }
  async save(value: User) { this.store.users.set(value.employeeId, { ...value }); }
}
class MemoryDeviceRepository implements DeviceRepository {
  constructor(private readonly store: IdentityStore) {}
  async findById(id: string) { const value = this.store.devices.get(id); return value ? { ...value } : null; }
  async listByIdentityId(id: string) { return [...this.store.devices.values()].filter((item) => item.identityId === id).map((item) => ({ ...item })); }
  async save(value: Device) { this.store.devices.set(value.deviceId, { ...value }); }
}
class MemoryWalletRepository implements WalletRepository {
  constructor(private readonly store: IdentityStore) {}
  async findByAddress(address: string) { const value = this.store.wallets.get(address); return value ? { ...value } : null; }
  async listByIdentityId(id: string) { return [...this.store.wallets.values()].filter((item) => item.identityId === id).map((item) => ({ ...item })); }
  async save(value: Wallet) { this.store.wallets.set(value.address, { ...value }); }
}
class MemoryCredentialRepository implements CredentialRepository {
  constructor(private readonly store: IdentityStore) {}
  async findDeviceId(verifier: string) { return this.store.credentials.get(verifier) ?? null; }
  async save(verifier: string, deviceId: string) { this.store.credentials.set(verifier, deviceId); }
  async revoke(verifier: string) { this.store.credentials.delete(verifier); }
  async revokeForDevice(deviceId: string) { for (const [key, value] of this.store.credentials) if (value === deviceId) this.store.credentials.delete(key); }
}
class MemorySessionRepository implements SessionRepository {
  constructor(private readonly store: IdentityStore) {}
  async find(token: string) { const value = this.store.sessions.get(token); return value ? { ...value } : null; }
  async save(value: SessionRecord) { this.store.sessions.set(value.token, { ...value }); }
  async delete(token: string) { this.store.sessions.delete(token); }
}
class MemoryGrantRepository implements AuthorizationGrantRepository {
  constructor(private readonly store: IdentityStore) {}
  async findById(id: string) { const value = this.store.grants.get(id); return value ? { ...value } : null; }
  async listByIdentityId(id: string) { return [...this.store.grants.values()].filter((item) => item.actorIdentityId === id).map((item) => ({ ...item })); }
  async save(value: AuthorizationGrant) { this.store.grants.set(value.authorizationGrantId, { ...value }); }
}

export function createMemoryRepositories(store: IdentityStore = new IdentityStore()): IdentityRepositories {
  return { identities: new MemoryIdentityRepository(store), users: new MemoryUserRepository(store), devices: new MemoryDeviceRepository(store), wallets: new MemoryWalletRepository(store), credentials: new MemoryCredentialRepository(store), sessions: new MemorySessionRepository(store), grants: new MemoryGrantRepository(store) };
}

const identityData = (value: Identity) => ({ identityId: value.identityId, employeeId: value.employeeId, fullName: value.fullName, role: value.role, department: value.department, status: value.status, createdAt: asDate(value.createdAt) });
const userData = (value: User) => ({ employeeId: value.employeeId, identityId: value.identityId, walletAddress: value.walletAddress, role: value.role, department: value.department, status: value.status });
const deviceData = (value: Device) => ({ deviceId: value.deviceId, identityId: value.identityId, status: value.status, registeredAt: asDate(value.registeredAt), revokedAt: value.revokedAt ? asDate(value.revokedAt) : null });
const walletData = (value: Wallet) => ({ address: value.address, identityId: value.identityId, deviceId: value.deviceId, status: value.status, activatedAt: value.activatedAt ? asDate(value.activatedAt) : null, revokedAt: value.revokedAt ? asDate(value.revokedAt) : null, revokedReason: value.revokedReason });
const grantData = (value: AuthorizationGrant) => ({ authorizationGrantId: value.authorizationGrantId, actorIdentityId: value.actorIdentityId, resourceType: value.resourceType, resourceId: value.resourceId, action: value.action, grantedByIdentityId: value.grantedByIdentityId, issuedAt: asDate(value.issuedAt), expiresAt: value.expiresAt ? asDate(value.expiresAt) : null, status: value.status });
const mapIdentity = (row: any): Identity | null => row ? { ...row, createdAt: asIso(row.createdAt) } : null;
const mapUser = (row: any): User | null => row ? { ...row } : null;
const mapDevice = (row: any): Device | null => row ? { ...row, registeredAt: asIso(row.registeredAt), revokedAt: row.revokedAt ? asIso(row.revokedAt) : null } : null;
const mapWallet = (row: any): Wallet | null => row ? { ...row, activatedAt: row.activatedAt ? asIso(row.activatedAt) : null, revokedAt: row.revokedAt ? asIso(row.revokedAt) : null } : null;
const mapGrant = (row: any): AuthorizationGrant | null => row ? { ...row, issuedAt: asIso(row.issuedAt), expiresAt: row.expiresAt ? asIso(row.expiresAt) : null } : null;
