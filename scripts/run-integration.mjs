import { spawnSync } from "node:child_process";

if (!process.env.DATABASE_URL) {
  console.error("PostgreSQL integration tests require DATABASE_URL; refusing to fall back to in-memory repositories.");
  process.exit(1);
}
const result = spawnSync(process.execPath, ["node_modules/vitest/vitest.mjs", "run", "backend/test/integration.persistence.test.ts"], {
  stdio: "inherit",
  env: { ...process.env, BEL_RUN_INTEGRATION: "true" },
});
process.exit(result.status ?? 1);
