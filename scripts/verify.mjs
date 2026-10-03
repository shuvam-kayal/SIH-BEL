import fs from "node:fs";
import path from "node:path";
import net from "node:net";
import { spawn } from "node:child_process";
import { loadEnvFile } from "node:process";
import { fileURLToPath } from "node:url";
import { Wallet } from "ethers";

const __filename = fileURLToPath(import.meta.url);
const scriptsDir = path.dirname(__filename);
const root = path.resolve(scriptsDir, "..");

const rootEnv = path.join(root, ".env");
const backendEnv = path.join(root, "backend", ".env");

try {
  if (fs.existsSync(rootEnv)) {
    loadEnvFile(rootEnv);
  }

  if (fs.existsSync(backendEnv)) {
    loadEnvFile(backendEnv);
  }
} catch (error) {
  console.error(`Failed to load environment files: ${error.message}`);
  process.exit(1);
}

function log(message) {
  console.log(`\n=== ${message} ===`);
}

function fail(message) {
  console.error(`\nVERIFY FAILED: ${message}`);
  process.exit(1);
}

function commandExists(filePath) {
  return fs.existsSync(filePath);
}

function run(command, args = [], options = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      cwd: options.cwd ?? root,
      env: {
        ...process.env,
        ...(options.env ?? {}),
      },
      stdio: "inherit",
      shell: false,
    });

    child.on("error", reject);

    child.on("close", (code, signal) => {
      resolve({
        code: code ?? 1,
        signal,
      });
    });
  });
}

async function runChecked(label, command, args = [], options = {}) {
  log(label);

  const result = await run(command, args, options);

  if (result.signal) {
    fail(`${label} terminated by signal ${result.signal}`);
  }

  if (result.code !== 0) {
    fail(`${label} exited with status ${result.code}`);
  }

  console.log(`✓ ${label}`);
}

function waitForTcp(host, port, timeoutMs = 10000) {
  return new Promise((resolve, reject) => {
    const socket = new net.Socket();

    const timer = setTimeout(() => {
      socket.destroy();
      reject(new Error(`TCP connection timeout: ${host}:${port}`));
    }, timeoutMs);

    socket.once("connect", () => {
      clearTimeout(timer);
      socket.destroy();
      resolve();
    });

    socket.once("error", (error) => {
      clearTimeout(timer);
      socket.destroy();
      reject(error);
    });

    socket.connect(port, host);
  });
}

async function checkEvmRpc() {
  const rpcUrl = process.env.BEL_EVM_RPC_URL || process.env.BEL_CHAIN_RPC_URL;
  if (!rpcUrl) fail("BEL_EVM_RPC_URL or BEL_CHAIN_RPC_URL must identify a live Besu endpoint; verify never defaults to Anvil");

  const url = new URL(rpcUrl);

  if (url.hostname !== "127.0.0.1" && url.hostname !== "localhost") {
    console.log(`Using EVM RPC: ${rpcUrl}`);
  }

  try {
    const response = await fetch(rpcUrl, {
      method: "POST",
      headers: {
        "content-type": "application/json",
      },
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: 1,
        method: "eth_chainId",
        params: [],
      }),
    });

    if (!response.ok) {
      throw new Error(`HTTP ${response.status}`);
    }

    const body = await response.json();
    if (body.error || !body.result) throw new Error(body.error?.message || "eth_chainId returned no result");
    const chainId = BigInt(body.result);
    const deploymentName = process.env.BEL_CHAIN_DEPLOYMENT || "besu-prototype";
    const deploymentPath = path.join(root, "contracts", "deployments", `${deploymentName}.json`);
    if (!fs.existsSync(deploymentPath)) throw new Error(`deployment file is missing: ${deploymentPath}`);
    const deployment = JSON.parse(fs.readFileSync(deploymentPath, "utf8"));
    if (BigInt(deployment.chainId) !== chainId) throw new Error(`Besu chain ${chainId} does not match ${deploymentName} deployment chain ${deployment.chainId}`);
    const call = async (method) => {
      const result = await fetch(rpcUrl, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ jsonrpc: "2.0", id: method, method, params: [] }) });
      const value = await result.json();
      if (value.error) throw new Error(value.error.message);
      return value.result;
    };
    const [client, block, peers] = await Promise.all([call("web3_clientVersion"), call("eth_blockNumber"), call("net_peerCount")]);
    if (!String(client).toLowerCase().includes("besu")) throw new Error(`expected Besu client metadata, got ${client}`);
    console.log(`✓ Besu reachable: rpc=${rpcUrl} chainId=${chainId} client=${client} block=${BigInt(block)} peers=${BigInt(peers)} deployment=${deploymentName}`);
  } catch (error) {
    fail(`EVM RPC check failed: ${error.message}`);
  }
}

