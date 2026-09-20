import { spawnSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { createConnection } from "node:net";
import { URL } from "node:url";
import { HDNodeWallet, Wallet } from "ethers";

const root = process.cwd();
function loadEnv(path) {
  if (!existsSync(path)) return {};
  return Object.fromEntries(readFileSync(path, "utf8").split(/\r?\n/).flatMap((line) => {
    const match = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)=(.*)\s*$/);
    return match ? [[match[1], match[2].replace(/^['"]|['"]$/g, "")]] : [];
  }));
}
const env = { ...loadEnv(`${root}/.env`), ...loadEnv(`${root}/backend/.env`), ...process.env };
const fail = (message) => { console.error(`E2E BLOCKED: ${message}`); process.exit(1); };
if (!env.DATABASE_URL) fail("DATABASE_URL is not configured");
const database = new URL(env.DATABASE_URL);
await new Promise((resolve, reject) => {
  const socket = createConnection({ host: database.hostname, port: Number(database.port || 5432), timeout: 1500 });
  socket.once("connect", () => { socket.destroy(); resolve(); });
  socket.once("timeout", () => { socket.destroy(); reject(new Error("timeout")); });
  socket.once("error", reject);
}).catch((error) => fail(`PostgreSQL is unreachable at ${database.hostname}:${database.port || 5432} (${error.message})`));
const rpc = env.BEL_E2E_RPC_URL || env.BEL_CHAIN_RPC_URL || "http://127.0.0.1:8545";
try {
  const response = await fetch(rpc, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "eth_chainId", params: [] }) });
  const body = await response.json();
  if (body.result !== "0x7a69") throw new Error(body.error?.message || `chain id is ${body.result}`);
} catch (error) {
  fail(`Anvil RPC is unreachable or is not chain 31337 at ${rpc} (${error.message})`);
}

function run(command, args, extraEnv = {}) {
  const result = spawnSync(command, args, { cwd: root, stdio: "inherit", env: { ...env, ...extraEnv } });
  if (result.error) fail(`${command} failed to start: ${result.error.message}`);
  if (result.status !== 0) process.exit(result.status ?? 1);
}
run(process.execPath, ["node_modules/prisma/build/index.js", "generate", "--schema", "backend/prisma/schema.prisma"]);
run(process.execPath, ["node_modules/prisma/build/index.js", "migrate", "deploy", "--schema", "backend/prisma/schema.prisma"]);
const mnemonic = "test test test test test test test test test test test junk";
const wallets = [HDNodeWallet.fromPhrase(mnemonic, undefined, "m/44'/60'/0'/0/0"), ...Array.from({ length: 5 }, () => Wallet.createRandom())];
const admin = wallets[0];
const publicKey = `0x${admin.signingKey.publicKey.slice(4)}`;
const e2eKeys = wallets.map((wallet) => wallet.privateKey);
run("forge", ["--root", "contracts", "script", "script/Deploy.s.sol:DeployScript", "--rpc-url", rpc, "--broadcast", "--private-key", admin.privateKey], {
  BEL_NETWORK: "local",
  BEL_BOOTSTRAP_ADMIN_WALLET: admin.address,
  BEL_BOOTSTRAP_ADMIN_DID: "DID:BEL:ADMIN",
});
for (const wallet of wallets.slice(1)) {
  const funding = await fetch(rpc, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "anvil_setBalance", params: [wallet.address, "0x56BC75E2D63100000"] }) });
  const fundingBody = await funding.json();
  if (fundingBody.error) fail(`Unable to fund E2E account ${wallet.address}: ${fundingBody.error.message}`);
}
// Node 24 can fail os.userInfo() in constrained Windows CI containers. tsx
// only needs the username to name its temporary directory, so provide the
// equivalent POSIX hook before loading its CLI when it is unavailable.
run(process.execPath, ["--import", "data:text/javascript,process.geteuid=()=>0", "node_modules/tsx/dist/cli.mjs", "scripts/bootstrap-dev.ts"], {
  BEL_ENV: "development",
  BEL_RUN_INTEGRATION: "true",
  BEL_DEV_BOOTSTRAP: "true",
  BEL_BLOCKCHAIN: "evm",
  BEL_CHAIN_RPC_URL: rpc,
  BEL_CHAIN_DEPLOYMENT: env.BEL_CHAIN_DEPLOYMENT || "local",
  BEL_CHAIN_DEV_SIGNER_KEYS: e2eKeys.join(","),
  BEL_BOOTSTRAP_ADMIN_DID: "DID:BEL:ADMIN",
  BEL_BOOTSTRAP_WALLET_ADDRESS: admin.address,
  BEL_BOOTSTRAP_PUBLIC_KEY: publicKey,
  BEL_BOOTSTRAP_CREDENTIAL: "e2e-admin-credential",
  NODE_OPTIONS: `${env.NODE_OPTIONS ? `${env.NODE_OPTIONS} ` : ""}--require=${root}/scripts/node-userinfo-shim.cjs`,
});
const result = spawnSync(process.execPath, ["node_modules/vitest/vitest.mjs", "run", "backend/test/workflow.e2e.test.ts"], {
  cwd: process.cwd(),
  stdio: "inherit",
  env: { ...env, BEL_BLOCKCHAIN: "evm", BEL_E2E_PRIVATE_KEYS: e2eKeys.join(","), BEL_E2E_RPC_URL: rpc, BEL_CHAIN_RPC_URL: rpc, BEL_RUN_E2E: "true", BEL_RUN_INTEGRATION: "true" },
});
if (result.error) {
  console.error(`Unable to start the E2E runner: ${result.error.message}`);
  process.exit(1);
}
process.exit(result.status ?? 1);
