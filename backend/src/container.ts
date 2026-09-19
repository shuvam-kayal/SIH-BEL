// Plug-and-play wiring. Services receive the BlockchainService by
// constructor injection. The implementation is chosen by BEL_BLOCKCHAIN
// (default "mock"; "evm" for the real contracts) in
// blockchain/factory.ts, so swapping chains touches nothing else.

import { createBlockchainServiceFromEnv } from "./blockchain/factory";
import { PrismaClient } from "@prisma/client";
import type { BlockchainService } from "./adapters/BlockchainService";
import { AssetsServiceImpl, type AssetsService } from "./assets/assets.service";
import { AuditServiceImpl, type AuditService } from "./audit/audit.service";
import { AuthServiceImpl, type AuthService } from "./auth/auth.service";
import { BlockchainController } from "./blockchain/blockchain.controller";
import { JobsServiceImpl, type JobsService } from "./jobs/jobs.service";
import { UsersServiceImpl, type UsersService } from "./users/users.service";
import { createMemoryRepositories, createPrismaRepositories } from "./users/repository-implementations";
import type { IdentityRepositories } from "./users/repositories";
import { MemoryIntegrityAdapter, type IntegrityAdapter } from "./integrity/integrity";
import { MockDeviceAttestationAdapter, RejectingDeviceAttestationAdapter, type DeviceAttestationAdapter } from "./devices/device-attestation";

export type Container = {
  chain: BlockchainService;
  auth: AuthService;
  users: UsersService;
  assets: AssetsService;
  jobs: JobsService;
  audit: AuditService;
  blockchain: BlockchainController;
  repositories: IdentityRepositories;
  integrity: IntegrityAdapter;
  attestation: DeviceAttestationAdapter;
  prisma?: PrismaClient;
};

export type ContainerOptions = { repositories?: IdentityRepositories; integrity?: IntegrityAdapter; attestation?: DeviceAttestationAdapter; prisma?: PrismaClient };

export function createContainer(chain: BlockchainService = createBlockchainServiceFromEnv(), options: ContainerOptions = {}): Container {
  // Development may use the recording adapter, but production must provide
  // an explicit durable adapter backed by the permissioned blockchain.
  const production = process.env.BEL_ENV === "production";
  if (production && (!process.env.DATABASE_URL || !options.integrity || !options.attestation || options.repositories)) {
    throw new Error("Production requires DATABASE_URL and an explicit durable integrity adapter; an explicit device-attestation adapter is also required");
  }
  const prisma = options.prisma ?? (process.env.DATABASE_URL ? new PrismaClient() : undefined);
  const repositories = options.repositories ?? (prisma ? createPrismaRepositories(prisma) : createMemoryRepositories());
  const integrity = options.integrity ?? new MemoryIntegrityAdapter();
  const useMockAttestation = !production && process.env.BEL_DEVICE_ATTESTATION === "mock";
  const approvedDeviceIds = (process.env.BEL_MOCK_APPROVED_DEVICE_IDS ?? "").split(",").map((id) => id.trim()).filter(Boolean);
  const attestation = options.attestation ?? (useMockAttestation ? new MockDeviceAttestationAdapter(approvedDeviceIds) : new RejectingDeviceAttestationAdapter());
  return {
    chain,
    repositories,
    integrity,
    attestation,
    prisma,
    auth: new AuthServiceImpl(repositories),
    users: new UsersServiceImpl(chain, repositories, integrity, attestation),
    assets: new AssetsServiceImpl(chain),
    jobs: new JobsServiceImpl(chain),
    audit: new AuditServiceImpl(),
    blockchain: new BlockchainController(chain),
  };
}
