import { useEffect, useState } from "react";
import { mockApi } from "../api/mockApi";
import type { Asset, User } from "../../../shared/types";

export function AssetDetailPage({
  assetId,
  user,
  onViewAudit,
}: {
  assetId: string;
  user: User;
  onViewAudit?: (assetId: string) => void;
}) {
  const [asset, setAsset] = useState<Asset | null>(null);

  useEffect(() => {
    mockApi.getAsset(assetId).then(setAsset);
  }, [assetId]);

  if (!asset) {
    return <p>Loading...</p>;
  }

  return (
    <div className="page">

      <div className="page-header">
        <div>
          <h2>{asset.assetId}</h2>
          <p className="page-subtitle">
            Asset details
          </p>
        </div>
      </div>

      <div className="dashboard-section">

        <div className="dashboard-info-grid">

          <div className="dashboard-info-item">
            <span className="label">
              Asset ID
            </span>
            <span className="value">
              {asset.assetId}
            </span>
          </div>

          <div className="dashboard-info-item">
            <span className="label">
              NFT ID
            </span>
            <span className="value">
              {asset.nftId}
            </span>
          </div>

          <div className="dashboard-info-item">
            <span className="label">
              Type
            </span>
            <span className="value">
              {asset.assetType}
            </span>
          </div>

          <div className="dashboard-info-item">
            <span className="label">
              Owner
            </span>
            <span className="value">
              {asset.ownerId}
            </span>
          </div>

          <div className="dashboard-info-item">
            <span className="label">
              Custodian
            </span>
            <span className="value">
              {asset.custodianId}
            </span>
          </div>

          <div className="dashboard-info-item">
            <span className="label">
              Status
            </span>
            <span className="value">
              {asset.status}
            </span>
          </div>

        </div>
      </div>

      <div className="dashboard-section">

        <div className="workspace-actions">

          {onViewAudit && (
            <button
              type="button"
              onClick={() =>
                onViewAudit(asset.assetId)
              }
            >
              View audit trail
            </button>
          )}

        </div>

      </div>

    </div>
  );
}