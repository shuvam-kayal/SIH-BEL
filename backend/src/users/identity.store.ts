import { randomUUID } from "node:crypto";
import type { Device, Identity, User, Wallet } from "../../../shared/types";

export type SessionRecord = { token: string; identityId: string; deviceId: string };

/**
 * The development backend has no database yet.  This store is deliberately
 * small, process-local, and behind the users/auth services so replacing it
 * with a repository does not change the API or authorization rules.
 */
export class IdentityStore {
  readonly identities = new Map<string, Identity>();
  readonly users = new Map<string, User>();
  readonly devices = new Map<string, Device>();
  readonly wallets = new Map<string, Wallet>();
  readonly credentials = new Map<string, string>();
  readonly sessions = new Map<string, SessionRecord>();

  nextIdentityId(): string {
    return `DID:BEL:${randomUUID()}`;
  }

  nextWalletAddress(): string {
    return `0xBEL${randomUUID().replaceAll("-", "").slice(0, 40)}`;
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
  }
}

export const identityStore = new IdentityStore();

/** Test/support hook; production code should not clear identity state. */
export function clearIdentityStore(): void {
  identityStore.clear();
}
