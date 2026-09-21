// Owner: Person 6. Application shell: session state, navigation, and
// role gating. Navigation is filtered through the same shared/rbac
// matrix the backend enforces, so a page a role cannot use never
// appears — and the two can't drift, because there is only one table.
//
// This is a shell, not a finished design. Replace freely; the only
// things other people depend on are (a) that gating reads from
// shared/rbac and (b) that every page talks to the API module, never
// to a chain directly.

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
import { ValidatorManagementPage } from "./validators/ValidatorManagementPage";

type View =
  | { name: "dashboard" }
  | { name: "assets" }
  | { name: "asset"; assetId: string }
  | { name: "jobs" }
  | { name: "job"; jobId: string }
  | { name: "employees" }
  | { name: "audit"; assetId: string }
  | { name: "validators" }
  | { name: "validator-management" };

type NavItem = {
  label: string;
  view: View;
  /** Page is hidden unless the role passes this action in the matrix. */
  requires?: Action;
};

const NAV: NavItem[] = [
  { label: "Overview", view: { name: "dashboard" } },
  { label: "Assets", view: { name: "assets" } },
  { label: "Jobs", view: { name: "jobs" } },
  { label: "Employees", view: { name: "employees" }, requires: "CREATE_EMPLOYEE" },
  { label: "Audit trail", view: { name: "audit", assetId: "AST-001" }, requires: "VIEW_AUDIT_HISTORY" },
  { label: "Network", view: { name: "validators" }, requires: "VIEW_VALIDATOR_STATUS" },
  { label: "Validator management", view: { name: "validator-management" }, requires: "MANAGE_VALIDATORS" },
];

export function App() {
  const [user, setUser] = useState<User | null>(null);
  const [view, setView] = useState<View>({ name: "dashboard" });

  if (!user) {
    return (
      <main className="gate">
        <LoginPage onLogin={setUser} />
      </main>
    );
  }

  // An OWN cell (Technician + audit history) resolves per-record, which
  // the nav can't know, so show the entry and let the page/API decide.
  const visible = NAV.filter(
    (item) => !item.requires || can(user.role, item.requires) || item.requires === "VIEW_AUDIT_HISTORY"
  );

  return (
    <div className="shell">
      <header className="topbar">
        <span className="wordmark">BEL Console</span>
        <div className="session">
          <span>{user.employeeId}</span>
          <span className="divider" aria-hidden="true" />
          <span>{user.role.toLowerCase()}</span>
          <span className="divider" aria-hidden="true" />
          <code className="wallet" title="Device-bound wallet">
            {user.walletAddress}
          </code>
          <button className="ghost" onClick={() => setUser(null)}>
            Sign out
          </button>
        </div>
      </header>

      <div className="body">
        <nav className="rail" aria-label="Sections">
          {visible.map((item) => (
            <button
              key={item.label}
              className={view.name === item.view.name ? "railItem active" : "railItem"}
              onClick={() => setView(item.view)}
            >
              {item.label}
            </button>
          ))}
        </nav>

        <main className="content">
          {view.name === "dashboard" && <DashboardRouter user={user} />}

          {view.name === "assets" && (
            <AssetsPage onSelect={(assetId) => setView({ name: "asset", assetId })} />
          )}
          {view.name === "asset" && (
            <>
              <BackTo label="All assets" onClick={() => setView({ name: "assets" })} />
              <AssetDetailPage
                assetId={view.assetId}
                onViewAudit={(assetId) => setView({ name: "audit", assetId })}
              />
            </>
          )}

          {view.name === "jobs" && (
            <JobsPage onSelect={(jobId) => setView({ name: "job", jobId })} />
          )}
          {view.name === "job" && (
            <>
              <BackTo label="All jobs" onClick={() => setView({ name: "jobs" })} />
              <JobDetailPage jobId={view.jobId} />
            </>
          )}

          {view.name === "employees" && <EmployeesPage />}
          {view.name === "audit" && <AuditTrailPage assetId={view.assetId} />}
          {view.name === "validators" && <ValidatorStatusPage />}
          {view.name === "validator-management" && <ValidatorManagementPage />}
        </main>
      </div>
    </div>
  );
}

function BackTo({ label, onClick }: { label: string; onClick: () => void }) {
  return (
    <button className="ghost back" onClick={onClick}>
      Back to {label}
    </button>
  );
}
