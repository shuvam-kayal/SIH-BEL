CREATE TABLE "ValidatorRegistration" (
  "registrationId" TEXT NOT NULL,
  "validatorId" TEXT NOT NULL,
  "identityId" TEXT NOT NULL,
  "walletAddress" TEXT NOT NULL,
  "nodeId" TEXT NOT NULL,
  "nodeAddress" TEXT NOT NULL,
  "publicKey" TEXT NOT NULL,
  "signingPublicKey" TEXT NOT NULL,
  "status" TEXT NOT NULL,
  "requestedAt" TIMESTAMP(3) NOT NULL,
  "approvedAt" TIMESTAMP(3),
  "approvedBy" TEXT,
  "activationHeight" INTEGER,
  "removalHeight" INTEGER,
  "removedAt" TIMESTAMP(3),
  "removalReason" TEXT,
  CONSTRAINT "ValidatorRegistration_pkey" PRIMARY KEY ("registrationId")
);
CREATE UNIQUE INDEX "ValidatorRegistration_validatorId_key" ON "ValidatorRegistration"("validatorId");
