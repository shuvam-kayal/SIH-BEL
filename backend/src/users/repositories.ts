import type { AuthorizationGrant, Device, Identity, ProvisioningChallenge, User, Wallet, ValidatorRegistration } from "../../../shared/types";
import type { SessionRecord } from "./identity.store";

/** Persistence ports. Domain services should depend on these ports when the
 * in-memory store is replaced by the Prisma adapter. */
export interface IdentityRepository { findById(id: string): Promise<Identity | null>; findByEmployeeId(employeeId: string): Promise<Identity | null>; listByStatus(status: Identity["status"]): Promise<Identity[]>; save(identity: Identity): Promise<void>; }
export interface UserRepository { findById(id: string): Promise<User | null>; findByIdentityId(identityId: string): Promise<User | null>; save(user: User): Promise<void>; }
export interface DeviceRepository { findById(deviceId: string): Promise<Device | null>; listByIdentityId(identityId: string): Promise<Device[]>; save(device: Device): Promise<void>; }
export interface WalletRepository { findByAddress(address: string): Promise<Wallet | null>; listByIdentityId(identityId: string): Promise<Wallet[]>; save(wallet: Wallet): Promise<void>; }
export interface CredentialRepository { findDeviceId(verifier: string): Promise<string | null>; save(verifier: string, deviceId: string): Promise<void>; revoke(verifier: string): Promise<void>; revokeForDevice(deviceId: string): Promise<void>; }
export interface SessionRepository { find(token: string): Promise<SessionRecord | null>; save(session: SessionRecord): Promise<void>; delete(token: string): Promise<void>; }
export interface AuthorizationGrantRepository { findById(id: string): Promise<AuthorizationGrant | null>; listByIdentityId(identityId: string): Promise<AuthorizationGrant[]>; save(grant: AuthorizationGrant): Promise<void>; }
export interface ProvisioningChallengeRepository { findById(id: string): Promise<ProvisioningChallenge | null>; save(challenge: ProvisioningChallenge): Promise<void>; }
export interface ValidatorRepository { findById(id: string): Promise<ValidatorRegistration | null>; findByValidatorId(id: string): Promise<ValidatorRegistration | null>; list(): Promise<ValidatorRegistration[]>; save(registration: ValidatorRegistration): Promise<void>; }

export type IdentityRepositories = {
  identities: IdentityRepository;
  users: UserRepository;
  devices: DeviceRepository;
  wallets: WalletRepository;
  credentials: CredentialRepository;
  sessions: SessionRepository;
  grants: AuthorizationGrantRepository;
  challenges: ProvisioningChallengeRepository;
  validators: ValidatorRepository;
};

