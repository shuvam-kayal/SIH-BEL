import { createHash, randomUUID } from "node:crypto";
import type { AuthorizationGrant, Device, Identity, User, Wallet, ValidatorRegistration } from "../../../shared/types";

export type SessionRecord = { token: string; identityId: string; deviceId: string; walletAddress: string; expiresAt: number };
export const hashCredential = (credential: string): string => createHash("sha256").update(credential).digest("hex");

/**
 * Small process-local state used only by explicit in-memory repositories in
 * unit tests. The normal container selects Prisma when DATABASE_URL exists.
 */
export class IdentityStore {
  readonly identities = new Map<string, Identity>();
  readonly users = new Map<string, User>();
  readonly devices = new Map<string, Device>();
  readonly wallets = new Map<string, Wallet>();
  readonly credentials = new Map<string, string>();
  readonly sessions = new Map<string, SessionRecord>();
  readonly grants = new Map<string, AuthorizationGrant>();
  readonly validators = new Map<string, ValidatorRegistration>();

  nextIdentityId(): string {
    return `DID:BEL:${randomUUID()}`;
  }

  userForIdentity(identityId: string): User | undefined {
    return [...this.users.values()].find((user) => user.identityId === identityId);
  }

  walletForIdentity(identityId: string, status?: Wallet["status"]): Wallet | undefined {
    return [...this.wallets.values()].find(
      (wallet) => wallet.identityId === identityId && (status === undefined || wallet.status === status),
    );
  }

  identityForUserId(id: string): Identity | undefined {
    const user = this.users.get(id) ?? [...this.users.values()].find((item) => item.employeeId === id);
    return user ? this.identities.get(user.identityId) : this.identities.get(id);
  }

  clear(): void {
    this.identities.clear();
    this.users.clear();
    this.devices.clear();
    this.wallets.clear();
    this.credentials.clear();
    this.sessions.clear();
    this.grants.clear();
    this.validators.clear();
  }
}

export const identityStore = new IdentityStore();

/** Test/support hook; production code should not clear identity state. */
export function clearIdentityStore(): void {
  identityStore.clear();
}

