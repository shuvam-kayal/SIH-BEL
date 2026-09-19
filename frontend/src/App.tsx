import { useState } from "react";
import { can, type Action } from "../../shared/rbac";
import type { User } from "../../shared/types";

import { LoginPage } from "./auth/LoginPage";
import { DashboardRouter } from "./dashboard/DashboardRouter";

import { AssetsPage } from "./assets/AssetsPage";
import { AssetDetailPage } from "./assets/AssetDetailPage";

import { JobsPage } from "./jobs/JobsPage";
import { JobDetailPage } from "./jobs/JobDetailPage";

import { EmployeesPage } from "./employees/EmployeesPage";
import { AuditTrailPage } from "./audit/AuditTrailPage";
import { ValidatorStatusPage } from "./validators/ValidatorStatusPage";

export function App() {
  const [user, setUser] = useState<User | null>(null);
  const [page, setPage] = useState("overview");
  const [selectedAssetId, setSelectedAssetId] = useState<string | null>(null);
  const [selectedJobId, setSelectedJobId] = useState<string | null>(null);

  if (!user) {
    return <LoginPage onLogin={setUser} />;
  }

  const goTo = (nextPage: string) => {
    setPage(nextPage);
    setSelectedAssetId(null);
    setSelectedJobId(null);
  };

  const allowed = (action: Action) => can(user.role, action);

  return (
    <div className="app-shell">
      <header className="app-header">
        <div>
          <h1>BEL Asset Management</h1>
          <p>Blockchain-based Asset Lifecycle Management</p>
        </div>

        <div className="user-info">
          <span>{user.employeeId}</span>
          <span>{user.role}</span>

          <button
            type="button"
            onClick={() => {
              setUser(null);
              setPage("overview");
            }}
          >
            Logout
          </button>
        </div>
      </header>

      <nav className="main-nav">
        <button type="button" onClick={() => goTo("overview")}>
          Overview
        </button>

        <button type="button" onClick={() => goTo("assets")}>
          Assets
        </button>

        {allowed("CREATE_JOB") && (
          <button type="button" onClick={() => goTo("jobs")}>
            Jobs
          </button>
        )}

        {allowed("CREATE_EMPLOYEE") && (
          <button type="button" onClick={() => goTo("employees")}>
            Employees
          </button>
        )}

        {allowed("VIEW_AUDIT_HISTORY") && (
          <button type="button" onClick={() => goTo("audit")}>
            Audit Trail
          </button>
        )}

        {allowed("VIEW_VALIDATOR_STATUS") && (
          <button type="button" onClick={() => goTo("validators")}>
            Network
          </button>
        )}
      </nav>

      <main className="app-content">
        {page === "overview" && (
          <DashboardRouter
            user={user}
            onViewAssets={() => goTo("assets")}
            onCreateJob={() => goTo("jobs")}
            onPerformMaintenance={() => goTo("jobs")}
            onViewAudit={() => goTo("audit")}
          />
        )}

        {page === "assets" && !selectedAssetId && (
          <AssetsPage
            user={user}
            onSelect={(assetId) => {
              setSelectedAssetId(assetId);
            }}
          />
        )}

        {page === "assets" && selectedAssetId && (
          <AssetDetailPage
            assetId={selectedAssetId}
            user={user}
            onViewAudit={(assetId) => {
              setSelectedAssetId(assetId);
              setPage("audit");
            }}
          />
        )}

        {page === "jobs" && !selectedJobId && (
          <JobsPage
            user={user}
            onSelect={(jobId) => {
              setSelectedJobId(jobId);
            }}
          />
        )}

        {page === "jobs" && selectedJobId && (
          <>
            <div className="workspace-actions">
              <button type="button" onClick={() => setSelectedJobId(null)}>
                Back to jobs
              </button>
            </div>

            <JobDetailPage jobId={selectedJobId} user={user} />
          </>
        )}

        {page === "employees" && <EmployeesPage user={user} />}

        {page === "audit" && (
          <AuditTrailPage assetId={selectedAssetId ?? ""} />
        )}

        {page === "validators" && <ValidatorStatusPage />}
      </main>
    </div>
  );
}