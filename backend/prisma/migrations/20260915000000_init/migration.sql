-- Initial PostgreSQL persistence for Person 1 identity/auth state.
-- Generated/managed by Prisma in normal development.
CREATE TABLE "Identity" ("identityId" TEXT PRIMARY KEY, "employeeId" TEXT NOT NULL UNIQUE, "fullName" TEXT NOT NULL, "role" TEXT NOT NULL, "department" TEXT NOT NULL, "status" TEXT NOT NULL, "createdAt" TIMESTAMP NOT NULL);
CREATE TABLE "User" ("employeeId" TEXT PRIMARY KEY, "identityId" TEXT NOT NULL UNIQUE, "walletAddress" TEXT NOT NULL, "role" TEXT NOT NULL, "department" TEXT NOT NULL, "status" TEXT NOT NULL);
CREATE TABLE "Device" ("deviceId" TEXT PRIMARY KEY, "identityId" TEXT NOT NULL, "status" TEXT NOT NULL, "registeredAt" TIMESTAMP NOT NULL, "revokedAt" TIMESTAMP);
CREATE TABLE "Credential" ("id" TEXT PRIMARY KEY, "verifier" TEXT NOT NULL UNIQUE, "deviceId" TEXT NOT NULL, "active" BOOLEAN NOT NULL DEFAULT TRUE);
CREATE TABLE "Wallet" ("address" TEXT PRIMARY KEY, "identityId" TEXT NOT NULL, "deviceId" TEXT NOT NULL, "status" TEXT NOT NULL, "activatedAt" TIMESTAMP, "revokedAt" TIMESTAMP, "revokedReason" TEXT);
CREATE TABLE "Session" ("tokenHash" TEXT PRIMARY KEY, "identityId" TEXT NOT NULL, "deviceId" TEXT NOT NULL, "walletAddress" TEXT NOT NULL, "expiresAt" TIMESTAMP NOT NULL, "revokedAt" TIMESTAMP);
CREATE TABLE "AuthorizationGrant" ("authorizationGrantId" TEXT PRIMARY KEY, "actorIdentityId" TEXT NOT NULL, "resourceType" TEXT NOT NULL, "resourceId" TEXT NOT NULL, "action" TEXT NOT NULL, "grantedByIdentityId" TEXT NOT NULL, "issuedAt" TIMESTAMP NOT NULL, "expiresAt" TIMESTAMP, "status" TEXT NOT NULL);
ALTER TABLE "User" ADD CONSTRAINT "User_identityId_fkey" FOREIGN KEY ("identityId") REFERENCES "Identity"("identityId");
ALTER TABLE "Device" ADD CONSTRAINT "Device_identityId_fkey" FOREIGN KEY ("identityId") REFERENCES "Identity"("identityId");
ALTER TABLE "Credential" ADD CONSTRAINT "Credential_deviceId_fkey" FOREIGN KEY ("deviceId") REFERENCES "Device"("deviceId");
ALTER TABLE "Wallet" ADD CONSTRAINT "Wallet_identityId_fkey" FOREIGN KEY ("identityId") REFERENCES "Identity"("identityId");
ALTER TABLE "AuthorizationGrant" ADD CONSTRAINT "AuthorizationGrant_actorIdentityId_fkey" FOREIGN KEY ("actorIdentityId") REFERENCES "Identity"("identityId");
ALTER TABLE "AuthorizationGrant" ADD CONSTRAINT "AuthorizationGrant_grantedByIdentityId_fkey" FOREIGN KEY ("grantedByIdentityId") REFERENCES "Identity"("identityId");
