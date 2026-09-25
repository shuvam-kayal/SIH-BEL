import { spawnSync } from "node:child_process";

const result = spawnSync(process.execPath, [new URL("./test-e2e-workflow.mjs", import.meta.url)], {
  stdio: "inherit",
  env: {
    ...process.env,
    BEL_BLOCKCHAIN: "evm",
    BEL_CHAIN_DEPLOYMENT: process.env.BEL_CHAIN_DEPLOYMENT || "besu-prototype",
    BEL_CHAIN_RPC_URL: process.env.BEL_CHAIN_RPC_URL || "http://127.0.0.1:8645",
    BEL_E2E_RPC_URL: process.env.BEL_E2E_RPC_URL || "http://127.0.0.1:8645",
    BEL_E2E_CHAIN_ID: process.env.BEL_E2E_CHAIN_ID || "20260920",
    BEL_E2E_DEPLOYED: "true",
    BEL_ALLOW_UNFUNDED_EVM: "true",
    BEL_EXECUTION_PROFILE: "prototype",
    BEL_NETWORK: "besu-prototype",
    BEL_BOOTSTRAP_VALIDATOR_COUNT: "4",
    BEL_E2E_RESET: "false",
  },
});
process.exit(result.status ?? 1);
