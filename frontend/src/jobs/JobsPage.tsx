// Owner: Person 6. Backs GET /jobs, POST /jobs.
import { useEffect, useState } from "react";
import { mockApi } from "../api/mockApi";
import type { Job, User } from "../../../shared/types";
import { can } from "../../../shared/rbac";

export function JobsPage({
  user,
  onSelect,
}: {
  user: User;
  onSelect?: (jobId: string) => void;
}) {
  const [jobs, setJobs] = useState<Job[]>([]);
  const [showForm, setShowForm] = useState(false);

  const [assetId, setAssetId] = useState("AST-001");

  const [priority, setPriority] = useState<
    "LOW" | "MEDIUM" | "HIGH" | "CRITICAL"
  >("MEDIUM");

  const [message, setMessage] = useState("");

  useEffect(() => {
    loadJobs();
  }, []);

  const loadJobs = async () => {
    const data = await mockApi.getJobs();
    setJobs(data);
  };

  const handleCreateJob = async () => {
    if (!assetId.trim()) {
      setMessage("Please enter an Asset ID.");
      return;
    }

    setMessage("");

    try {
      const newJob = await mockApi.createJob({
        assetId: assetId.trim(),
        priority,
      });

      setJobs((currentJobs) => [...currentJobs, newJob]);

      setAssetId("AST-001");
      setPriority("MEDIUM");

      setShowForm(false);
    } catch (error) {
      setMessage(
        error instanceof Error
          ? error.message
          : "Failed to create job."
      );
    }
  };

  return (
    <div className="page">

      {/* PAGE HEADER */}
      <div className="page-header">
        <div>
          <h2>Jobs</h2>

          <p className="page-subtitle">
            Maintenance and service jobs
          </p>
        </div>

        <div className="page-count">
          {jobs.length} job{jobs.length !== 1 ? "s" : ""}
        </div>
      </div>

      {/* CREATE JOB BUTTON */}
      {can(user.role, "CREATE_JOB") && (
        <div className="page-actions">
          <button
            type="button"
            onClick={() => {
              setShowForm(!showForm);
              setMessage("");
            }}
          >
            {showForm ? "Cancel" : "Create Job"}
          </button>
        </div>
      )}

      {/* CREATE JOB FORM */}
      {showForm && (
        <div className="dashboard-section">

          <h3>Create Job</h3>

          <div className="dashboard-info-grid">

            {/* ASSET */}
            <div className="dashboard-info-item">
              <label className="label">
                Asset ID
              </label>

              <input
                type="text"
                value={assetId}
                onChange={(e) =>
                  setAssetId(e.target.value)
                }
                placeholder="Example: AST-001"
              />
            </div>

            {/* PRIORITY */}
            <div className="dashboard-info-item">
              <label className="label">
                Priority
              </label>

              <select
                value={priority}
                onChange={(e) =>
                  setPriority(
                    e.target.value as
                      | "LOW"
                      | "MEDIUM"
                      | "HIGH"
                      | "CRITICAL"
                  )
                }
              >
                <option value="LOW">
                  LOW
                </option>

                <option value="MEDIUM">
                  MEDIUM
                </option>

                <option value="HIGH">
                  HIGH
                </option>

                <option value="CRITICAL">
                  CRITICAL
                </option>
              </select>
            </div>

          </div>

          {/* CREATE BUTTON */}
          <div className="workspace-actions">
            <button
              type="button"
              onClick={handleCreateJob}
            >
              Create Job
            </button>
          </div>

          {message && (
            <p className="page-subtitle">
              {message}
            </p>
          )}

        </div>
      )}

      {/* JOB LIST */}
      <div className="jobs-list">

        {jobs.length === 0 ? (
          <div className="empty-state">
            No jobs available.
          </div>
        ) : (
          jobs.map((job) => (
            <div
              className="job-row"
              key={job.jobId}
            >

              <div className="job-main">

                <button
                  type="button"
                  className="job-id"
                  onClick={() =>
                    onSelect?.(job.jobId)
                  }
                >
                  {job.jobId}
                </button>

                <div className="job-asset">
                  Asset: {job.assetId}
                </div>

              </div>

              <div className="job-info">

                <span className="job-priority">
                  {job.priority}
                </span>

                <span className="job-status">
                  {job.status}
                </span>

              </div>

            </div>
          ))
        )}

      </div>

    </div>
  );
}