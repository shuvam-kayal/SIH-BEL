// Owner: Person 6. Backs POST /auth/login. Real device-credential flow
// TBD by Person 1 (SYSTEM_SPEC.md assumes a managed workstation, not a
// username/password form) — build the shell now, wire the real
// mechanism once auth.service.ts (backend) lands.

import { useState } from "react";
import { mockApi } from "../api/mockApi";
import { createPlatformAuthenticator } from "./platformAuthenticator";
import { User } from "../../../shared/types";

export function LoginPage({ onLogin }: { onLogin: (user: User) => void }) {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleLogin() {
    setLoading(true);
    setError(null);
    try {
      if (import.meta.env.PROD) {
        await createPlatformAuthenticator().signChallenge("");
        return;
      }
      const { user } = await mockApi.login();
      onLogin(user);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Platform authentication is unavailable");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div>
      <h1>BEL Platform</h1>
      <p>Managed-device session required. No public signup.</p>
      {error && <p role="alert">{error}</p>}
      <button onClick={handleLogin} disabled={loading}>
        {loading ? "Signing in..." : "Sign in"}
      </button>
    </div>
  );
}
