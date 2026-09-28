import type { User } from "../../../shared/types";
import { can } from "../../../shared/rbac";
import { apiClient, HttpApiError } from "../api/client";
import { useEffect, useState } from "react";
import { Badge, Card, ErrorNotice, Loading, PageHead, Stat, Button } from "../ui";

type Navigate = (view: { name: "assets" } | { name: "jobs" } | { name: "employees" } | { name: "validators" } | { name: "audit"; assetId: string }) => void;
export function DashboardRouter({ user, onNavigate }: { user: User; onNavigate: Navigate }) {
  const [counts, setCounts] = useState<{ assets: number | null; jobs: number | null; pending: number | null }>({ assets: null, jobs: null, pending: user.role === "ADMIN" ? null : 0 });
  const [errors, setErrors] = useState<{ assets: string; jobs: string; pending: string }>({ assets: "", jobs: "", pending: "" });
  const [loaded, setLoaded] = useState(false);
  useEffect(() => {
    let mounted = true;
    const load = async () => {
      const [assets, jobs, pending] = await Promise.allSettled([
        apiClient.getAssets(),
        apiClient.getJobs(),
        user.role === "ADMIN" ? apiClient.getPendingRegistrations() : Promise.resolve([]),
      ]);
      if (!mounted) return;
      const message = (reason: unknown, fallback: string) => reason instanceof HttpApiError && reason.status === 501 ? "Backend module is not implemented yet." : reason instanceof Error ? reason.message : fallback;
      setCounts({
        assets: assets.status === "fulfilled" ? assets.value.length : null,
        jobs: jobs.status === "fulfilled" ? jobs.value.length : null,
        pending: pending.status === "fulfilled" ? pending.value.length : null,
      });
      setErrors({
        assets: assets.status === "rejected" ? message(assets.reason, "Unable to load assets.") : "",
        jobs: jobs.status === "rejected" ? message(jobs.reason, "Unable to load jobs.") : "",
        pending: pending.status === "rejected" ? message(pending.reason, "Unable to load pending registrations.") : "",
      });
      setLoaded(true);
    };
    void load();
    return () => { mounted = false; };
  }, [user.role]);
  if (!loaded) return <Loading />;
  return <><PageHead eyebrow="Employee workspace" title={`Welcome back, ${user.employeeId}`} description="Your identity and access status are shown below. Business actions are available according to the shared BEL authorization matrix." action={<Badge tone="active">AUTHENTICATED</Badge>} /><div className="grid grid-3" style={{ marginBottom: 20 }}><Stat label="Identity status" value={user.status} tone={user.status === "ACTIVE" ? "success" : "warning"} /><Stat label="Assigned role" value={user.role} /><Stat label="Session wallet" value={user.walletAddress ? "BOUND" : "NOT AVAILABLE"} tone={user.walletAddress ? "success" : "warning"} /></div><div className="layout"><Card><h2>Identity and security</h2><div className="kv"><div className="k">Employee</div><div className="v">{user.employeeId}</div><div className="k">Department</div><div className="v">{user.department}</div><div className="k">Identity anchor</div><div className="v mono">{user.identityId}</div><div className="k">Active wallet</div><div className="v mono">{user.walletAddress || "Not returned by backend"}</div></div></Card><Card><h2>Workspace</h2><p className="muted">Open a module to continue your authorized work.</p><div className="actions" style={{ display: "grid" }}><Button variant="secondary" onClick={() => onNavigate({ name: "assets" })}>View assets <span>→</span></Button>{can(user.role, "CREATE_JOB") && <Button variant="secondary" onClick={() => onNavigate({ name: "jobs" })}>Manage maintenance jobs <span>→</span></Button>}<Button variant="secondary" onClick={() => onNavigate({ name: "validators" })}>Network health <span>→</span></Button></div><p className="help" style={{ marginTop: 16 }}>Backend authorization remains the enforcement boundary.</p></Card></div><div className="grid grid-3" style={{ marginTop: 20 }}><Card><Stat label="Tracked assets" value={counts.assets ?? "Unavailable"} />{errors.assets && <ErrorNotice message={errors.assets} />}</Card><Card><Stat label="Maintenance jobs" value={counts.jobs ?? "Unavailable"} />{errors.jobs && <ErrorNotice message={errors.jobs} />}</Card><Card><Stat label="Pending registrations" value={user.role === "ADMIN" ? counts.pending ?? "Unavailable" : "—"} />{user.role === "ADMIN" && errors.pending && <ErrorNotice message={errors.pending} />}</Card></div></>;
}
