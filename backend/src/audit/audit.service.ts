// Backs GET /audit/assets/:id (docs/API_SPEC.yaml). Read-only surface
// over AuditEvent records written by assets/jobs/users services and
// mirrored from contracts/src/IAuditRegistry.sol emissions.

import { AuditEvent } from "../../../shared/types";
import { NotImplementedError } from "../errors";

export interface AuditService {
  getTrailForAsset(assetId: string): Promise<AuditEvent[]>;
}

export class AuditServiceImpl implements AuditService {
  async getTrailForAsset(_assetId: string): Promise<AuditEvent[]> {
    throw new NotImplementedError("AuditService.getTrailForAsset()");
  }
}
