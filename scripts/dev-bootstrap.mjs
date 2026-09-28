import { chmodSync, existsSync, mkdirSync, openSync, readFileSync, readdirSync, unlinkSync, writeFileSync } from "node:fs";
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
const RPC_PORTS = [8645, 8646, 8647, 8648];
const OWNER = "bel-dev-bootstrap";
let activeState;
let invocationRunRoot;
let invocationAdminKeyFile;

mkdirSync(logDir, { recursive: true });

function fail(message) { throw new Error(message); }
function commandExists(command) { return spawnSync(command, ["--version"], { stdio: "ignore", shell: process.platform === "win32" }).status === 0; }
function run(command, commandArgs, options = {}) {
  const result = spawnSync(command, commandArgs, { cwd: root, stdio: "inherit", env: { ...process.env, ...options.env }, shell: process.platform === "win32" });
  if (result.status !== 0) fail(`${command} ${commandArgs.join(" ")} failed with exit code ${result.status ?? "unknown"}`);
}
function persistState(state) { writeFileSync(stateFile, JSON.stringify(state, null, 2)); }
function appendLog(name) { return openSync(join(logDir, `${name}.log`), "a"); }
function spawnLogged(name, command, commandArgs, env = {}) {
  const child = spawn(command, commandArgs, { cwd: root, env: { ...process.env, ...env }, detached: process.platform !== "win32", stdio: ["ignore", appendLog(name), appendLog(name)], shell: process.platform === "win32" && command.endsWith(".cmd") });
  const record = { name, pid: child.pid, command, logPath: join(logDir, `${name}.log`), exited: false, exitCode: null };
  child.once("exit", (code) => { record.exited = true; record.exitCode = code; if (activeState) persistState(activeState); });
  child.once("error", (error) => { record.exited = true; record.exitCode = -1; console.error(`[dev-bootstrap] ${name} failed to start: ${error.message}`); if (activeState) persistState(activeState); });
  return record;
}
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
async function probe(url) { try { return await (await fetch(url)).ok; } catch { return false; } }
async function probeIpfs() {
  try {
    const response = await fetch("http://127.0.0.1:5001/api/v0/id", { method: "POST" });
    return response.ok;
  } catch {
    return false;
  }
}
async function jsonRpc(method, params = [], port = 8645) {
  const response = await fetch(`http://127.0.0.1:${port}`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }) });
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  const body = await response.json();
  if (body.error) throw new Error(body.error.message ?? "RPC error");
  return body.result;
}
function hostPath(value) { return process.platform === "win32" && /^\/mnt\/[a-z]\//i.test(value) ? `${value[5].toUpperCase()}:${value.slice(6).replaceAll("/", "\\")}` : value; }
function shellPath(value) { return value.replaceAll("\\", "/").replace(/^([A-Za-z]):/, (_, drive) => `/mnt/${drive.toLowerCase()}`); }
function pidAlive(pid) {
  if (!pid) return false;
  if (process.platform === "win32") {
    if (spawnSync("powershell.exe", ["-NoProfile", "-Command", `(Get-Process -Id ${Number(pid)} -ErrorAction SilentlyContinue) -ne $null`], { stdio: "ignore" }).status === 0) return true;
    return commandExists("wsl.exe") && spawnSync("wsl.exe", ["bash", "-lc", `test -d /proc/${Number(pid)}`], { stdio: "ignore" }).status === 0;
  }
  return spawnSync("kill", ["-0", String(pid)], { stdio: "ignore" }).status === 0;
}
function processCommand(pid) {
  if (!pidAlive(pid)) return "";
  if (process.platform === "win32") {
    const windowsCommand = spawnSync("powershell.exe", ["-NoProfile", "-Command", `(Get-CimInstance Win32_Process -Filter 'ProcessId=${Number(pid)}').CommandLine`], { encoding: "utf8" }).stdout?.trim() ?? "";
    if (windowsCommand) return windowsCommand;
    if (commandExists("wsl.exe")) return spawnSync("wsl.exe", ["bash", "-lc", `tr '\\0' ' ' </proc/${Number(pid)}/cmdline 2>/dev/null`], { encoding: "utf8" }).stdout?.trim() ?? "";
    return "";
  }
  try { return readFileSync(`/proc/${pid}/cmdline`, "utf8").replaceAll("\0", " "); } catch { return ""; }
}
function runMetadata(runRoot) { try { return JSON.parse(readFileSync(join(runRoot, "run.json"), "utf8")); } catch { return null; } }
function besuPidOwned(pid, runRoot) {
  const command = processCommand(pid).toLowerCase();
  const markers = [runRoot.replaceAll("\\", "/"), shellPath(runRoot)].map((value) => value.toLowerCase());
  return Boolean(command && command.includes("besu") && markers.some((marker) => command.includes(marker)));
}
function managedBesuRun(runRoot) {
  const metadata = runMetadata(runRoot);
  const managedName = runRoot.toLowerCase().includes("orchestrated-");
  const owned = metadata?.pids?.filter((pid) => pidAlive(pid)).every((pid) => besuPidOwned(pid, runRoot));
  return Boolean((metadata?.owner === OWNER || managedName) && Array.isArray(metadata?.pids) && metadata.pids.length === 4 && metadata.pids.some((pid) => pidAlive(pid)) && owned);
}
function candidateRuns() {
  const result = activeState?.runRoot ? [activeState.runRoot] : [];
  try { result.push(...readdirSync(join(root, ".bel-demo")).filter((name) => name.startsWith("orchestrated-")).map((name) => join(root, ".bel-demo", name))); } catch { /* first run */ }
  return [...new Set(result)];
}
function occupiedPorts() {
  const output = process.platform === "win32" ? spawnSync("netstat", ["-ano", "-p", "TCP"], { encoding: "utf8" }).stdout : spawnSync("sh", ["-c", "ss -ltnp 2>/dev/null || netstat -ltnp"], { encoding: "utf8" }).stdout;
  return RPC_PORTS.map((port) => {
    const line = output.split(/\r?\n/).find((value) => new RegExp(`:${port}\\s`).test(value) || new RegExp(`:${port}$`).test(value));
    const pid = line?.match(/(?:LISTENING|users:\(\("[^"]+",pid=)(?:\s+|,)?(\d+)/i)?.[1] ?? line?.trim().split(/\s+/).at(-1);
    return { port, pid: pid && /^\d+$/.test(pid) ? Number(pid) : null, line: line ?? "" };
  }).filter((entry) => entry.line);
}
function stopBesuRun(runRoot) {
  const metadata = runMetadata(runRoot);
  const managedName = runRoot.toLowerCase().includes("orchestrated-");
  if (!metadata || (!managedName && metadata.owner !== OWNER) || !Array.isArray(metadata.pids)) return false;
  if (!metadata.pids.filter((pid) => pidAlive(pid)).every((pid) => besuPidOwned(pid, runRoot))) return false;
  if (process.platform === "win32" && commandExists("wsl.exe")) {
    const linuxRepo = shellPath(root); const linuxRoot = shellPath(runRoot);
    spawnSync("wsl.exe", ["bash", "-lc", `cd '${linuxRepo}' && bash scripts/stop-besu-bel-demo.sh '${linuxRoot}'`], { stdio: "inherit" });
  } else if (commandExists("bash")) spawnSync("bash", [join("scripts", "stop-besu-bel-demo.sh"), runRoot], { cwd: root, stdio: "inherit" });
  else for (const pid of metadata.pids) if (pidAlive(pid)) process.platform === "win32" ? spawnSync("taskkill", ["/PID", String(pid), "/T", "/F"], { stdio: "ignore" }) : spawnSync("kill", ["-TERM", String(pid)], { stdio: "ignore" });
  return true;
}
function serviceOwned(record) {
  if (!record?.pid || !pidAlive(record.pid)) return false;
  const command = processCommand(record.pid).toLowerCase();
  if (record.name === "dev-wallet") return command.includes("dev-wallet") || command.includes("server.mjs");
  if (record.name === "backend") return command.includes("dev:backend") || command.includes("backend/src/index");
  if (record.name === "frontend") return command.includes("dev:frontend") || command.includes("vite");
  return false;
}
function stopOwnedService(record) {
  if (!serviceOwned(record)) return false;
  if (process.platform === "win32") spawnSync("taskkill", ["/PID", String(record.pid), "/T", "/F"], { stdio: "ignore" });
  else spawnSync("kill", ["-TERM", `-${record.pid}`], { stdio: "ignore" });
  return true;
}
async function stopOwnedStaleServices() {
  for (const record of activeState?.started ?? []) if (stopOwnedService(record)) await waitFor(`${record.name} shutdown`, () => !pidAlive(record.pid), 15_000);
}
async function stopOwnedStaleBesu() {
  for (const runRoot of candidateRuns()) if (managedBesuRun(runRoot)) {
    console.log(`[dev-bootstrap] stopping managed Besu run ${runRoot}`);
    stopBesuRun(runRoot);
    await waitFor(`Besu shutdown (${runRoot})`, () => runMetadata(runRoot)?.pids?.every((pid) => !pidAlive(pid)), 30_000);
  }
  const occupied = occupiedPorts();
  if (occupied.length) fail(`Required Besu RPC port is occupied by an unrelated process: ${occupied.map((entry) => `${entry.port} (pid ${entry.pid ?? "unknown"})`).join(", ")}. Stop it manually; the orchestrator will not kill unrelated processes.`);
}
function runBesuScript(script, runRoot) {
  const environment = { BEL_EXECUTION_PROFILE: "prototype", BEL_SMOKE_KEEP_RUNNING: "true", BEL_BESU_RUN_ROOT: runRoot, BEL_RUN_OWNER: OWNER, BEL_ORCHESTRATOR_NAME: OWNER };
  if (process.platform !== "win32" && commandExists("bash")) run("bash", [join("scripts", script)], { env: environment });
  else if (process.platform === "win32" && commandExists("wsl.exe")) run("wsl.exe", ["bash", "-lc", `cd '${shellPath(root)}' && BEL_EXECUTION_PROFILE=prototype BEL_SMOKE_KEEP_RUNNING=true BEL_BESU_RUN_ROOT='${shellPath(runRoot)}' BEL_RUN_OWNER='${OWNER}' BEL_ORCHESTRATOR_NAME='${OWNER}' bash scripts/${script}`]);
  else if (commandExists("bash")) run("bash", [join("scripts", script)], { env: { ...environment, BEL_BESU_RUN_ROOT: runRoot.replaceAll("\\", "/") } });
  else fail("Besu launcher requires bash or WSL.");
}
function readAdminIdentity() { return { secret: process.env.BEL_DEV_WALLET_SECRET || "bel-local-development-secret-please-change", deviceId: process.env.BEL_DEV_DEVICE_ID || "BEL-DEV-ADMIN-001", port: process.env.BEL_DEV_WALLET_PORT || "8787" }; }
function besuRunInputs(runRoot) {
  if (!runRoot) return null;
  const metadata = runMetadata(runRoot); const keyFile = hostPath(metadata?.testAccountKeys ?? "");
  const keys = readFileSync(keyFile, "utf8").split(/\r?\n/).map((key) => key.trim()).filter(Boolean);
  if (!keys.length) fail(`Besu run has no development test account keys: ${keyFile}`);
  return { keyFile, keys };
}
async function cleanupAfterFailure() {
  if (invocationAdminKeyFile) { try { unlinkSync(invocationAdminKeyFile); } catch { /* cleanup is best effort */ } }
  if (!invocationRunRoot || !runMetadata(invocationRunRoot)) return;
  if (!managedBesuRun(invocationRunRoot)) return console.error(`[dev-bootstrap] refusing to stop ${invocationRunRoot}: ownership verification failed; inspect its run.json and logs.`);
  stopBesuRun(invocationRunRoot);
  try { await waitFor(`Besu cleanup (${invocationRunRoot})`, () => runMetadata(invocationRunRoot)?.pids?.every((pid) => !pidAlive(pid)), 30_000); } catch (error) { console.error(`[dev-bootstrap] cleanup incomplete: ${error.message}`); }
  try { if (occupiedPorts().length) console.error(`[dev-bootstrap] RPC ports remain occupied: ${JSON.stringify(occupiedPorts())}`); } catch { /* diagnostic only */ }
}

async function main() {
  if (!commandExists("node") || !commandExists("npm")) fail("Node.js and npm are required.");
  if (!skipInfra && !commandExists("docker")) fail("Docker is required unless --skip-infra is supplied.");
  if (!skipBesu && !commandExists("bash") && !commandExists("wsl.exe")) fail("Besu requires bash or WSL.");
  if (existsSync(stateFile)) { try { activeState = JSON.parse(readFileSync(stateFile, "utf8")); } catch { activeState = undefined; } }
  await stopOwnedStaleServices();
  await stopOwnedStaleBesu();
  activeState = { owner: OWNER, started: [], logs: logDir, runRoot: null };
  persistState(activeState);

  if (!skipInfra) {
    run("docker", ["compose", "up", "-d", "postgres", "ipfs"]);
    activeState.started.push({ name: "postgres", pid: null, logPath: "docker compose" }, { name: "ipfs", pid: null, logPath: "docker compose" }); persistState(activeState);
    await waitFor("PostgreSQL", async () => spawnSync("docker", ["compose", "exec", "-T", "postgres", "pg_isready", "-U", "bel", "-d", "bel"], { cwd: root, stdio: "ignore", shell: process.platform === "win32" }).status === 0);
    await waitFor("IPFS", probeIpfs);
  }
  const runRoot = join(root, ".bel-demo", `orchestrated-${new Date().toISOString().replace(/[:.]/g, "-")}`); invocationRunRoot = runRoot;
  let besuInputs = null;
  if (!skipBesu) {
    runBesuScript("start-besu-prototype.sh", runRoot); activeState.runRoot = runRoot; persistState(activeState);
    await waitFor("all Besu RPC endpoints", async () => (await Promise.all(RPC_PORTS.map((port) => probe(`http://127.0.0.1:${port}`)))).every(Boolean));
    const chainId = Number.parseInt(await jsonRpc("eth_chainId"), 16); if (chainId !== 20260920) fail(`Unexpected Besu chain ID ${chainId}; expected 20260920.`);
    await waitFor("Besu peer connectivity", async () => Number.parseInt(await jsonRpc("net_peerCount"), 16) >= 1);
    await waitFor("Besu block production", async () => Number.parseInt(await jsonRpc("eth_blockNumber"), 16) > 0);
    besuInputs = besuRunInputs(runRoot); process.env.BEL_CHAIN_DEV_SIGNER_KEYS = besuInputs.keys.join(","); process.env.BEL_CHAIN_RPC_URL = "http://127.0.0.1:8645"; process.env.BEL_BLOCKCHAIN = "evm"; process.env.BEL_CHAIN_DEPLOYMENT = "besu-prototype";
    invocationAdminKeyFile = join(stateDir, "admin-device-private-key");
    writeFileSync(invocationAdminKeyFile, `${besuInputs.keys[0]}\n`, { mode: 0o600 });
    try { chmodSync(invocationAdminKeyFile, 0o600); } catch { /* Windows ACLs are deployment-owned. */ }
    if (!existsSync(join(root, "contracts", "deployments", "besu-prototype.json")) || explicitDeploy) { if (!commandExists("forge")) fail("Forge is required to deploy contracts."); runBesuScript("deploy-besu-prototype.sh", runRoot); }
  }
  const wallet = readAdminIdentity(); const walletEnv = { BEL_DEV_WALLET_SECRET: wallet.secret, BEL_DEV_DEVICE_ID: wallet.deviceId, BEL_DEV_WALLET_PORT: wallet.port, BEL_DEV_WALLET_DIR: process.env.BEL_DEV_WALLET_DIR ?? join(stateDir, "devices"), ...(invocationAdminKeyFile ? { BEL_DEV_DEVICE_IMPORT_KEY_FILE: invocationAdminKeyFile } : {}) };
  const walletUrl = `http://127.0.0.1:${wallet.port}/identity?deviceId=${encodeURIComponent(wallet.deviceId)}`;
  if (!(await probe(walletUrl))) { const walletProcess = spawnLogged("dev-wallet", process.execPath, [join(root, "frontend", "dev-wallet", "server.mjs")], walletEnv); activeState.started.push(walletProcess); persistState(activeState); await waitFor("development wallet", async () => { if (walletProcess.exited) fail(`wallet exited with code ${walletProcess.exitCode}; see ${walletProcess.logPath}`); return probe(walletUrl); }); } else console.log(`[dev-bootstrap] reusing development wallet at http://127.0.0.1:${wallet.port}`);
  const identity = await (await fetch(walletUrl)).json();
  if (invocationAdminKeyFile) { try { unlinkSync(invocationAdminKeyFile); } catch { /* cleanup is best effort */ } invocationAdminKeyFile = undefined; }
  const backendEnv = { BEL_ENV: "development", BEL_DEV_BOOTSTRAP: "true", BEL_BLOCKCHAIN: process.env.BEL_BLOCKCHAIN ?? "evm", BEL_CHAIN_RPC_URL: process.env.BEL_CHAIN_RPC_URL ?? "http://127.0.0.1:8645", BEL_CHAIN_DEPLOYMENT: process.env.BEL_CHAIN_DEPLOYMENT ?? "besu-prototype", BEL_RUN_INTEGRATION: "true", BEL_DEVICE_ATTESTATION: "mock", BEL_MOCK_APPROVED_DEVICE_IDS: wallet.deviceId, BEL_CHAIN_DEV_SIGNER_KEYS: process.env.BEL_CHAIN_DEV_SIGNER_KEYS ?? "", BEL_BOOTSTRAP_PUBLIC_KEY: identity.publicKey, BEL_BOOTSTRAP_WALLET_ADDRESS: identity.walletAddress, DATABASE_URL: process.env.DATABASE_URL ?? "postgresql://bel:bel@localhost:5432/bel", IPFS_API_URL: process.env.IPFS_API_URL ?? "http://127.0.0.1:5001", BEL_CORS_ORIGINS: process.env.BEL_CORS_ORIGINS ?? "http://localhost:3000,http://127.0.0.1:3000" };
  run("npm", ["run", "db:migrate"], { env: backendEnv }); if (backendEnv.BEL_BLOCKCHAIN === "evm") run("npm", ["run", "bootstrap:dev"], { env: backendEnv });
  if (!(await probe("http://127.0.0.1:4000/health"))) { const backend = spawnLogged("backend", process.platform === "win32" ? "npm.cmd" : "npm", ["run", "dev:backend"], backendEnv); activeState.started.push(backend); persistState(activeState); await waitFor("backend", async () => { if (backend.exited) fail(`backend exited with code ${backend.exitCode}; see ${backend.logPath}`); return probe("http://127.0.0.1:4000/health"); }); } else console.log("[dev-bootstrap] reusing backend at http://127.0.0.1:4000");
  const frontendEnv = { VITE_API_BASE_URL: process.env.VITE_API_BASE_URL ?? "http://127.0.0.1:4000", VITE_BEL_DEV_WALLET_URL: `http://127.0.0.1:${wallet.port}`, VITE_BEL_DEV_DEVICE_ID: wallet.deviceId, BEL_VITE_ALLOWED_HOSTS: process.env.BEL_VITE_ALLOWED_HOSTS ?? "localhost,127.0.0.1" };
  if (!(await probe("http://127.0.0.1:3000"))) { const frontend = spawnLogged("frontend", process.platform === "win32" ? "npm.cmd" : "npm", ["run", "dev:frontend"], frontendEnv); activeState.started.push(frontend); persistState(activeState); await waitFor("frontend", async () => { if (frontend.exited) fail(`frontend exited with code ${frontend.exitCode}; see ${frontend.logPath}`); return probe("http://127.0.0.1:3000"); }); } else console.log("[dev-bootstrap] reusing frontend at http://127.0.0.1:3000");
  persistState(activeState); console.log(`\nBEL development environment ready\n\nFrontend: http://127.0.0.1:3000\nBackend: http://127.0.0.1:4000\nDev wallet: http://127.0.0.1:${wallet.port} (${wallet.deviceId})\nBesu RPC: http://127.0.0.1:8645\nAdmin identity: ${identity.walletAddress}\nLogs: ${logDir}\nStop: npm run dev:stop\n`);
}

main().catch(async (error) => { console.error(`[dev-bootstrap] failed: ${error instanceof Error ? error.message : String(error)}`); await cleanupAfterFailure(); console.error(`Logs: ${logDir}`); process.exitCode = 1; });
