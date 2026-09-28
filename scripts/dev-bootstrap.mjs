import { existsSync, mkdirSync, openSync, readFileSync, writeFileSync } from "node:fs";
import { spawn, spawnSync } from "node:child_process";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const stateDir = join(root, ".bel-demo", "orchestrator");
const stateFile = join(stateDir, "state.json");
const logDir = join(stateDir, "logs");
const args = new Set(process.argv.slice(2));
const skipInfra = args.has("--skip-infra");
const skipBesu = args.has("--skip-besu");
const explicitDeploy = args.has("--deploy");

mkdirSync(logDir, { recursive: true });

function fail(message) { console.error(`[dev-bootstrap] ${message}`); process.exitCode = 1; throw new Error(message); }
function commandExists(command) { return spawnSync(command, ["--version"], { stdio: "ignore", shell: process.platform === "win32" }).status === 0; }
function run(command, commandArgs, options = {}) {
  const result = spawnSync(command, commandArgs, { cwd: root, stdio: "inherit", env: { ...process.env, ...options.env }, shell: process.platform === "win32" });
  if (result.status !== 0) fail(`${command} ${commandArgs.join(" ")} failed with exit code ${result.status ?? "unknown"}`);
}
function spawnLogged(name, command, commandArgs, env = {}) {
  const logPath = join(logDir, `${name}.log`);
  const log = requireFsAppend(logPath);
  const child = spawn(command, commandArgs, { cwd: root, env: { ...process.env, ...env }, detached: process.platform !== "win32", stdio: ["ignore", log, log], shell: process.platform === "win32" && command.endsWith(".cmd") });
  return { name, pid: child.pid, logPath };
}
function requireFsAppend(path) {
  return openSync(path, "a");
}
function persistState(state) { writeFileSync(stateFile, JSON.stringify(state, null, 2)); }
function waitFor(label, check, timeoutMs = 60_000) {
  const deadline = Date.now() + timeoutMs;
  return (async () => {
    let lastError = "not ready";
    while (Date.now() < deadline) {
      try { if (await check()) return; } catch (error) { lastError = error instanceof Error ? error.message : String(error); }
      await new Promise((resolvePromise) => setTimeout(resolvePromise, 1000));
    }
    fail(`${label} did not become ready: ${lastError}`);
  })();
}
async function probe(url) {
  try { return await (await fetch(url)).ok; } catch { return false; }
}
async function jsonRpc(method, params = []) {
  const response = await fetch(process.env.BEL_CHAIN_RPC_URL ?? "http://127.0.0.1:8645", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }) });
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  const body = await response.json();
  if (body.error) throw new Error(body.error.message ?? "RPC error");
  return body.result;
}
function runBesuScript(script, runRoot) {
  const env = { BEL_EXECUTION_PROFILE: "prototype", BEL_SMOKE_KEEP_RUNNING: "true", BEL_BESU_RUN_ROOT: runRoot };
  if (process.platform !== "win32" && commandExists("bash")) run("bash", [join("scripts", script)], { env });
  else if (process.platform === "win32" && commandExists("wsl.exe")) {
    const drivePath = root.replaceAll("\\", "/").replace(/^([A-Za-z]):/, (_, drive) => `/mnt/${drive.toLowerCase()}`);
    const linuxRunRoot = runRoot.replaceAll("\\", "/").replace(/^([A-Za-z]):/, (_, drive) => `/mnt/${drive.toLowerCase()}`);
    run("wsl.exe", ["bash", "-lc", `cd '${drivePath}' && BEL_EXECUTION_PROFILE=prototype BEL_SMOKE_KEEP_RUNNING=true BEL_BESU_RUN_ROOT='${linuxRunRoot}' bash scripts/${script}`], { env: {} });
  } else if (commandExists("bash")) run("bash", [join("scripts", script)], { env: { ...env, BEL_BESU_RUN_ROOT: runRoot.replaceAll("\\", "/") } });
  else fail("Besu launcher requires bash or WSL. The repository launcher is Linux/WSL based.");
}
function readAdminIdentity() {
  const secret = process.env.BEL_DEV_WALLET_SECRET || "bel-local-development-secret-please-change";
  const deviceId = process.env.BEL_DEV_DEVICE_ID || "BEL-DEV-ADMIN-001";
  const port = process.env.BEL_DEV_WALLET_PORT || "8787";
  return { secret, deviceId, port };
}
function hostPath(value) {
  return process.platform === "win32" && /^\/mnt\/[a-z]\//i.test(value)
    ? `${value[5].toUpperCase()}:${value.slice(6).replaceAll("/", "\\")}`
    : value;
}
function besuRunInputs(runRoot) {
  if (!runRoot) return null;
  const metadata = JSON.parse(readFileSync(join(runRoot, "run.json"), "utf8"));
  const keyFile = hostPath(metadata.testAccountKeys);
  const keys = readFileSync(keyFile, "utf8").split(/\r?\n/).map((key) => key.trim()).filter(Boolean);
  if (!keys.length) fail(`Besu run has no development test account keys: ${keyFile}`);
  return { keyFile, keys };
}

