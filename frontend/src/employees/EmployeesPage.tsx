// Owner: Person 6. Backs POST /admin/users and POST
// /admin/users/:id/revoke-wallet. Per docs/RBAC_MATRIX.md, "Create
// employee" and "Revoke wallet" are Admin-only — hide this whole page
// for any other role.

export function EmployeesPage() {
  return (
    <div>
      <h2>Employees</h2>
      {/* TODO: employee list, create-employee form, revoke-wallet action.
          mockApi.createUser / mockApi.revokeWallet cover the calls. */}
    </div>
  );
}
