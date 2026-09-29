import { existsSync, readFileSync, readdirSync, rmSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const stateFile = join(root, ".bel-demo", "orchestrator", "state.json");
const state = existsSync(stateFile) ? JSON.parse(readFileSync(stateFile, "utf8")) : { started: [], runRoot: null };
function alive(pid) { if (!pid) return false; if (process.platform === "win32") { if (spawnSync("powershell.exe", ["-NoProfile", "-Command", `(Get-Process -Id ${Number(pid)} -ErrorAction SilentlyContinue) -ne $null`], { stdio: "ignore" }).status === 0) return true; return spawnSync("wsl.exe", ["bash", "-lc", `test -d /proc/${Number(pid)}`], { stdio: "ignore" }).status === 0; } return spawnSync("kill", ["-0", String(pid)], { stdio: "ignore" }).status === 0; }
function command(pid) { if (!alive(pid)) return ""; if (process.platform === "win32") { const windowsCommand = spawnSync("powershell.exe", ["-NoProfile", "-Command", `(Get-CimInstance Win32_Process -Filter 'ProcessId=${Number(pid)}').CommandLine`], { encoding: "utf8" }).stdout?.trim() ?? ""; if (windowsCommand) return windowsCommand; return spawnSync("wsl.exe", ["bash", "-lc", `tr '\\0' ' ' </proc/${Number(pid)}/cmdline 2>/dev/null`], { encoding: "utf8" }).stdout?.trim() ?? ""; } try { return readFileSync(`/proc/${pid}/cmdline`, "utf8").replaceAll("\0", " "); } catch { return ""; } }
function ownedService(service) { const value = command(service.pid).toLowerCase(); return service.name === "dev-wallet" ? value.includes("server.mjs") : service.name === "backend" ? value.includes("dev:backend") || value.includes("backend/src/index") : service.name === "frontend" ? value.includes("dev:frontend") || value.includes("vite") : false; }
for (const service of state.started ?? []) {
  if (!service.pid) continue;
  if (!ownedService(service)) { console.log(`Skipped ${service.name}: recorded PID is not an active process owned by the orchestrator.`); continue; }
  if (process.platform === "win32") spawnSync("taskkill", ["/PID", String(service.pid), "/T", "/F"], { stdio: "ignore" });
  else spawnSync("kill", ["-TERM", `-${service.pid}`], { stdio: "ignore" });
  console.log(`Stopped ${service.name} (log: ${service.logPath})`);
}
function metadata(runRoot) { try { return JSON.parse(readFileSync(join(runRoot, "run.json"), "utf8")); } catch { return null; } }
function besuOwned(runRoot) { const data = metadata(runRoot); if (!data || (!runRoot.toLowerCase().includes("orchestrated-") && data.owner !== "bel-dev-bootstrap")) return false; const markers = [runRoot.replaceAll("\\", "/"), runRoot.replaceAll("\\", "/").replace(/^([A-Za-z]):/, (_, drive) => `/mnt/${drive.toLowerCase()}`)].map((value) => value.toLowerCase()); return Array.isArray(data.pids) && data.pids.some(alive) && data.pids.filter(alive).every((pid) => { const value = command(pid).toLowerCase(); return value.includes("besu") && markers.some((marker) => value.includes(marker)); }); }
const runs = new Set(state.runRoot ? [state.runRoot] : []);
try { for (const name of readdirSync(join(root, ".bel-demo"))) if (name.startsWith("orchestrated-")) runs.add(join(root, ".bel-demo", name)); } catch { /* no runtime directory */ }
for (const runRoot of runs) if (existsSync(join(runRoot, "pids")) && besuOwned(runRoot)) {
  if (process.platform === "win32" && spawnSync("wsl.exe", ["--version"], { stdio: "ignore" }).status === 0) {
    const linuxRoot = runRoot.replaceAll("\\", "/").replace(/^([A-Za-z]):/, (_, drive) => `/mnt/${drive.toLowerCase()}`);
    const linuxRepo = root.replaceAll("\\", "/").replace(/^([A-Za-z]):/, (_, drive) => `/mnt/${drive.toLowerCase()}`);
    spawnSync("wsl.exe", ["bash", "-lc", `cd '${linuxRepo}' && bash scripts/stop-besu-bel-demo.sh '${linuxRoot}'`], { stdio: "inherit" });
  } else if (spawnSync("bash", ["--version"], { stdio: "ignore" }).status === 0) spawnSync("bash", [join("scripts", "stop-besu-bel-demo.sh"), runRoot], { cwd: root, stdio: "inherit" });
  console.log(`Stopped managed Besu run ${runRoot}`);
}
if (state.started?.some((service) => service.name === "postgres" || service.name === "ipfs")) spawnSync("docker", ["compose", "stop", "postgres", "ipfs"], { cwd: root, stdio: "inherit" });
if (existsSync(stateFile)) rmSync(stateFile, { force: true });
console.log("BEL development services stopped. Persistent databases, wallets, Besu data, and generated files were preserved.");
