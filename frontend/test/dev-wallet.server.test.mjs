import { afterEach, describe, expect, it } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { spawn } from "node:child_process";

const root = resolve(process.cwd(), "..");
const serverPath = resolve(process.cwd(), "dev-wallet", "server.mjs");
const waitForWallet = (port) => new Promise((resolve, reject) => {
  const deadline = Date.now() + 10_000;
  const poll = async () => {
    try {
      const response = await fetch(`http://127.0.0.1:${port}/identity`);
      if (response.ok) return resolve();
    } catch { /* wallet is still starting */ }
    if (Date.now() >= deadline) return reject(new Error("development wallet did not become ready"));
    setTimeout(poll, 100);
  };
  poll();
});

describe("development wallet server identity boundary", () => {
  let child;
  let directory;
  const port = 18787;

  afterEach(() => {
    if (child && !child.killed) child.kill("SIGTERM");
    if (directory) rmSync(directory, { recursive: true, force: true });
  });

  it("creates a stable configured identity and rejects arbitrary selectors", async () => {
    directory = mkdtempSync(join(tmpdir(), "bel-dev-wallet-server-"));
    child = spawn(process.execPath, [serverPath], {
      cwd: root,
      env: { ...process.env, BEL_DEV_WALLET_SECRET: "development-secret-strong", BEL_DEV_DEVICE_ID: "BEL-DEV-EMPLOYEE-001", BEL_DEV_WALLET_PORT: String(port), BEL_DEV_WALLET_DIR: directory },
      stdio: "ignore",
    });
    await waitForWallet(port);
    const first = await fetch(`http://127.0.0.1:${port}/identity`).then((response) => response.json());
    const second = await fetch(`http://127.0.0.1:${port}/identity`).then((response) => response.json());
    const mismatched = await fetch(`http://127.0.0.1:${port}/identity?deviceId=other-device`);
    const signMismatched = await fetch(`http://127.0.0.1:${port}/sign`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ deviceId: "other-device" }) });

    expect(first.deviceId).toBe("BEL-DEV-EMPLOYEE-001");
    expect(second).toEqual(first);
    expect(mismatched.status).toBe(400);
    expect(signMismatched.status).toBe(400);
  });
});
