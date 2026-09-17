-- Pending employee self-initialization lifecycle. Private keys are never
-- represented in this schema; only public keys and non-secret evidence exist.
ALTER TYPE "IdentityStatus" ADD VALUE IF NOT EXISTS 'PENDING';
ALTER TYPE "DeviceStatus" ADD VALUE IF NOT EXISTS 'PENDING';

ALTER TABLE "Identity"
  ALTER COLUMN "employeeId" DROP NOT NULL,
  ALTER COLUMN "role" DROP NOT NULL,
  ALTER COLUMN "department" DROP NOT NULL,
  ADD COLUMN IF NOT EXISTS "verifiedAt" TIMESTAMP,
  ADD COLUMN IF NOT EXISTS "verifiedBy" TEXT;

ALTER TABLE "Device"
  ADD COLUMN IF NOT EXISTS "activatedAt" TIMESTAMP,
  ADD COLUMN IF NOT EXISTS "publicKey" TEXT,
  ADD COLUMN IF NOT EXISTS "metadata" JSONB;

ALTER TABLE "Wallet"
  ADD COLUMN IF NOT EXISTS "publicKey" TEXT;

CREATE TABLE IF NOT EXISTS "ProvisioningChallenge" (
  "challengeId" TEXT PRIMARY KEY,
  "deviceId" TEXT NOT NULL,
  "challenge" TEXT NOT NULL UNIQUE,
  "purpose" TEXT NOT NULL,
  "expiresAt" TIMESTAMP NOT NULL,
  "usedAt" TIMESTAMP,
  "metadata" JSONB
);
