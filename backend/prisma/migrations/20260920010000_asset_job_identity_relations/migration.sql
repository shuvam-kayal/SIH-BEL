ALTER TABLE "JobRecord" ALTER COLUMN "assignedTo" DROP NOT NULL;
ALTER TABLE "AssetRecord" ADD CONSTRAINT "AssetRecord_ownerId_fkey" FOREIGN KEY ("ownerId") REFERENCES "Identity"("identityId") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "AssetRecord" ADD CONSTRAINT "AssetRecord_custodianId_fkey" FOREIGN KEY ("custodianId") REFERENCES "Identity"("identityId") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "JobRecord" ADD CONSTRAINT "JobRecord_createdBy_fkey" FOREIGN KEY ("createdBy") REFERENCES "Identity"("identityId") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "JobRecord" ADD CONSTRAINT "JobRecord_assignedTo_fkey" FOREIGN KEY ("assignedTo") REFERENCES "Identity"("identityId") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "JobRecord" ADD CONSTRAINT "JobRecord_verifierId_fkey" FOREIGN KEY ("verifierId") REFERENCES "Identity"("identityId") ON DELETE RESTRICT ON UPDATE CASCADE;
