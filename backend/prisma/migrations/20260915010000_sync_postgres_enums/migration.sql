-- Corrective migration for the already-applied initial schema.
-- The Prisma schema uses PostgreSQL enums; the initial migration created
-- these columns as TEXT. Preserve existing rows while aligning the database
-- types with schema.prisma.

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_type
    WHERE typname = 'IdentityStatus'
      AND typnamespace = 'public'::regnamespace
  ) THEN
    CREATE TYPE "IdentityStatus" AS ENUM ('ACTIVE', 'SUSPENDED', 'REVOKED');
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_type
    WHERE typname = 'WalletStatus'
      AND typnamespace = 'public'::regnamespace
  ) THEN
    CREATE TYPE "WalletStatus" AS ENUM ('PENDING', 'ACTIVE', 'REVOKED');
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_type
    WHERE typname = 'DeviceStatus'
      AND typnamespace = 'public'::regnamespace
  ) THEN
    CREATE TYPE "DeviceStatus" AS ENUM ('ACTIVE', 'REVOKED');
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_type
    WHERE typname = 'GrantStatus'
      AND typnamespace = 'public'::regnamespace
  ) THEN
    CREATE TYPE "GrantStatus" AS ENUM ('ACTIVE', 'REVOKED', 'EXPIRED');
  END IF;
END $$;

ALTER TABLE "Identity"
  ALTER COLUMN "status" TYPE "IdentityStatus"
  USING "status"::"IdentityStatus";

ALTER TABLE "User"
  ALTER COLUMN "status" TYPE "IdentityStatus"
  USING "status"::"IdentityStatus";

ALTER TABLE "Device"
  ALTER COLUMN "status" TYPE "DeviceStatus"
  USING "status"::"DeviceStatus";

ALTER TABLE "Wallet"
  ALTER COLUMN "status" TYPE "WalletStatus"
  USING "status"::"WalletStatus";

ALTER TABLE "AuthorizationGrant"
  ALTER COLUMN "status" TYPE "GrantStatus"
  USING "status"::"GrantStatus";

-- These constraints are guarded because the current checked-in initial
-- migration contains them, while some databases may have applied an earlier
-- copy before they were added.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'AuthorizationGrant_actorIdentityId_fkey'
  ) THEN
    ALTER TABLE "AuthorizationGrant"
      ADD CONSTRAINT "AuthorizationGrant_actorIdentityId_fkey"
      FOREIGN KEY ("actorIdentityId") REFERENCES "Identity"("identityId");
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'AuthorizationGrant_grantedByIdentityId_fkey'
  ) THEN
    ALTER TABLE "AuthorizationGrant"
      ADD CONSTRAINT "AuthorizationGrant_grantedByIdentityId_fkey"
      FOREIGN KEY ("grantedByIdentityId") REFERENCES "Identity"("identityId");
  END IF;
END $$;
