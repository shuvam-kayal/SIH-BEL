// Owner: Person 6. Backs the /jobs/:id/{assign,start,complete,approve,
// reject} action endpoints.
import { useEffect, useState } from "react";
import { mockApi } from "../api/mockApi";
import type { Job, User } from "../../../shared/types";
import { can } from "../../../shared/rbac";

export function JobDetailPage({
  jobId,
  user,
}: {
  jobId: string;
  user: User;
}) {
  const [job, setJob] = useState<Job | null>(null);
  const [loading, setLoading] = useState(false);

  const [technicianId, setTechnicianId] = useState("");

  const [message, setMessage] = useState("");

  useEffect(() => {
    mockApi.getJob(jobId).then(setJob);
  }, [jobId]);

  if (!job) {
    return <p>Loading...</p>;
  }

  const refreshJob = async () => {
    const updatedJob = await mockApi.getJob(jobId);
    setJob(updatedJob);
  };

  const handleAssign = async () => {
    if (!technicianId.trim()) {
      setMessage("Please enter a Technician ID.");
      return;
    }

    setLoading(true);
    setMessage("");

    try {
      const updatedJob = await mockApi.assignJob(jobId, {
        technicianId: technicianId.trim(),
      });

      setJob(updatedJob);
      setTechnicianId("");
    } catch (error) {
      setMessage(
        error instanceof Error ? error.message : "Failed to assign technician."
      );
    } finally {
      setLoading(false);
    }
  };

  const handleStart = async () => {
    setLoading(true);
    setMessage("");

    try {
      const updatedJob = await mockApi.startJob(jobId);
      setJob(updatedJob);
    } catch (error) {
      setMessage(
        error instanceof Error ? error.message : "Failed to start job."
      );
    } finally {
      setLoading(false);
    }
  };

  const handleComplete = async () => {
    setLoading(true);
    setMessage("");

    try {
      const updatedJob = await mockApi.completeJob(jobId, {
        evidenceHash: "mock-evidence-hash",
      });

      setJob(updatedJob);
    } catch (error) {
      setMessage(
        error instanceof Error ? error.message : "Failed to complete job."
      );
    } finally {
      setLoading(false);
    }
  };

  const handleApprove = async () => {
    setLoading(true);
    setMessage("");

    try {
      const updatedJob = await mockApi.approveJob(jobId);
      setJob(updatedJob);
    } catch (error) {
      setMessage(
        error instanceof Error ? error.message : "Failed to approve job."
      );
    } finally {
      setLoading(false);
    }
  };

  const handleReject = async () => {
    setLoading(true);
    setMessage("");

    try {
      const updatedJob = await mockApi.rejectJob(jobId, {
        reason: "Maintenance rejected",
      });

      setJob(updatedJob);
    } catch (error) {
      setMessage(
        error instanceof Error ? error.message : "Failed to reject job."
      );
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="page">
      <div className="page-header">
        <div>
          <h2>{job.jobId}</h2>

          <p className="page-subtitle">
            Job details and maintenance actions
          </p>
        </div>
      </div>

      <div className="dashboard-section">
        <div className="dashboard-info-grid">
          <div className="dashboard-info-item">
            <span className="label">Job ID</span>
            <span className="value">{job.jobId}</span>
          </div>

          <div className="dashboard-info-item">
            <span className="label">Asset</span>
            <span className="value">{job.assetId}</span>
          </div>

          <div className="dashboard-info-item">
            <span className="label">Priority</span>
            <span className="value">{job.priority}</span>
          </div>

          <div className="dashboard-info-item">
            <span className="label">Status</span>
            <span className="value">{job.status}</span>
          </div>

          <div className="dashboard-info-item">
            <span className="label">Assigned Technician</span>
            <span className="value">
              {job.assignedTo || "Unassigned"}
            </span>
          </div>

          <div className="dashboard-info-item">
            <span className="label">Verifier</span>
            <span className="value">
              {job.verifierId || "Not assigned"}
            </span>
          </div>
        </div>
      </div>

      {/* Assign Technician */}
      {job.status === "CREATED" &&
        can(user.role, "ASSIGN_TECHNICIAN") && (
          <div className="dashboard-section">
            <h3>Assign Technician</h3>

            <div className="dashboard-info-item">
              <label className="label">Technician ID</label>

              <input
                type="text"
                value={technicianId}
                onChange={(e) => setTechnicianId(e.target.value)}
                placeholder="Example: DID:BEL:003"
              />
            </div>

            <div className="workspace-actions">
              <button
                type="button"
                onClick={handleAssign}
                disabled={loading}
              >
                {loading ? "Assigning..." : "Assign Technician"}
              </button>
            </div>
          </div>
        )}

      {/* Maintenance and Verification Actions */}
      <div className="dashboard-section">
        <h3>Actions</h3>

        <div className="workspace-actions">
          {job.status === "ASSIGNED" &&
            can(user.role, "PERFORM_MAINTENANCE") && (
              <button
                type="button"
                onClick={handleStart}
                disabled={loading}
              >
                {loading ? "Starting..." : "Start Maintenance"}
              </button>
            )}

          {job.status === "IN_PROGRESS" &&
            can(user.role, "PERFORM_MAINTENANCE") && (
              <button
                type="button"
                onClick={handleComplete}
                disabled={loading}
              >
                {loading ? "Completing..." : "Complete Maintenance"}
              </button>
            )}

          {job.status === "COMPLETED" &&
            can(user.role, "VERIFY_MAINTENANCE") && (
              <>
                <button
                  type="button"
                  onClick={handleApprove}
                  disabled={loading}
                >
                  {loading ? "Processing..." : "Approve"}
                </button>

                <button
                  type="button"
                  onClick={handleReject}
                  disabled={loading}
                >
                  {loading ? "Processing..." : "Reject"}
                </button>
              </>
            )}
        </div>
      </div>

      {message && (
        <div className="dashboard-section">
          <p className="page-subtitle">{message}</p>
        </div>
      )}

      <button
        type="button"
        onClick={refreshJob}
        disabled={loading}
      >
        Refresh
      </button>
    </div>
  );
}