-- Evidence bytes remain in private IPFS; this table stores only metadata and
-- the integrity anchor used by JobManager.completeJob.
CREATE TABLE "EvidenceRecord" (
    "evidenceId" TEXT NOT NULL,
    "jobId" TEXT NOT NULL,
    "cid" TEXT NOT NULL,
    "sha256" VARCHAR(64) NOT NULL,
    "originalFilename" TEXT NOT NULL,
    "contentType" TEXT NOT NULL,
    "sizeBytes" INTEGER NOT NULL,
    "uploadedBy" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "EvidenceRecord_pkey" PRIMARY KEY ("evidenceId")
);

CREATE UNIQUE INDEX "EvidenceRecord_jobId_sha256_key" ON "EvidenceRecord"("jobId", "sha256");
CREATE INDEX "EvidenceRecord_cid_idx" ON "EvidenceRecord"("cid");
CREATE INDEX "EvidenceRecord_jobId_idx" ON "EvidenceRecord"("jobId");
CREATE INDEX "EvidenceRecord_sha256_idx" ON "EvidenceRecord"("sha256");
CREATE INDEX "EvidenceRecord_uploadedBy_idx" ON "EvidenceRecord"("uploadedBy");

ALTER TABLE "EvidenceRecord" ADD CONSTRAINT "EvidenceRecord_jobId_fkey"
  FOREIGN KEY ("jobId") REFERENCES "JobRecord"("jobId") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "EvidenceRecord" ADD CONSTRAINT "EvidenceRecord_uploadedBy_fkey"
  FOREIGN KEY ("uploadedBy") REFERENCES "Identity"("identityId") ON DELETE RESTRICT ON UPDATE CASCADE;
