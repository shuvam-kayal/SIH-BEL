// Owner: Person 6. Routes each Role (docs/RBAC_MATRIX.md) to its
// dashboard. Each role's dashboard is currently the same shell with a
// role label — flesh out per-role widgets (e.g. Auditor sees an
// audit-heavy view, Technician sees assigned jobs only) as the other
// modules mature.

import { User } from "../../../shared/types";

export function DashboardRouter({ user }: { user: User }) {
  return (
    <div>
      <h2>{user.role} Dashboard</h2>
      <p>Logged in as {user.employeeId} ({user.department})</p>
      {/* TODO: role-specific widgets. See docs/RBAC_MATRIX.md for what
          each role can see/do — gate visibility here, not just actions. */}
    </div>
  );
}