async function main() {
  if (!commandExists("node") || !commandExists("npm")) fail("Node.js and npm are required.");
  if (!skipInfra && !commandExists("docker")) fail("Docker is required unless --skip-infra is supplied.");
  if (!skipBesu && !commandExists("bash") && !commandExists("wsl.exe")) fail("The Besu prototype launcher requires bash or WSL.");

  const state = { started: [], logs: logDir, runRoot: null };
  if (!skipInfra) {
    run("docker", ["compose", "up", "-d", "postgres", "ipfs"]);
    state.started.push({ name: "postgres", pid: null, logPath: "docker compose" }, { name: "ipfs", pid: null, logPath: "docker compose" });
    persistState(state);
    await waitFor("PostgreSQL", async () => spawnSync("docker", ["compose", "exec", "-T", "postgres", "pg_isready", "-U", "bel", "-d", "bel"], { cwd: root, stdio: "ignore", shell: process.platform === "win32" }).status === 0);
    await waitFor("IPFS", async () => (await fetch("http://127.0.0.1:5001/api/v0/id", { method: "POST" })).ok);
  }

  const runRoot = join(root, ".bel-demo", `orchestrated-${new Date().toISOString().replace(/[:.]/g, "-")}`);
  let besuInputs = null;
  if (!skipBesu) {
    runBesuScript("start-besu-prototype.sh", runRoot);
    state.runRoot = runRoot;
    persistState(state);
    await waitFor("Besu RPC", async () => Boolean(await jsonRpc("eth_chainId")));
    const chainId = Number.parseInt(await jsonRpc("eth_chainId"), 16);
    if (chainId !== 20260920) fail(`Unexpected Besu chain ID ${chainId}; expected 20260920.`);
    await waitFor("Besu block production", async () => Number.parseInt(await jsonRpc("eth_blockNumber"), 16) > 0);
    besuInputs = besuRunInputs(runRoot);
    process.env.BEL_CHAIN_DEV_SIGNER_KEYS = besuInputs.keys.join(",");
    process.env.BEL_CHAIN_RPC_URL = "http://127.0.0.1:8645";
    process.env.BEL_BLOCKCHAIN = "evm";
    process.env.BEL_CHAIN_DEPLOYMENT = "besu-prototype";
    const deployment = join(root, "contracts", "deployments", "besu-prototype.json");
    if (!existsSync(deployment) || explicitDeploy) {
      if (!commandExists("forge")) fail("Forge is required to deploy contracts. Use an existing deployment or install Foundry.");
      runBesuScript("deploy-besu-prototype.sh", runRoot);
    }
  }

  const wallet = readAdminIdentity();
  const walletEnv = { BEL_DEV_WALLET_SECRET: wallet.secret, BEL_DEV_DEVICE_ID: wallet.deviceId, BEL_DEV_WALLET_PORT: wallet.port, BEL_DEV_WALLET_DIR: process.env.BEL_DEV_WALLET_DIR ?? join(stateDir, "devices"), ...(besuInputs ? { BEL_DEV_DEVICE_IMPORT_KEY_FILE: besuInputs.keyFile } : {}) };
  const walletUrl = `http://127.0.0.1:${wallet.port}/identity?deviceId=${encodeURIComponent(wallet.deviceId)}`;
  if (!(await probe(walletUrl))) {
    const walletProcess = spawnLogged("dev-wallet", process.execPath, [join(root, "frontend", "dev-wallet", "server.mjs")], walletEnv);
    state.started.push(walletProcess);
    persistState(state);
    await waitFor("development wallet", async () => probe(walletUrl));
  } else console.log(`[dev-bootstrap] reusing development wallet at http://127.0.0.1:${wallet.port}`);
  const identity = await (await fetch(`http://127.0.0.1:${wallet.port}/identity?deviceId=${encodeURIComponent(wallet.deviceId)}`)).json();

  const backendEnv = {
    BEL_ENV: "development", BEL_DEV_BOOTSTRAP: "true", BEL_BLOCKCHAIN: process.env.BEL_BLOCKCHAIN ?? "evm",
    BEL_CHAIN_RPC_URL: process.env.BEL_CHAIN_RPC_URL ?? "http://127.0.0.1:8645", BEL_CHAIN_DEPLOYMENT: process.env.BEL_CHAIN_DEPLOYMENT ?? "besu-prototype",
    BEL_RUN_INTEGRATION: "true", BEL_DEVICE_ATTESTATION: "mock", BEL_MOCK_APPROVED_DEVICE_IDS: wallet.deviceId,
    BEL_CHAIN_DEV_SIGNER_KEYS: process.env.BEL_CHAIN_DEV_SIGNER_KEYS ?? "",
    BEL_BOOTSTRAP_PUBLIC_KEY: identity.publicKey, BEL_BOOTSTRAP_WALLET_ADDRESS: identity.walletAddress,
    DATABASE_URL: process.env.DATABASE_URL ?? "postgresql://bel:bel@localhost:5432/bel", IPFS_API_URL: process.env.IPFS_API_URL ?? "http://127.0.0.1:5001",
    BEL_CORS_ORIGINS: process.env.BEL_CORS_ORIGINS ?? "http://localhost:3000,http://127.0.0.1:3000",
  };
  run("npm", ["run", "db:migrate"], { env: backendEnv });
  if (backendEnv.BEL_BLOCKCHAIN === "evm") run("npm", ["run", "bootstrap:dev"], { env: backendEnv });
  if (!(await probe("http://127.0.0.1:4000/health"))) {
    const backend = spawnLogged("backend", process.platform === "win32" ? "npm.cmd" : "npm", ["run", "dev:backend"], backendEnv);
    state.started.push(backend);
    persistState(state);
    await waitFor("backend", async () => probe("http://127.0.0.1:4000/health"));
  } else console.log("[dev-bootstrap] reusing backend at http://127.0.0.1:4000");

  const frontendEnv = { VITE_API_BASE_URL: process.env.VITE_API_BASE_URL ?? "http://127.0.0.1:4000", VITE_BEL_DEV_WALLET_URL: `http://127.0.0.1:${wallet.port}`, VITE_BEL_DEV_DEVICE_ID: wallet.deviceId, BEL_VITE_ALLOWED_HOSTS: process.env.BEL_VITE_ALLOWED_HOSTS ?? "localhost,127.0.0.1" };
  if (!(await probe("http://127.0.0.1:3000"))) {
    const frontend = spawnLogged("frontend", process.platform === "win32" ? "npm.cmd" : "npm", ["run", "dev:frontend"], frontendEnv);
    state.started.push(frontend);
    persistState(state);
    await waitFor("frontend", async () => probe("http://127.0.0.1:3000"));
  } else console.log("[dev-bootstrap] reusing frontend at http://127.0.0.1:3000");
  writeFileSync(stateFile, JSON.stringify(state, null, 2));
  console.log(`\nBEL development environment ready\n\nFrontend: http://127.0.0.1:3000\nBackend: http://127.0.0.1:4000\nDev wallet: http://127.0.0.1:${wallet.port} (${wallet.deviceId})\nBesu RPC: ${backendEnv.BEL_CHAIN_RPC_URL}\nAdmin identity: ${identity.walletAddress}\nLogs: ${logDir}\nStop: npm run dev:stop\n`);
}

main().catch((error) => { console.error(`[dev-bootstrap] failed: ${error instanceof Error ? error.message : String(error)}`); console.error(`Logs: ${logDir}`); process.exitCode = 1; });
