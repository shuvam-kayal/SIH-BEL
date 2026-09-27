import { spawnSync } from "node:child_process";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(fileURLToPath(new URL("..", import.meta.url)));
const runRoots = existsSync(resolve(root, ".bel-demo"))
  ? readdirSync(resolve(root, ".bel-demo"), { withFileTypes: true }).filter((entry) => entry.isDirectory() && entry.name.startsWith("smoke-")).map((entry) => resolve(root, ".bel-demo", entry.name)).sort().reverse()
  : [];
const runRoot = runRoots.find((candidate) => existsSync(resolve(candidate, "run.json")));
if (!process.env.BEL_E2E_PRIVATE_KEYS && runRoot) {
  const run = JSON.parse(readFileSync(resolve(runRoot, "run.json"), "utf8"));
  process.env.BEL_E2E_PRIVATE_KEYS = readFileSync(run.testAccountKeys, "utf8").split(/\r?\n/).map((value) => value.trim()).filter(Boolean).join(",");
}

const result = spawnSync(process.execPath, [fileURLToPath(new URL("./test-e2e-workflow.mjs", import.meta.url))], {
  stdio: "inherit",
  env: {
    ...process.env,
    BEL_BLOCKCHAIN: "evm",
    BEL_CHAIN_DEPLOYMENT: process.env.BEL_CHAIN_DEPLOYMENT || "besu-prototype",
    BEL_CHAIN_RPC_URL: process.env.BEL_CHAIN_RPC_URL || "http://127.0.0.1:8645",
    BEL_E2E_RPC_URL: process.env.BEL_E2E_RPC_URL || "http://127.0.0.1:8645",
    BEL_E2E_CHAIN_ID: process.env.BEL_E2E_CHAIN_ID || "20260920",
    BEL_E2E_DEPLOYED: "true",
    BEL_EXECUTION_PROFILE: "prototype",
    BEL_NETWORK: "besu-prototype",
    BEL_BOOTSTRAP_VALIDATOR_COUNT: "4",
    BEL_E2E_RESET: "false",
  },
});
process.exit(result.status ?? 1);
