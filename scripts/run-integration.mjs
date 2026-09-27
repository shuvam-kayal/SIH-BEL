import { spawnSync } from "node:child_process";

if (!process.env.DATABASE_URL) {
  console.error("PostgreSQL integration tests require DATABASE_URL; refusing to fall back to in-memory repositories.");
  process.exit(1);
}
const result = spawnSync(process.execPath, ["node_modules/vitest/vitest.mjs", "run", "backend/test/integration.persistence.test.ts"], {
  stdio: "inherit",
  // This suite deliberately tests PostgreSQL persistence with the explicit
  // MockBlockchainAdapter. Do not inherit BEL_BLOCKCHAIN=evm from a Besu
  // integration shell and apply EVM-only provisioning rules to this suite.
  env: { ...process.env, BEL_BLOCKCHAIN: "mock", BEL_RUN_INTEGRATION: "true" },
});
process.exit(result.status ?? 1);
