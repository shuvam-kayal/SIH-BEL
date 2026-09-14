// Owner: Person 6. Backs GET /assets, POST /assets, and links out to
// AssetDetailPage for GET /assets/:id + POST /assets/:id/transfer.

import { useEffect, useState } from "react";
import { mockApi } from "../api/mockApi";
import { Asset } from "../../../shared/types";

export function AssetsPage({ onSelect }: { onSelect?: (assetId: string) => void }) {
  const [assets, setAssets] = useState<Asset[]>([]);

  useEffect(() => {
    mockApi.getAssets().then(setAssets);
  }, []);

  return (
    <div>
      <h2>Assets</h2>
      <ul>
        {assets.map((a) => (
          <li key={a.assetId}>
            <button onClick={() => onSelect?.(a.assetId)}>
              {a.assetId} — {a.assetType} — {a.status}
            </button>
          </li>
        ))}
      </ul>
      {/* TODO: create-asset form (RBAC: Admin/Manager/Engineer/Issuer only) */}
    </div>
  );
}