async function checkPostgres() {
  const databaseUrl = process.env.DATABASE_URL;

  if (!databaseUrl) {
    fail("DATABASE_URL is not set");
  }

  let url;

  try {
    url = new URL(databaseUrl);
  } catch {
    fail("DATABASE_URL is not a valid URL");
  }

  const host = url.hostname || "127.0.0.1";
  const port = Number(url.port || 5432);

  try {
    await waitForTcp(host, port);
    console.log(`✓ PostgreSQL reachable at ${host}:${port}`);
  } catch (error) {
    fail(`PostgreSQL is not reachable at ${host}:${port}: ${error.message}`);
  }
}

async function main() {
  console.log("==============================================");
  console.log(" BEL Decentralized Platform Verification");
  console.log("==============================================");

  /*
   * ------------------------------------------------------------
   * 1. Environment
   * ------------------------------------------------------------
   */

  log("Environment");

  if (!process.env.DATABASE_URL) {
    fail("DATABASE_URL is not set");
  }

  console.log(`Node: ${process.version}`);
  console.log(`Root: ${root}`);
  console.log(`EVM: ${process.env.BEL_EVM_RPC_URL || process.env.BEL_CHAIN_RPC_URL || "<unset>"}`);

  /*
   * ------------------------------------------------------------
   * 2. Infrastructure
   * ------------------------------------------------------------
   */

  await checkPostgres();
  await checkEvmRpc();

  /*
   * ------------------------------------------------------------
   * 3. Prisma
   * ------------------------------------------------------------
   */

  const prismaSchema = path.join(
  root,
  "backend",
  "prisma",
  "schema.prisma"
);

if (!fs.existsSync(prismaSchema)) {
  fail(`Prisma schema not found: ${prismaSchema}`);
}

await runChecked(
  "Prisma generate",
  process.execPath,
  [
    path.join(root, "node_modules", "prisma", "build", "index.js"),
    "generate",
    "--schema",
    prismaSchema,
  ]
);

await runChecked(
  "Prisma migrations",
  process.execPath,
  [
    path.join(root, "node_modules", "prisma", "build", "index.js"),
    "migrate",
    "deploy",
    "--schema",
    prismaSchema,
  ]
);

  /*
   * ------------------------------------------------------------
   * 4. Solidity / Foundry
   *
   * IMPORTANT:
   * Do NOT run Vitest from the repository root.
   * Foundry owns contracts/lib/openzeppelin-contracts/test.
   * ------------------------------------------------------------
   */

  await runChecked(
    "Solidity contract tests",
    process.execPath,
    [
      path.join(root, "scripts", "test-contracts.mjs"),
    ]
  );

  /*
   * ------------------------------------------------------------
   * 5. TypeScript checks
   * ------------------------------------------------------------
   */

  const typecheckConfigs = [
    ["shared", "shared/tsconfig.json"],
    ["backend", "backend/tsconfig.json"],
    ["frontend", "frontend/tsconfig.json"],
    ["mock-api", "mock-api/tsconfig.json"],
    ["mock-blockchain", "mock-blockchain/tsconfig.json"],
  ];

  const tscPath = path.join(
    root,
    "node_modules",
    "typescript",
    "bin",
    "tsc"
  );

  for (const [name, config] of typecheckConfigs) {
    const configPath = path.join(root, config);

    if (!commandExists(configPath)) {
      console.log(`⚠ Skipping ${name} typecheck: ${config} not found`);
      continue;
    }

    await runChecked(
      `Typecheck: ${name}`,
      process.execPath,
      [
        tscPath,
        "--noEmit",
        "-p",
        configPath,
      ]
    );
  }

  /*
   * ------------------------------------------------------------
   * 6. Backend tests
   *
   * Run Vitest with backend/ as cwd.
   *
   * This prevents Vitest from discovering:
   * contracts/lib/openzeppelin-contracts/test/**
   * frontend/test/**
   * etc.
   * ------------------------------------------------------------
   */

  const e2eKeys = (process.env.BEL_E2E_PRIVATE_KEYS ?? "")
    .split(",")
    .map((key) => key.trim())
    .filter(Boolean);
  if (e2eKeys.length > 0) {
    const admin = new Wallet(e2eKeys[0]);
    await runChecked(
      "Development bootstrap admin",
      process.execPath,
      [
        path.join(root, "node_modules", "tsx", "dist", "cli.mjs"),
        path.join(root, "scripts", "bootstrap-dev.ts"),
      ],
      {
        env: {
          BEL_ENV: "development",
          BEL_DEV_BOOTSTRAP: "true",
          BEL_BLOCKCHAIN: "evm",
          BEL_RUN_INTEGRATION: "true",
          BEL_CHAIN_RPC_URL: process.env.BEL_CHAIN_RPC_URL || process.env.BEL_EVM_RPC_URL,
          BEL_CHAIN_DEPLOYMENT: process.env.BEL_CHAIN_DEPLOYMENT || "besu-prototype",
          BEL_CHAIN_TX_TIMEOUT_MS: process.env.BEL_CHAIN_TX_TIMEOUT_MS || "120000",
          BEL_BOOTSTRAP_ADMIN_DID: process.env.BEL_BOOTSTRAP_ADMIN_DID || "DID:BEL:ADMIN",
          BEL_BOOTSTRAP_WALLET_ADDRESS: admin.address,
          BEL_BOOTSTRAP_PUBLIC_KEY: `0x${admin.signingKey.publicKey.slice(4)}`,
        },
      },
    );
  }

  const vitestPath = path.join(
    root,
    "node_modules",
    "vitest",
    "vitest.mjs"
  );

  await runChecked(
    "Backend tests",
    process.execPath,
    [
      vitestPath,
      "run",
      "--pool",
      "forks",
      "--no-file-parallelism",
      "--exclude",
      "test/workflow.e2e.test.ts",
    ],
    {
      cwd: path.join(root, "backend"),
      env: {
        BEL_RUN_INTEGRATION: "true",
        BEL_CHAIN_TX_TIMEOUT_MS: process.env.BEL_CHAIN_TX_TIMEOUT_MS || "120000",
      },
    }
  );

  /*
   * ------------------------------------------------------------
   * 7. Frontend tests
   *
   * React Testing Library requires a DOM.
   * Vitest's default environment is Node, so explicitly use jsdom.
   * ------------------------------------------------------------
   */

  const frontendPackage = path.join(
    root,
    "frontend",
    "package.json"
  );

  if (fs.existsSync(frontendPackage)) {
    await runChecked(
      "Frontend tests",
      process.execPath,
      [
        vitestPath,
        "run",
        "--environment",
        "jsdom",
      ],
      {
        cwd: path.join(root, "frontend"),
      }
    );
  } else {
    console.log("⚠ frontend/package.json not found; skipping frontend tests");
  }

  /*
   * ------------------------------------------------------------
   * 8. Full authentication/job E2E workflow
   * ------------------------------------------------------------
   */

  await runChecked(
    "Authentication + Job E2E workflow",
    process.execPath,
    [
      path.join(root, "scripts", "test-e2e-workflow.mjs"),
    ],
    {
      env: {
        BEL_RUN_INTEGRATION: "true",
        BEL_EXECUTION_PROFILE: "prototype",
        BEL_BOOTSTRAP_VALIDATOR_COUNT: "4",
        BEL_BLOCKCHAIN: "evm",
        BEL_CHAIN_RPC_URL: process.env.BEL_CHAIN_RPC_URL || process.env.BEL_EVM_RPC_URL,
        BEL_E2E_RPC_URL: process.env.BEL_E2E_RPC_URL || process.env.BEL_CHAIN_RPC_URL || process.env.BEL_EVM_RPC_URL,
        BEL_CHAIN_DEPLOYMENT: process.env.BEL_CHAIN_DEPLOYMENT || "besu-prototype",
        BEL_CHAIN_TX_TIMEOUT_MS: process.env.BEL_CHAIN_TX_TIMEOUT_MS || "120000",
        BEL_E2E_PRIVATE_KEYS: process.env.BEL_E2E_PRIVATE_KEYS,
        BEL_E2E_CHAIN_ID: process.env.BEL_E2E_CHAIN_ID,
      },
    }
  );

  /*
   * ------------------------------------------------------------
   * 9. Final result
   * ------------------------------------------------------------
   */

  console.log("\n==============================================");
  console.log(" VERIFY PASSED");
  console.log("==============================================");
}

main().catch((error) => {
  console.error("\nVERIFY FAILED:");
  console.error(error);
  process.exit(1);
});
