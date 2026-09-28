import http from "node:http";
import { loadOrCreateDevice, signChallenge } from "./wallet.mjs";

const host = "127.0.0.1";
const port = Number(process.env.BEL_DEV_WALLET_PORT || 8787);
const deviceId = process.env.BEL_DEV_DEVICE_ID || "employee-001-device";
const allowedOrigins = new Set(["http://localhost:3000", "http://127.0.0.1:3000", process.env.BEL_DEV_WALLET_ALLOWED_ORIGIN].filter(Boolean));
if (process.env.BEL_ENV === "production") throw new Error("The development wallet cannot run with BEL_ENV=production");

function corsOrigin(req) { return allowedOrigins.has(req.headers.origin || "") ? req.headers.origin : "null"; }
function send(req, res, status, body) { res.writeHead(status, { "content-type": "application/json", "access-control-allow-origin": corsOrigin(req), "access-control-allow-headers": "content-type", "cache-control": "no-store" }); res.end(JSON.stringify(body)); }
function readBody(req) { return new Promise((resolveBody, reject) => { let value = ""; req.on("data", (chunk) => { value += chunk; if (value.length > 16_384) reject(new Error("Request body is too large")); }); req.on("end", () => { try { resolveBody(JSON.parse(value || "{}")); } catch { reject(new Error("Request body must be JSON")); } }); req.on("error", reject); }); }

loadOrCreateDevice(deviceId);
const server = http.createServer(async (req, res) => {
  if (req.method === "OPTIONS") { res.writeHead(204, { "access-control-allow-origin": corsOrigin(req), "access-control-allow-methods": "GET,POST,OPTIONS", "access-control-allow-headers": "content-type" }); return res.end(); }
  try {
    const url = new URL(req.url || "/", `http://${host}:${port}`);
    if (req.method === "GET" && url.pathname === "/identity") return send(req, res, 200, loadOrCreateDevice(url.searchParams.get("deviceId") || deviceId).identity);
    if (req.method === "POST" && url.pathname === "/sign") { const body = await readBody(req); if (body.deviceId !== deviceId) throw new Error("Active development device mismatch"); return send(req, res, 200, await signChallenge(deviceId, body.challenge, body.options)); }
    return send(req, res, 404, { message: "Not found" });
  } catch (error) { return send(req, res, 400, { message: error instanceof Error ? error.message : "Development wallet request failed" }); }
});
server.listen(port, host, () => console.log(`[BEL dev wallet] device=${deviceId} listening on http://${host}:${port}`));
