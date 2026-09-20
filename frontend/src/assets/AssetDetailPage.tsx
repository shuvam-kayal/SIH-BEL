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

  const [showTransferForm, setShowTransferForm] = useState(false);
  const [newOwnerId, setNewOwnerId] = useState("");
  const [newCustodianId, setNewCustodianId] = useState("");
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState("");

  useEffect(() => {
    mockApi.getAsset(assetId).then(setAsset);
  }, [assetId]);

  if (!asset) {
    return <p>Loading...</p>;
  }

  /*
   * RBAC:
   * ADMIN  -> ALLOW
   * MANAGER -> ALLOW
   *
   * ENGINEER -> AUTH
   * TECHNICIAN -> DENY
   * AUDITOR -> DENY
   * ISSUER -> DENY
   * VERIFIER -> DENY
   */
  const normalizeRole = (r: unknown) =>
    String(r ?? "")
      .trim()
      .toUpperCase()
      .replace(/[\s-]+/g, "_")
      .replace(/^ROLE_/, "");

  const role = normalizeRole(user.role);

  const canTransfer = ["ADMIN", "MANAGER"].includes(role);

  const handleTransfer = async () => {
    if (!newOwnerId.trim()) {
      setMessage("Please enter a new owner ID.");
      return;
    }

    setLoading(true);
    setMessage("");

    try {
      const updatedAsset = await mockApi.transferAsset(assetId, {
        newOwnerId: newOwnerId.trim(),
        newCustodianId: newCustodianId.trim()
          ? newCustodianId.trim()
          : undefined,
      });

      setAsset(updatedAsset);

      setNewOwnerId("");
      setNewCustodianId("");
      setShowTransferForm(false);

      setMessage("Asset transferred successfully.");
    } catch (error) {
      setMessage(
        error instanceof Error
          ? error.message
          : "Asset transfer failed."
      );
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="page">

      {/* Header */}
      <div className="page-header">
        <div>
          <h2>{asset.assetId}</h2>

          <p className="page-subtitle">
            Asset details and ownership
          </p>
        </div>
      </div>

      {/* Asset Details */}
      <div className="dashboard-section">
        <div className="dashboard-info-grid">

          <div className="dashboard-info-item">
            <span className="label">Asset ID</span>
            <span className="value">
              {asset.assetId}
            </span>
          </div>

          <div className="dashboard-info-item">
            <span className="label">NFT ID</span>
            <span className="value">
              {asset.nftId}
            </span>
          </div>

          <div className="dashboard-info-item">
            <span className="label">Type</span>
            <span className="value">
              {asset.assetType}
            </span>
          </div>

          <div className="dashboard-info-item">
            <span className="label">Owner</span>
            <span className="value">
              {asset.ownerId}
            </span>
          </div>

          <div className="dashboard-info-item">
            <span className="label">Custodian</span>
            <span className="value">
              {asset.custodianId}
            </span>
          </div>

          <div className="dashboard-info-item">
            <span className="label">Status</span>
            <span className="value">
              {asset.status}
            </span>
          </div>

        </div>
      </div>

      {/* Asset Transfer */}
      {canTransfer && (
        <div className="dashboard-section">

          <h3>Asset Transfer</h3>

          <p className="page-subtitle">
            Transfer ownership and custody of this asset.
          </p>

          <div className="workspace-actions">
            <button
              type="button"
              onClick={() =>
                setShowTransferForm(!showTransferForm)
              }
            >
              {showTransferForm
                ? "Cancel"
                : "Transfer Asset"}
            </button>
          </div>

          {/* Transfer Form */}
          {showTransferForm && (
            <div className="dashboard-section">

              <div className="dashboard-info-grid">

                <div className="dashboard-info-item">
                  <label className="label">
                    New Owner ID
                  </label>

                  <input
                    type="text"
                    placeholder="Example: DID:BEL:002"
                    value={newOwnerId}
                    onChange={(e) =>
                      setNewOwnerId(e.target.value)
                    }
                  />
                </div>

                <div className="dashboard-info-item">
                  <label className="label">
                    New Custodian ID
                  </label>

                  <input
                    type="text"
                    placeholder="Example: DID:BEL:002"
                    value={newCustodianId}
                    onChange={(e) =>
                      setNewCustodianId(e.target.value)
                    }
                  />
                </div>

              </div>

              <div className="workspace-actions">

                <button
                  type="button"
                  onClick={handleTransfer}
                  disabled={
                    loading ||
                    !newOwnerId.trim()
                  }
                >
                  {loading
                    ? "Transferring..."
                    : "Confirm Transfer"}
                </button>

              </div>

            </div>
          )}

          {/* Transfer message */}
          {message && (
            <p className="page-subtitle">
              {message}
            </p>
          )}

        </div>
      )}

      {/* Audit Trail */}
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