import { existsSync, readFileSync, rmSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const stateFile = join(root, ".bel-demo", "orchestrator", "state.json");
if (!existsSync(stateFile)) { console.log("No orchestrated BEL development environment is recorded."); process.exit(0); }
const state = JSON.parse(readFileSync(stateFile, "utf8"));
for (const service of state.started ?? []) {
  if (!service.pid) continue;
  if (process.platform === "win32") spawnSync("taskkill", ["/PID", String(service.pid), "/T", "/F"], { stdio: "ignore" });
  else spawnSync("kill", ["-TERM", `-${service.pid}`], { stdio: "ignore" });
  console.log(`Stopped ${service.name} (log: ${service.logPath})`);
}
if (state.runRoot && existsSync(join(state.runRoot, "pids"))) {
  if (process.platform === "win32" && spawnSync("wsl.exe", ["--version"], { stdio: "ignore" }).status === 0) {
    const linuxRoot = state.runRoot.replaceAll("\\", "/").replace(/^([A-Za-z]):/, (_, drive) => `/mnt/${drive.toLowerCase()}`);
    const linuxRepo = root.replaceAll("\\", "/").replace(/^([A-Za-z]):/, (_, drive) => `/mnt/${drive.toLowerCase()}`);
    spawnSync("wsl.exe", ["bash", "-lc", `cd '${linuxRepo}' && bash scripts/stop-besu-bel-demo.sh '${linuxRoot}'`], { stdio: "inherit" });
  } else if (spawnSync("bash", ["--version"], { stdio: "ignore" }).status === 0) spawnSync("bash", [join("scripts", "stop-besu-bel-demo.sh"), state.runRoot], { cwd: root, stdio: "inherit" });
}
if (state.started?.some((service) => service.name === "postgres" || service.name === "ipfs")) spawnSync("docker", ["compose", "stop", "postgres", "ipfs"], { cwd: root, stdio: "inherit" });
rmSync(stateFile, { force: true });
console.log("BEL development services stopped. Persistent databases, wallets, Besu data, and generated files were preserved.");
