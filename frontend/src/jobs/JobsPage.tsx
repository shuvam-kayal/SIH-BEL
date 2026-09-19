import {
  useCallback,
  useEffect,
  useState,
} from "react";
import { mockApi } from "../api/mockApi";
import type { Job, User } from "../../../shared/types";
import { can } from "../../../shared/rbac";

export function JobsPage({
  user,
  onOpenJob,
}: {
  user: User;
  onOpenJob: (jobId: string) => void;
}) {
  const [jobs, setJobs] = useState<Job[]>([]);
  const [employees, setEmployees] = useState<User[]>([]);

  const [assetId, setAssetId] = useState("AST-001");
  const [priority, setPriority] = useState<
    "LOW" | "MEDIUM" | "HIGH"
  >("MEDIUM");

  const [technicianId, setTechnicianId] = useState("");
  const [verifierId, setVerifierId] = useState("");

  const [showForm, setShowForm] = useState(false);
  const [message, setMessage] = useState("");
  const [loading, setLoading] = useState(false);

  // --------------------------------------------------
  // Load jobs and employees
  // --------------------------------------------------

  const loadData = async () => {
    try {
      const [jobData, employeeData] = await Promise.all([
        mockApi.getJobs(),
        mockApi.getUsers(),
      ]);

      setJobs(jobData);
      setEmployees(employeeData);

      const technicians = employeeData.filter(
        (employee) => employee.role === "TECHNICIAN"
      );

      const verifiers = employeeData.filter(
        (employee) => employee.role === "VERIFIER"
      );

      if (!technicianId && technicians.length > 0) {
        setTechnicianId(technicians[0].identityId);
      }

      if (!verifierId && verifiers.length > 0) {
        setVerifierId(verifiers[0].identityId);
      }
    } catch (error) {
      setMessage("Failed to load jobs and employees.");
    }
  };

  useEffect(() => {
    loadData();
  }, []);

  // --------------------------------------------------
  // Employees by role
  // --------------------------------------------------

  const technicians = employees.filter(
    (employee) => employee.role === "TECHNICIAN"
  );

  const verifiers = employees.filter(
    (employee) => employee.role === "VERIFIER"
  );

  // --------------------------------------------------
  // Create Job
  // --------------------------------------------------

  const handleCreateJob = async () => {
    if (!assetId.trim()) {
      setMessage("Please enter an Asset ID.");
      return;
    }

    if (!technicianId) {
      setMessage("Please select a technician.");
      return;
    }

    if (!verifierId) {
      setMessage("Please select a verifier.");
      return;
    }

    setLoading(true);
    setMessage("");

    try {
      // Create the job with the selected verifier
      const createdJob = await mockApi.createJob({
        assetId: assetId.trim(),
        priority,
        verifierId,
      });

      // Assign the selected technician
      const assignedJob = await mockApi.assignJob(
        createdJob.jobId,
        {
          technicianId,
        }
      );

      setJobs((currentJobs) => [
        ...currentJobs,
        assignedJob,
      ]);

      // Reset form
      setAssetId("AST-001");
      setPriority("MEDIUM");

      if (technicians.length > 0) {
        setTechnicianId(
          technicians[0].identityId
        );
      } else {
        setTechnicianId("");
      }

      if (verifiers.length > 0) {
        setVerifierId(
          verifiers[0].identityId
        );
      } else {
        setVerifierId("");
      }

      setShowForm(false);

      setMessage(
        `Job ${assignedJob.jobId} created and technician assigned successfully.`
      );
    } catch (error) {
      setMessage(
        error instanceof Error
          ? error.message
          : "Failed to create job."
      );
    } finally {
      setLoading(false);
    }
  };

  // --------------------------------------------------
  // Permission
  // --------------------------------------------------

  const canCreateJob = can(
    user.role,
    "CREATE_JOB"
  );

  // --------------------------------------------------
  // UI
  // --------------------------------------------------

  return (
    <div className="page">

      {/* Header */}
      <div className="page-header">
        <div>
          <h2>Jobs</h2>

          <p className="page-subtitle">
            Maintenance jobs and verification workflow
          </p>
        </div>

        <div className="page-count">
          {jobs.length} job
          {jobs.length !== 1 ? "s" : ""}
        </div>
      </div>

      {/* Actions */}
      <div className="page-actions">

        {canCreateJob && (
          <button
            type="button"
            onClick={() => {
              setShowForm(!showForm);
              setMessage("");
            }}
            disabled={loading}
          >
            {showForm ? "Cancel" : "Create Job"}
          </button>
        )}

        <button
          type="button"
          onClick={loadData}
          disabled={loading}
        >
          Refresh
        </button>

      </div>

      {/* Message */}
      {message && (
        <div className="dashboard-notice">
          <p>{message}</p>
        </div>
      )}

      {/* Create Job Form */}
      {showForm && canCreateJob && (
        <div className="dashboard-section">

          <h3>Create Job</h3>

          <div className="dashboard-info-grid">

            {/* Asset ID */}
            <div className="dashboard-info-item">
              <label className="label">
                Asset ID
              </label>

              <input
                type="text"
                value={assetId}
                placeholder="Example: AST-001"
                onChange={(e) =>
                  setAssetId(e.target.value)
                }
                disabled={loading}
              />
            </div>

            {/* Priority */}
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
                  )
                }
                disabled={loading}
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
              </select>
            </div>

            {/* Technician */}
            <div className="dashboard-info-item">

              <label className="label">
                Technician
              </label>

              {technicians.length === 0 ? (
                <p>
                  No technicians available.
                  Create a TECHNICIAN employee first.
                </p>
              ) : (
                <select
                  value={technicianId}
                  onChange={(e) =>
                    setTechnicianId(
                      e.target.value
                    )
                  }
                  disabled={loading}
                >
                  <option value="">
                    Select Technician
                  </option>

                  {technicians.map(
                    (technician) => (
                      <option
                        key={
                          technician.identityId
                        }
                        value={
                          technician.identityId
                        }
                      >
                        {technician.employeeId}
                      </option>
                    )
                  )}
                </select>
              )}

            </div>

            {/* Verifier */}
            <div className="dashboard-info-item">

              <label className="label">
                Verifier
              </label>

              {verifiers.length === 0 ? (
                <p>
                  No verifiers available.
                  Create a VERIFIER employee first.
                </p>
              ) : (
                <select
                  value={verifierId}
                  onChange={(e) =>
                    setVerifierId(
                      e.target.value
                    )
                  }
                  disabled={loading}
                >
                  <option value="">
                    Select Verifier
                  </option>

                  {verifiers.map(
                    (verifier) => (
                      <option
                        key={
                          verifier.identityId
                        }
                        value={
                          verifier.identityId
                        }
                      >
                        {verifier.employeeId}
                      </option>
                    )
                  )}
                </select>
              )}

            </div>

          </div>

          {/* Create Button */}
          <div className="workspace-actions">

            <button
              type="button"
              onClick={handleCreateJob}
              disabled={
                loading ||
                technicians.length === 0 ||
                verifiers.length === 0
              }
            >
              {loading
                ? "Creating..."
                : "Create Job"}
            </button>

          </div>

        </div>
      )}

      {/* Job List */}
      <div className="dashboard-section">

        <h3>Job List</h3>

        {jobs.length === 0 ? (
          <div className="empty-state">
            No jobs available.
          </div>
        ) : (
          <div className="jobs-list">

            {jobs.map((job) => {

              const technician =
                employees.find(
                  (employee) =>
                    employee.identityId ===
                    job.assignedTo
                );

              const verifier =
                employees.find(
                  (employee) =>
                    employee.identityId ===
                    job.verifierId
                );

              return (
                <div
                  className="job-row"
                  key={job.jobId}
                >

                  <div className="job-main">

                    <div className="job-id">
                      {job.jobId}
                    </div>

                    <div className="job-asset">
                      Asset {job.assetId}
                    </div>

                  </div>

                  <div className="job-info">

                    <span>
                      {job.priority}
                    </span>

                    <span className="job-status">
                      {job.status}
                    </span>

                    <span>
                      Technician:{" "}
                      {technician
                        ? technician.employeeId
                        : "Not assigned"}
                    </span>

                    <span>
                      Verifier:{" "}
                      {verifier
                        ? verifier.employeeId
                        : "Not assigned"}
                    </span>

                    <button
                      type="button"
                      onClick={() =>
                        onOpenJob(job.jobId)
                      }
                    >
                      Open
                    </button>

                  </div>

                </div>
              );
            })}

          </div>
        )}

      </div>

    </div>
  );
}