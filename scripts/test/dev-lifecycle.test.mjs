import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import net from "node:net";
import { join } from "node:path";

const root = process.cwd();
const stateFile = join(root, ".bel-demo", "orchestrator", "state.json");

test("dev:stop is idempotent when no orchestrator state exists", () => {
  if (existsSync(stateFile)) return;
  const result = spawnSync(process.execPath, ["scripts/dev-stop.mjs"], { cwd: root, encoding: "utf8" });
  assert.equal(result.status, 0);
  assert.match(`${result.stdout}${result.stderr}`, /No orchestrated|Persistent databases/);
});

test("bootstrap refuses an unrelated Besu RPC port owner", async () => {
  if (existsSync(stateFile)) return;
  const server = net.createServer();
  await new Promise((resolve, reject) => { server.once("error", reject); server.listen(8645, "127.0.0.1", resolve); });
  try {
    const result = spawnSync(process.execPath, ["scripts/dev-bootstrap.mjs", "--skip-infra", "--skip-besu"], { cwd: root, encoding: "utf8", env: { ...process.env, BEL_DEV_WALLET_PORT: "8796" } });
    assert.notEqual(result.status, 0);
    assert.match(`${result.stdout}${result.stderr}`, /unrelated process|occupied/i);
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});

test("orchestrator run metadata records explicit ownership", () => {
  const smoke = readFileSync(join(root, "scripts", "run-besu-smoke.sh"), "utf8");
  assert.match(smoke, /"owner": "\$\{BEL_RUN_OWNER:-manual\}"/);
  assert.match(smoke, /"orchestrator": "\$\{BEL_ORCHESTRATOR_NAME:-\}"/);
});
