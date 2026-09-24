export type Evidence = {
  evidenceId: string;
  jobId: string;
  cid: string;
  sha256: string;
  originalFilename: string;
  contentType: string;
  sizeBytes: number;
  uploadedBy: string;
  createdAt: string;
  updatedAt: string;
};

import type { Role } from "../../../shared/types";

export type EvidenceActor = {
  identityId: string;
  walletAddress: string;
  role: Role;
};

export type EvidenceUpload = {
  bytes: Buffer;
  filename: string;
  contentType: string;
};
