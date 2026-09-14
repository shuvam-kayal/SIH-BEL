// Owner: Person 6. Backs POST /auth/login. Real device-credential flow
// TBD by Person 1 (SYSTEM_SPEC.md assumes a managed workstation, not a
// username/password form) — build the shell now, wire the real
// mechanism once auth.service.ts (backend) lands.

import { useState } from "react";
import { mockApi } from "../api/mockApi";
import { User } from "../../../shared/types";

export function LoginPage({ onLogin }: { onLogin: (user: User) => void }) {
  const [loading, setLoading] = useState(false);

  async function handleLogin() {
    setLoading(true);
    try {
      const { user } = await mockApi.login();
      onLogin(user);
    } finally {
      setLoading(false);
    }
  }

  return (
    <div>
      <h1>BEL Platform</h1>
      <p>Managed-device session required. No public signup.</p>
      <button onClick={handleLogin} disabled={loading}>
        {loading ? "Signing in..." : "Sign in"}
      </button>
    </div>
  );
}
