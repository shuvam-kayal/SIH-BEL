// Backs GET /audit/assets/:id (docs/API_SPEC.yaml). Read-only surface
// over AuditEvent records written by assets/jobs/users services and
// mirrored from contracts/src/IAuditRegistry.sol emissions.

import { AuditEvent } from "../../../shared/types";
import type { BlockchainService } from "../adapters/BlockchainService";

export interface AuditService {
  getTrailForAsset(assetId: string): Promise<AuditEvent[]>;
}

export class AuditServiceImpl implements AuditService {
  constructor(private readonly chain: BlockchainService) {}
  async getTrailForAsset(assetId: string): Promise<AuditEvent[]> {
    const reader = this.chain as BlockchainService & { getAuditTrail?: (id: string) => Promise<AuditEvent[]> };
    return reader.getAuditTrail ? reader.getAuditTrail(assetId) : [];
  }
}
