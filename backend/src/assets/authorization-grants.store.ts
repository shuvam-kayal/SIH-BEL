import type { AuthorizationGrant } from "../../../shared/types";
import type { Action } from "../../../shared/rbac";

/**
 * Temporary in-memory projection for resource-scoped AUTH grants. There is
 * intentionally no HTTP writer: API_SPEC.yaml has no grant-management route.
 */
export class AuthorizationGrantsStore {
  private readonly grants = new Map<string, AuthorizationGrant>();

  add(grant: AuthorizationGrant): void {
    this.grants.set(grant.authorizationGrantId, { ...grant });
  }

  get(id: string): AuthorizationGrant | null {
    const grant = this.grants.get(id);
    return grant ? { ...grant } : null;
  }

  findActiveGrant(actorIdentityId: string, resourceId: string, action: Action): AuthorizationGrant | null {
    const now = Date.now();
    for (const grant of this.grants.values()) {
      const expiresAt = grant.expiresAt === null ? null : Date.parse(grant.expiresAt);
      if (
        grant.actorIdentityId === actorIdentityId &&
        grant.resourceType === "ASSET" &&
        grant.resourceId === resourceId &&
        grant.action === action &&
        grant.status === "ACTIVE" &&
        (expiresAt === null || (Number.isFinite(expiresAt) && expiresAt > now))
      ) {
        return { ...grant };
      }
    }
    return null;
  }

  hasActiveGrant(actorIdentityId: string, resourceId: string, action: Action): boolean {
    return this.findActiveGrant(actorIdentityId, resourceId, action) !== null;
  }

  clear(): void {
    this.grants.clear();
  }
}

export const authorizationGrantsStore = new AuthorizationGrantsStore();
