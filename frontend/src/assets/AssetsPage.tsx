import { useEffect, useState } from "react";
import { can } from "../../../shared/rbac";
import type { Asset, Job, User } from "../../../shared/types";
import { mockApi } from "../api/mockApi";

export function AssetsPage({
  user,
  onSelect,
}: {
  user: User;
  onSelect: (assetId: string) => void;
}) {
  const [assets, setAssets] = useState<Asset[]>([]);
  const [jobs, setJobs] = useState<Job[]>([]);
  const [loading, setLoading] = useState(true);
  const [message, setMessage] = useState("");

  const [assetId, setAssetId] = useState("");
  const [assetType, setAssetType] = useState("");
  const [ownerId, setOwnerId] = useState("");
  const [custodianId,setCustodianId] = useState("");

  useEffect(() => {
    loadAssets();
  }, []);

  async function loadAssets() {
    try {
      setLoading(true);

      const [assetData, jobData] = await Promise.all([
        mockApi.getAssets(),
        mockApi.getJobs(),
      ]);

      setAssets(assetData);
      setJobs(jobData);
    } catch (error) {
      setMessage(
        error instanceof Error
          ? error.message
          : "Failed to load assets."
      );
    } finally {
      setLoading(false);
    }
  }

  const canRegister = can(user.role, "REGISTER_ASSET");

  async function handleRegisterAsset() {
    if (!assetType.trim()) {
      setMessage("Please enter the asset type.");
      return;
    }

    if (!ownerId.trim()) {
      setMessage("Please enter the owner ID.");
      return;
    }

    if (!custodianId.trim()) {
      setMessage("Please enter the custodian ID.");
      return;
    }

    try {
      const newAsset = await mockApi.createAsset({
        assetId: assetId.trim() || undefined,
        assetType: assetType.trim(),
        ownerId: ownerId.trim(),
        custodianId: custodianId.trim(),
      });

      setAssets((current) => [
        ...current,
        newAsset,
      ]);

      setAssetId("");
      setAssetType("");
      setOwnerId("");

      setMessage(
        `Asset ${newAsset.assetId} registered successfully.`
      );
    } catch (error) {
      setMessage(
        error instanceof Error
          ? error.message
          : "Asset registration failed."
      );
    }
  }

  /*
   * Find the maintenance verification status
   * for a particular asset.
   */
  function getVerificationStatus(assetId: string) {
    const assetJobs = jobs.filter(
      (job) => job.assetId === assetId
    );

    if (assetJobs.length === 0) {
      return "NOT STARTED";
    }

    /*
     * Use the latest job returned by the mock API.
     */
    const latestJob = assetJobs[assetJobs.length - 1];

    switch (latestJob.status) {
      case "VERIFIED":
        return "VERIFIED";

      case "REJECTED":
        return "REJECTED";

      case "COMPLETED":
        return "AWAITING VERIFICATION";

      case "CREATED":
      case "ASSIGNED":
      case "IN_PROGRESS":
        return "IN PROGRESS";

      default:
        return "NOT STARTED";
    }
  }

  return (
    <div className="page">

      <div className="page-header">
        <div>
          <h2>Assets</h2>

          <p className="page-subtitle">
            BEL asset registry
          </p>
        </div>
      </div>

      {canRegister && (
        <div className="dashboard-section">

          <h3>Register Asset</h3>

          <div className="dashboard-info-grid">

            <div className="dashboard-info-item">
              <label className="label">
                Asset ID
              </label>

              <input
                type="text"
                placeholder="Example: AST-002"
                value={assetId}
                onChange={(e) =>
                  setAssetId(e.target.value)
                }
              />
            </div>

            <div className="dashboard-info-item">
              <label className="label">
                Asset Type
              </label>

              <input
                type="text"
                placeholder="Example: AIRCRAFT_PART"
                value={assetType}
                onChange={(e) =>
                  setAssetType(e.target.value)
                }
              />
            </div>

            <div className="dashboard-info-item">
              <label className="label">
                Owner ID
              </label>

              <input
                type="text"
                placeholder="Example: DID:BEL:001"
                value={ownerId}
                onChange={(e) =>
                  setOwnerId(e.target.value)
                }
              />
            </div>

            <div className="dashboard-info-item">
              <label className="label">
                Custodian ID
              </label>

             <input
  type="text"
  value={custodianId}
  placeholder="Enter Custodian ID"
  onChange={(e) => setCustodianId(e.target.value)}
/>
            </div>

          </div>

          <div className="workspace-actions">

            <button
              type="button"
              onClick={handleRegisterAsset}
            >
              Register Asset
            </button>

          </div>

        </div>
      )}

      <div className="dashboard-section">

        <h3>Asset List</h3>

        {loading ? (
          <p>Loading assets...</p>
        ) : assets.length === 0 ? (
          <p>No assets found.</p>
        ) : (
          assets.map((asset) => {

            const verificationStatus =
              getVerificationStatus(asset.assetId);

            return (
              <div
                key={asset.assetId}
                className="dashboard-section"
              >

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
                      Asset Status
                    </span>

                    <span className="value">
                      {asset.status}
                    </span>
                  </div>

                  <div className="dashboard-info-item">
                    <span className="label">
                      Maintenance Verification
                    </span>

                    <span className="value">
                      {verificationStatus}
                    </span>
                  </div>

                </div>

                <div className="workspace-actions">

                  <button
                    type="button"
                    onClick={() =>
                      onSelect(asset.assetId)
                    }
                  >
                    View Details
                  </button>

                </div>

              </div>
            );
          })
        )}

      </div>

      {message && (
        <p className="page-subtitle">
          {message}
        </p>
      )}

    </div>
  );
}