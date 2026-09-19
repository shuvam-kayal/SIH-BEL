import { useState } from "react";
import { mockApi } from "../api/mockApi";
import type { User } from "../../../shared/types";

export function LoginPage({
  onLogin,
}: {
  onLogin: (user: User) => void;
}) {
  const [employeeId, setEmployeeId] = useState("");
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState("");

  async function handleSignIn() {
    if (!employeeId.trim()) {
      setMessage("Please enter your Employee ID.");
      return;
    }

    setLoading(true);
    setMessage("");

    try {
      // The role is taken from the employee's stored account.
      // The employee cannot choose or change their role here.
      const { user } = await mockApi.loginWithEmployeeId(
        employeeId.trim()
      );

      onLogin(user);
    } catch (error) {
      setMessage(
        error instanceof Error
          ? error.message
          : "Sign in failed."
      );
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="login-page">
      <div className="login-card">

        <h1>BEL Console</h1>

        <p className="page-subtitle">
          Secure BEL Asset Management Platform
        </p>

        <div className="dashboard-section">

          <h2>Sign In</h2>

          <p className="page-subtitle">
            Sign in using your assigned Employee ID.
          </p>

          <div className="dashboard-info-item">

            <label className="label">
              Employee ID
            </label>

            <input
              type="text"
              placeholder="Example: EMP001"
              value={employeeId}
              onChange={(e) =>
                setEmployeeId(e.target.value)
              }
            />

          </div>

          <div className="workspace-actions">

            <button
              type="button"
              onClick={handleSignIn}
              disabled={loading}
            >
              {loading
                ? "Signing in..."
                : "Sign In"}
            </button>

          </div>

          <p className="page-subtitle">
            Demo account: EMP001 (ENGINEER)
          </p>

        </div>

        {message && (
          <p className="page-subtitle">
            {message}
          </p>
        )}

      </div>
    </div>
  );
}