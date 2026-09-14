// Owner: Person 6. Backs GET /assets/:id and POST /assets/:id/transfer.
// Also links to the audit trail for this asset (GET /audit/assets/:id).

import { useEffect, useState } from "react";
import { mockApi } from "../api/mockApi";
import { Asset } from "../../../shared/types";

export function AssetDetailPage({
  assetId,
  onViewAudit,
}: {
  assetId: string;
  onViewAudit?: (assetId: string) => void;
}) {
  const [asset, setAsset] = useState<Asset | null>(null);

  useEffect(() => {
    mockApi.getAsset(assetId).then(setAsset);
  }, [assetId]);

  if (!asset) return <p>Loading...</p>;

  return (
    <div>
      <h2>{asset.assetId}</h2>
      <p>Type: {asset.assetType}</p>
      <p>Owner: {asset.ownerId}</p>
      <p>Custodian: {asset.custodianId}</p>
      <p>Status: {asset.status}</p>
      {onViewAudit && (
        <button className="ghost" onClick={() => onViewAudit(asset.assetId)}>
          View audit trail
        </button>
      )}
      {/* TODO: transfer form (RBAC: Admin/Manager/authorized Engineer only)
          and provenance/component-hierarchy view */}
    </div>
  );
}
