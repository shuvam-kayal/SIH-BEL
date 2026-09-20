import { useEffect, useState } from "react";
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
import { Brand, Button } from "./ui";
import { apiClient, onSessionExpired } from "./api/client";

type View = { name: "dashboard" } | { name: "assets" } | { name: "asset"; assetId: string } | { name: "jobs" } | { name: "job"; jobId: string } | { name: "employees" } | { name: "audit"; assetId: string } | { name: "validators" };
type NavItem = { label: string; icon: string; view: View; requires?: Action };
const NAV: NavItem[] = [
  { label: "Overview", icon: "⌂", view: { name: "dashboard" } }, { label: "Assets", icon: "◈", view: { name: "assets" } },
  { label: "Maintenance jobs", icon: "▣", view: { name: "jobs" } }, { label: "Employees", icon: "♙", view: { name: "employees" }, requires: "CREATE_EMPLOYEE" },
  { label: "Network", icon: "⌁", view: { name: "validators" }, requires: "VIEW_VALIDATOR_STATUS" },
];
export function App() {
  const [user, setUser] = useState<User | null>(null); const [view, setView] = useState<View>({ name: "dashboard" });
  const [restoring, setRestoring] = useState(true);
  useEffect(() => { let mounted = true; const unsubscribe = onSessionExpired(() => { if (mounted) setUser(null); }); apiClient.restoreSession().then((session) => { if (mounted && session) setUser(session.user); }).catch(() => apiClient.clearSession()).finally(() => { if (mounted) setRestoring(false); }); return () => { mounted = false; unsubscribe(); }; }, []);
  if (restoring) return <main className="gate"><div className="loading">Restoring secure BEL session…</div></main>;
  if (!user) return <main className="gate"><LoginPage onLogin={(next) => { setUser(next); setView({ name: "dashboard" }); }} /></main>;
  const visible = NAV.filter((item) => !item.requires || can(user.role, item.requires)); const go = (next: View) => setView(next);
  return <div className="shell"><header className="topbar"><Brand /><div className="topnav"><span className="topnav-label">OPERATIONS CONSOLE</span></div><div className="userbar"><div className="user-chip"><strong>{user.employeeId}</strong><span>{user.role}</span></div><Button variant="ghost" onClick={() => { void apiClient.logout().catch(() => undefined); setUser(null); }}>Sign out</Button></div></header>
    <div className="body"><nav className="rail" aria-label="Sections"><div className="rail-caption">WORKSPACE</div>{visible.map((item) => <button key={item.label} className={view.name === item.view.name ? "railItem active" : "railItem"} onClick={() => go(item.view)}><span className="nav-icon">{item.icon}</span>{item.label}</button>)}</nav>
      <main className="content">{view.name === "dashboard" && <DashboardRouter user={user} onNavigate={go} />}{view.name === "assets" && <AssetsPage user={user} onSelect={(assetId) => go({ name: "asset", assetId })} />}{view.name === "asset" && <><BackTo label="All assets" onClick={() => go({ name: "assets" })} /><AssetDetailPage assetId={view.assetId} user={user} onViewAudit={(assetId) => go({ name: "audit", assetId })} /></>}{view.name === "jobs" && <JobsPage user={user} onSelect={(jobId) => go({ name: "job", jobId })} />}{view.name === "job" && <><BackTo label="All jobs" onClick={() => go({ name: "jobs" })} /><JobDetailPage jobId={view.jobId} user={user} /></>}{view.name === "employees" && <EmployeesPage />}{view.name === "audit" && <AuditTrailPage assetId={view.assetId} />}{view.name === "validators" && <ValidatorStatusPage />}</main></div><footer className="footer"><Brand compact /><span>Authorized use only · Session authenticated</span></footer></div>;
}
function BackTo({ label, onClick }: { label: string; onClick: () => void }) { return <Button variant="ghost" className="back" onClick={onClick}>← Back to {label}</Button>; }
