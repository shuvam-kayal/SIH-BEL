import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const env = {
  ...process.env,
  BEL_BLOCKCHAIN: "mock",
  BEL_RUN_INTEGRATION: "false",
  BEL_RUN_E2E: "false",
};

// A Besu shell session may leave EVM-only variables in the environment.  The
// unit suite must not become dependent on that external chain or its signer.
for (const key of [
  "BEL_CHAIN_DEV_SIGNER_KEYS",
  "BEL_E2E_PRIVATE_KEYS",
  "BEL_EVM_RPC_URL",
  "BEL_CHAIN_RPC_URL",
  "BEL_E2E_RPC_URL",
  "BEL_CHAIN_DEPLOYMENT",
  "BEL_E2E_CHAIN_ID",
  "BEL_BESU_RUN_ROOT",
]) {
  delete env[key];
}

const vitestPath = fileURLToPath(new URL("../node_modules/vitest/vitest.mjs", import.meta.url));
const result = spawnSync(process.execPath, [vitestPath, "run", "--pool=forks", "--no-file-parallelism",
  "--exclude", "test/{workflow.e2e.test.ts,*.evm.integration.test.ts}",
], {
  cwd: fileURLToPath(new URL("../backend/", import.meta.url)),
  stdio: "inherit",
  env,
});

process.exit(result.status ?? 1);
