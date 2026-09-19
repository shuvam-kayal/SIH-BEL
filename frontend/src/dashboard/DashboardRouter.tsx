
import type { User } from "../../../shared/types";
import { can } from "../../../shared/rbac";

export function DashboardRouter({
  user,
  onViewAssets,
  onCreateJob,
  onPerformMaintenance,
  onViewAudit,
}: {
  user: User;
  onViewAssets: () => void;
  onCreateJob: () => void;
  onPerformMaintenance: () => void;
  onViewAudit: () => void;
}) {
  return (
    <div className="dashboard">

      {/* Employee Workspace Header */}
      <div className="dashboard-header">
        <div>
          <div className="workspace-label">Employee workspace</div>

          <h1>Welcome back</h1>

          <p>
            Your identity and access status are shown below.
            Business modules are presented according to your authorized permissions.
          </p>
        </div>

        <span className="status status-ok">
          ACTIVE
        </span>
      </div>


      {/* Status Summary */}
      <div className="dashboard-cards">

        <div className="dashboard-card">
          <div className="label">Identity status</div>
          <div className="value">{user.status}</div>
        </div>

        <div className="dashboard-card">
          <div className="label">Assigned role</div>
          <div className="value">{user.role}</div>
        </div>

        <div className="dashboard-card">
          <div className="label">Wallet status</div>
          <div className="value">ACTIVE</div>
        </div>

      </div>


      {/* Identity */}
      <div className="dashboard-section">

        <h3>Identity</h3>

        <div className="dashboard-info-grid">

          <div className="dashboard-info-item">
            <span className="label">Employee ID</span>
            <span className="value">{user.employeeId}</span>
          </div>

          <div className="dashboard-info-item">
            <span className="label">Identity reference</span>
            <span className="value mono">
              {user.identityId}
            </span>
          </div>

          <div className="dashboard-info-item">
            <span className="label">Department</span>
            <span className="value">{user.department}</span>
          </div>

          <div className="dashboard-info-item">
            <span className="label">Role</span>
            <span className="value">{user.role}</span>
          </div>

          <div className="dashboard-info-item">
            <span className="label">Status</span>
            <span className="value status-text">
              {user.status}
            </span>
          </div>

        </div>

      </div>


      {/* Account Security */}
      <div className="dashboard-section">

        <h3>Account security</h3>

        <div className="dashboard-info-grid">

          <div className="dashboard-info-item">
            <span className="label">Wallet</span>
            <span className="value mono">
              {user.walletAddress}
            </span>
          </div>

          <div className="dashboard-info-item">
            <span className="label">Wallet status</span>
            <span className="value status-text">
              ACTIVE
            </span>
          </div>

          <div className="dashboard-info-item">
            <span className="label">Device credential</span>
            <span className="value status-text">
              Active
            </span>
          </div>

        </div>

      </div>


      {/* Workspace */}
      <div className="dashboard-section">

        <h3>Workspace</h3>

        <p className="workspace-description">
          Only actions authorized for the signed-in role should
          be rendered as available actions.
        </p>

        <div className="workspace-actions">

          {/* Viewing assets is available to all signed-in users */}
          <button
            type="button"
            onClick={onViewAssets}
          >
            View Assets
          </button>


          {/* CREATE_JOB */}
          {can(user.role, "CREATE_JOB") && (
            <button
              type="button"
              onClick={onCreateJob}
            >
              Create Job
            </button>
          )}


          {/* PERFORM_MAINTENANCE */}
          {can(user.role, "PERFORM_MAINTENANCE") && (
            <button
              type="button"
              onClick={onPerformMaintenance}
            >
              Perform Maintenance
            </button>
          )}


          {/* VIEW_AUDIT_HISTORY */}
          {can(user.role, "VIEW_AUDIT_HISTORY") && (
            <button
              type="button"
              onClick={onViewAudit}
            >
              View Audit
            </button>
          )}

        </div>

      </div>


      {/* Security Notice */}
      <div className="dashboard-notice">
        <p>
          The backend remains the enforcement boundary;
          frontend permission gating is for user experience.
        </p>
      </div>

    </div>
  );
}

