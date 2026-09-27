ALTER TABLE "ValidatorRegistration" DROP COLUMN IF EXISTS "approvedAt";
ALTER TABLE "ValidatorRegistration" DROP COLUMN IF EXISTS "approvedBy";
ALTER TABLE "ValidatorRegistration" DROP COLUMN IF EXISTS "removedAt";
ALTER TABLE "ValidatorRegistration" ALTER COLUMN "activationHeight" SET NOT NULL;
ALTER TABLE "ValidatorRegistration" ADD COLUMN IF NOT EXISTS "txHash" TEXT;
ALTER TABLE "ValidatorRegistration" ADD COLUMN IF NOT EXISTS "blockNumber" INTEGER;
CREATE TABLE "ValidatorHistory" (
  "historyId" TEXT NOT NULL,
  "validatorId" TEXT NOT NULL,
  "operation" TEXT NOT NULL,
  "actorIdentityId" TEXT NOT NULL,
  "actorWallet" TEXT NOT NULL,
  "timestamp" TIMESTAMP(3) NOT NULL,
  "blockNumber" INTEGER,
  "transactionHash" TEXT,
  "previousState" TEXT,
  "newState" TEXT NOT NULL,
  "reason" TEXT,
  "status" TEXT NOT NULL,
  "inverseTransactionHash" TEXT,
  CONSTRAINT "ValidatorHistory_pkey" PRIMARY KEY ("historyId")
);
CREATE INDEX "ValidatorHistory_validatorId_timestamp_idx" ON "ValidatorHistory"("validatorId", "timestamp");
CREATE TABLE "NotificationDelivery" (
  "notificationId" TEXT NOT NULL,
  "eventType" TEXT NOT NULL,
  "validatorId" TEXT NOT NULL,
  "operation" TEXT NOT NULL,
  "recipientIdentityId" TEXT NOT NULL,
  "channel" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL,
  "status" TEXT NOT NULL,
  CONSTRAINT "NotificationDelivery_pkey" PRIMARY KEY ("notificationId")
);
CREATE INDEX "NotificationDelivery_validatorId_createdAt_idx" ON "NotificationDelivery"("validatorId", "createdAt");
