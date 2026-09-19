import { useState } from "react";

import { LoginPage } from "./auth/LoginPage";
import { DashboardRouter } from "./dashboard/DashboardRouter";

import { AssetsPage } from "./assets/AssetsPage";
import { AssetDetailPage } from "./assets/AssetDetailPage";

import { JobsPage } from "./jobs/JobsPage";
import { JobDetailPage } from "./jobs/JobDetailPage";

import { EmployeesPage } from "./employees/EmployeesPage";
import { AuditTrailPage } from "./audit/AuditTrailPage";
import { ValidatorStatusPage } from "./validators/ValidatorStatusPage";

import type { User } from "../../shared/types";
import { can } from "../../shared/rbac";

import "./styles.css";

type Page =
  | "dashboard"
  | "assets"
  | "jobs"
  | "employees"
  | "audit"
  | "validators"
  | "asset-detail"
  | "job-detail";

export function App() {
  const [user, setUser] = useState<User | null>(null);

  const [page, setPage] =
    useState<Page>("dashboard");

  const [selectedAssetId, setSelectedAssetId] =
    useState<string>("");

  const [selectedJobId, setSelectedJobId] =
    useState<string>("");

  /*
   * Login
   */
  if (!user) {
    return (
      <LoginPage
        onLogin={(loggedInUser) => {
          setUser(loggedInUser);
          setPage("dashboard");
        }}
      />
    );
  }

  /*
   * Navigation helper
   */
  function goTo(nextPage: Page) {
    setPage(nextPage);
  }

  /*
   * Logout
   */
  function handleLogout() {
    setUser(null);
    setPage("dashboard");
    setSelectedAssetId("");
    setSelectedJobId("");
  }

  return (
    <div className="app-shell">

      {/* HEADER */}
      <header className="app-header">

        <div>
          <h1>BEL Asset Management</h1>

          <p>
            Blockchain-based Asset Lifecycle Management
          </p>
        </div>

        <div className="user-info">

          <span>
            {user.employeeId}
          </span>

          <span>
            {user.role}
          </span>

          <button
            type="button"
            onClick={handleLogout}
          >
            Logout
          </button>

        </div>

      </header>


      {/* NAVIGATION */}
      <nav className="main-nav">

        <button
          type="button"
          onClick={() => goTo("dashboard")}
        >
          Dashboard
        </button>


        <button
          type="button"
          onClick={() => goTo("assets")}
        >
          Assets
        </button>


        {(can(user.role, "CREATE_JOB") ||
          can(user.role, "PERFORM_MAINTENANCE") ||
          can(user.role, "VERIFY_MAINTENANCE")) && (
          <button
            type="button"
            onClick={() => goTo("jobs")}
          >
            Jobs
          </button>
        )}


        {can(user.role, "CREATE_EMPLOYEE") && (
          <button
            type="button"
            onClick={() => goTo("employees")}
          >
            Employee Management
          </button>
        )}


        {/* AUDIT TRAIL */}
        {can(user.role, "VIEW_AUDIT_HISTORY") && (
          <button
            type="button"
            onClick={() => goTo("audit")}
          >
            Audit Trail
          </button>
        )}


        {/* VALIDATOR STATUS */}
        {can(user.role, "VIEW_VALIDATOR_STATUS") && (
          <button
            type="button"
            onClick={() => goTo("validators")}
          >
            Validator Status
          </button>
        )}

      </nav>


      {/* MAIN CONTENT */}
      <main className="app-content">


        {/* DASHBOARD */}
        {page === "dashboard" && (
          <DashboardRouter
            user={user}

            onViewAssets={() =>
              goTo("assets")
            }

            onCreateJob={() =>
              goTo("jobs")
            }

            onPerformMaintenance={() =>
              goTo("jobs")
            }

            onViewAudit={() =>
              goTo("audit")
            }
          />
        )}


        {/* ASSETS */}
        {page === "assets" && (
          <AssetsPage
            user={user}
            onSelect={(assetId: string) => {
              setSelectedAssetId(assetId);
              goTo("asset-detail");
            }}
          />
        )}


        {/* ASSET DETAIL */}
        {page === "asset-detail" && (
          <AssetDetailPage
            assetId={selectedAssetId}
            user={user}

            onViewAudit={(assetId: string) => {
              setSelectedAssetId(assetId);
              goTo("audit");
            }}
          />
        )}


        {/* JOBS */}
        {page === "jobs" && (
          <JobsPage
            user={user}
            onOpenJob={(jobId: string) => {
              setSelectedJobId(jobId);
              setPage("job-detail");
            }}
          />
        )}


        {/* JOB DETAIL */}
        {page === "job-detail" && (
          <JobDetailPage
            jobId={selectedJobId}
            user={user}
          />
        )}


        {/* EMPLOYEE MANAGEMENT */}
        {page === "employees" &&
          can(user.role, "CREATE_EMPLOYEE") && (
            <EmployeesPage
              user={user}
            />
          )}


        {/* AUDIT TRAIL */}
        {page === "audit" &&
          can(user.role, "VIEW_AUDIT_HISTORY") && (
            <AuditTrailPage
              assetId={selectedAssetId}
            />
          )}


        {/* VALIDATOR STATUS */}
        {page === "validators" &&
          can(user.role, "VIEW_VALIDATOR_STATUS") && (
            <ValidatorStatusPage />
          )}

      </main>

    </div>
  );
}