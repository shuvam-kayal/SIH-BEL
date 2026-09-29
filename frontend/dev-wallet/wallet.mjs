import { createCipheriv, createDecipheriv, randomBytes, scryptSync } from "node:crypto";
import { chmodSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { Wallet, Signature } from "ethers";

const DEVICE_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/;
const CHALLENGE_PATTERN = /^[A-Za-z0-9_-]{43}$/;
const OPERATION_PATTERN = /^[A-Z][A-Z0-9_]{1,63}$/;

function requiredSecret() {
  const value = process.env.BEL_DEV_WALLET_SECRET;
  if (!value || value.length < 16) throw new Error("BEL_DEV_WALLET_SECRET must contain at least 16 characters");
  return value;
}

const moduleRoot = dirname(fileURLToPath(import.meta.url));
function devicesRoot() { return resolve(process.env.BEL_DEV_WALLET_DIR || join(moduleRoot, ".bel-dev", "devices")); }
function validateDeviceId(deviceId) { if (!DEVICE_ID_PATTERN.test(deviceId)) throw new Error("Invalid development device id"); }
function devicePath(deviceId) { validateDeviceId(deviceId); return join(devicesRoot(), deviceId, "wallet.json"); }

function keyFromSecret(secret, salt) { return scryptSync(secret, salt, 32); }

function encryptPrivateKey(privateKey) {
  const salt = randomBytes(16); const iv = randomBytes(12); const cipher = createCipheriv("aes-256-gcm", keyFromSecret(requiredSecret(), salt), iv);
  const ciphertext = Buffer.concat([cipher.update(privateKey, "utf8"), cipher.final()]);
  return { algorithm: "aes-256-gcm", salt: salt.toString("base64url"), iv: iv.toString("base64url"), tag: cipher.getAuthTag().toString("base64url"), ciphertext: ciphertext.toString("base64url") };
}

function decryptPrivateKey(record) {
  if (record?.algorithm !== "aes-256-gcm") throw new Error("Unsupported development wallet keystore");
  const decipher = createDecipheriv("aes-256-gcm", keyFromSecret(requiredSecret(), Buffer.from(record.salt, "base64url")), Buffer.from(record.iv, "base64url"));
  decipher.setAuthTag(Buffer.from(record.tag, "base64url"));
  return Buffer.concat([decipher.update(Buffer.from(record.ciphertext, "base64url")), decipher.final()]).toString("utf8");
}

function publicKeyWire(wallet) { return `0x${wallet.signingKey.publicKey.slice(4)}`; }

function importKeyIfConfigured() {
  const direct = process.env.BEL_DEV_DEVICE_IMPORT_KEY?.trim();
  const path = process.env.BEL_DEV_DEVICE_IMPORT_KEY_FILE;
  const value = direct ?? (path ? readFileSync(resolve(path), "utf8").trim() : undefined);
  if (value === undefined) return undefined;
  if (!/^0x[0-9a-fA-F]{64}$/.test(value)) throw new Error("Imported development private key must be a 32-byte hex key");
  return value;
}

export function loadOrCreateDevice(deviceId) {
  const path = devicePath(deviceId); mkdirSync(dirname(path), { recursive: true });
  let record;
  if (existsSync(path)) record = JSON.parse(readFileSync(path, "utf8"));
  else {
    const generatedKey = `0x${randomBytes(32).toString("hex")}`;
    const wallet = new Wallet(importKeyIfConfigured() || generatedKey);
    record = { version: 1, deviceId, publicKey: publicKeyWire(wallet), walletAddress: wallet.address, privateKey: encryptPrivateKey(wallet.privateKey) };
    writeFileSync(path, `${JSON.stringify(record, null, 2)}\n`, { mode: 0o600 });
    try { chmodSync(path, 0o600); } catch { /* Windows ACLs are deployment-owned. */ }
  }
  if (record.deviceId !== deviceId) throw new Error("Development wallet device binding mismatch");
  const wallet = new Wallet(decryptPrivateKey(record.privateKey));
  if (wallet.address !== record.walletAddress || publicKeyWire(wallet).toLowerCase() !== String(record.publicKey).toLowerCase()) throw new Error("Development wallet keystore integrity check failed");
  return { wallet, identity: { deviceId, publicKey: record.publicKey, walletAddress: record.walletAddress }, keystorePath: path };
}

export async function signChallenge(deviceId, challenge, options) {
  if (!CHALLENGE_PATTERN.test(challenge)) throw new Error("Challenge must be the backend's 43-character base64url value");
  if (!options || options.requireUserVerification !== true || !OPERATION_PATTERN.test(options.operation)) throw new Error("Development wallet requires an explicit operation and requireUserVerification=true");
  const device = loadOrCreateDevice(deviceId);
  const standard = await device.wallet.signMessage(challenge);
  const parsed = Signature.from(standard);
  const compact = `0x${Number(parsed.yParity).toString(16).padStart(2, "0")}${parsed.r.slice(2)}${parsed.s.slice(2)}`;
  return { ...device.identity, signature: compact, developmentUserVerification: true };
}
