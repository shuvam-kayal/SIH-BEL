import { createHash } from "node:crypto";

export type IntegrityCommitment = {
  entityType: "IDENTITY" | "DEVICE" | "WALLET" | "GRANT";
  entityId: string;
  eventType: string;
  version: number;
  canonicalStateHash: string;
  actorIdentityId: string;
  timestamp: string;
};

/** External anchoring seam. Production implementations submit this commitment
 * to the permissioned chain; tests use the in-memory adapter below. */
export interface IntegrityAdapter {
  commit(commitment: IntegrityCommitment): Promise<void>;
}

export class MemoryIntegrityAdapter implements IntegrityAdapter {
  readonly commitments: IntegrityCommitment[] = [];
  async commit(commitment: IntegrityCommitment): Promise<void> { this.commitments.push({ ...commitment }); }
}

export function canonicalStateHash(state: Record<string, unknown>): string {
  const canonical = JSON.stringify(Object.keys(state).sort().reduce<Record<string, unknown>>((result, key) => {
    result[key] = state[key];
    return result;
  }, {}));
  return createHash("sha256").update(canonical).digest("hex");
}

export async function commitState(
  adapter: IntegrityAdapter,
  input: Omit<IntegrityCommitment, "canonicalStateHash" | "timestamp"> & { state: Record<string, unknown>; timestamp?: string },
): Promise<IntegrityCommitment> {
  const commitment: IntegrityCommitment = {
    entityType: input.entityType,
    entityId: input.entityId,
    eventType: input.eventType,
    version: input.version,
    canonicalStateHash: canonicalStateHash(input.state),
    actorIdentityId: input.actorIdentityId,
    timestamp: input.timestamp ?? new Date().toISOString(),
  };
  await adapter.commit(commitment);
  return commitment;
}
