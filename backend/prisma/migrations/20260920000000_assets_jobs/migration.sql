CREATE TABLE "AssetRecord" (
    "assetId" TEXT NOT NULL,
    "nftId" TEXT NOT NULL,
    "assetType" TEXT NOT NULL,
    "ownerId" TEXT NOT NULL,
    "custodianId" TEXT NOT NULL,
    "parentAssetId" TEXT,
    "status" TEXT NOT NULL,
    CONSTRAINT "AssetRecord_pkey" PRIMARY KEY ("assetId")
);

CREATE TABLE "JobRecord" (
    "jobId" TEXT NOT NULL,
    "assetId" TEXT NOT NULL,
    "createdBy" TEXT NOT NULL,
    "assignedTo" TEXT NOT NULL,
    "verifierId" TEXT,
    "status" TEXT NOT NULL,
    "priority" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL,
    "completedAt" TIMESTAMP(3),
    CONSTRAINT "JobRecord_pkey" PRIMARY KEY ("jobId")
);

CREATE INDEX "JobRecord_assetId_idx" ON "JobRecord"("assetId");
ALTER TABLE "JobRecord" ADD CONSTRAINT "JobRecord_assetId_fkey" FOREIGN KEY ("assetId") REFERENCES "AssetRecord"("assetId") ON DELETE RESTRICT ON UPDATE CASCADE;
