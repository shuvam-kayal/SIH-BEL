// Owner: Person 6. Backs POST /admin/users and
// POST /admin/users/:id/revoke-wallet.
// Create employee and revoke wallet are Admin-only.

import { useEffect, useState } from "react";
import { mockApi } from "../api/mockApi";
import type { User } from "../../../shared/types";
import { can } from "../../../shared/rbac";

export function EmployeesPage({
  user,
}: {
  user: User;
}) {
  const [employees, setEmployees] = useState<User[]>([]);
  const [showForm, setShowForm] = useState(false);

  const [employeeId, setEmployeeId] = useState("");
  const [fullName, setFullName] = useState("");
  const [role, setRole] = useState<
    "ADMIN" | "MANAGER" | "ENGINEER" | "TECHNICIAN" | "AUDITOR" | "ISSUER" | "VERIFIER"
  >("ENGINEER");
  const [department, setDepartment] = useState("");

  const [message, setMessage] = useState("");

  useEffect(() => {
    // The mock API currently exposes getUser(), not getUsers().
    // The initial demo user is therefore shown here.
    mockApi.getUser("EMP001").then((existingUser) => {
      if (existingUser) {
        setEmployees([existingUser]);
      }
    });
  }, []);

  if (!can(user.role, "CREATE_EMPLOYEE")) {
    return (
      <div className="page">
        <h2>Employees</h2>
        <p className="page-subtitle">
          Employee management is available only to administrators.
        </p>
      </div>
    );
  }

  const handleCreateEmployee = async () => {
    if (!employeeId || !fullName || !department) {
      setMessage("Please fill in all fields.");
      return;
    }

    try {
      const response = await mockApi.createUser({
        employeeId,
        fullName,
        role,
        department,
      });

      setEmployees((currentEmployees) => [
        ...currentEmployees,
        response.user,
      ]);

      setEmployeeId("");
      setFullName("");
      setRole("ENGINEER");
      setDepartment("");
      setShowForm(false);
      setMessage("Employee created successfully.");
    } catch (error) {
      setMessage("Failed to create employee.");
    }
  };

  const handleRevokeWallet = async (employee: User) => {
    try {
      await mockApi.revokeWallet(
        employee.employeeId,
        "Wallet revoked by administrator"
      );

      setMessage(
        `Wallet revoked for ${employee.employeeId}.`
      );
    } catch (error) {
      setMessage(
        `Could not revoke wallet for ${employee.employeeId}.`
      );
    }
  };

  return (
    <div className="page">
      <div className="page-header">
        <div>
          <h2>Employees</h2>
          <p className="page-subtitle">
            Manage BEL employees and wallet access
          </p>
        </div>

        <div className="page-count">
          {employees.length} employee
          {employees.length !== 1 ? "s" : ""}
        </div>
      </div>

      <div className="page-actions">
        <button
          type="button"
          onClick={() => {
            setShowForm(!showForm);
            setMessage("");
          }}
        >
          {showForm ? "Cancel" : "Create Employee"}
        </button>
      </div>

      {message && (
        <div className="dashboard-notice">
          <p>{message}</p>
        </div>
      )}

      {showForm && (
        <div className="dashboard-section">
          <h3>Create Employee</h3>

          <div className="dashboard-info-grid">
            <div className="dashboard-info-item">
              <label className="label">
                Employee ID
              </label>

              <input
                type="text"
                placeholder="Example: EMP002"
                value={employeeId}
                onChange={(e) =>
                  setEmployeeId(e.target.value)
                }
              />
            </div>

            <div className="dashboard-info-item">
              <label className="label">
                Full Name
              </label>

              <input
                type="text"
                placeholder="Example: Arun Kumar"
                value={fullName}
                onChange={(e) =>
                  setFullName(e.target.value)
                }
              />
            </div>

            <div className="dashboard-info-item">
              <label className="label">
                Role
              </label>

              <select
                value={role}
                onChange={(e) =>
                  setRole(
                    e.target.value as
                      | "ADMIN"
                      | "MANAGER"
                      | "ENGINEER"
                      | "TECHNICIAN"
                      | "AUDITOR"
                      | "ISSUER"
                      | "VERIFIER"
                  )
                }
              >
                <option value="ADMIN">ADMIN</option>
                <option value="MANAGER">MANAGER</option>
                <option value="ENGINEER">ENGINEER</option>
                <option value="TECHNICIAN">TECHNICIAN</option>
                <option value="AUDITOR">AUDITOR</option>
                <option value="ISSUER">ISSUER</option>
                <option value="VERIFIER">VERIFIER</option>
              </select>
            </div>

            <div className="dashboard-info-item">
              <label className="label">
                Department
              </label>

              <input
                type="text"
                placeholder="Example: MAINTENANCE"
                value={department}
                onChange={(e) =>
                  setDepartment(e.target.value)
                }
              />
            </div>
          </div>

          <div className="workspace-actions">
            <button
              type="button"
              onClick={handleCreateEmployee}
            >
              Create
            </button>
          </div>
        </div>
      )}

      <div className="dashboard-section">
        <h3>Employee List</h3>

        {employees.length === 0 ? (
          <div className="empty-state">
            No employees available.
          </div>
        ) : (
          <div className="jobs-list">
            {employees.map((employee) => (
              <div
                className="job-row"
                key={employee.employeeId}
              >
                <div className="job-main">
                  <div className="job-id">
                    {employee.employeeId}
                  </div>

                  <div className="job-asset">
                    {employee.role} — {employee.department}
                  </div>
                </div>

                <div className="job-info">
                  <span className="job-status">
                    {employee.status}
                  </span>

                  <button
                    type="button"
                    onClick={() =>
                      handleRevokeWallet(employee)
                    }
                  >
                    Revoke Wallet
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}