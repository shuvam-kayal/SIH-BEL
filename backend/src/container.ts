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
import { MemoryAssetRepository, MemoryJobRepository, PrismaAssetRepository, PrismaJobRepository, type AssetRepository, type JobRepository } from "./domain/repositories";

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

export type ContainerOptions = { repositories?: IdentityRepositories; integrity?: IntegrityAdapter; attestation?: DeviceAttestationAdapter; prisma?: PrismaClient; assets?: AssetRepository; jobs?: JobRepository };

export function createContainer(chain: BlockchainService = createBlockchainServiceFromEnv(), options: ContainerOptions = {}): Container {
  // Development may use the recording adapter, but production must provide
  // an explicit durable adapter backed by the permissioned blockchain.
  const production = process.env.BEL_ENV === "production";
  if (production && (!process.env.DATABASE_URL || !options.integrity || !options.attestation || options.repositories)) {
    throw new Error("Production requires DATABASE_URL and an explicit durable integrity adapter; an explicit device-attestation adapter is also required");
  }
  const prisma = options.prisma ?? ((production || Boolean(options.integrity) || process.env.BEL_RUN_INTEGRATION === "true") && process.env.DATABASE_URL ? new PrismaClient() : undefined);
  const repositories = options.repositories ?? (prisma ? createPrismaRepositories(prisma) : createMemoryRepositories());
  const integrity = options.integrity ?? new MemoryIntegrityAdapter();
  const useMockAttestation = !production && process.env.BEL_DEVICE_ATTESTATION === "mock";
  const approvedDeviceIds = (process.env.BEL_MOCK_APPROVED_DEVICE_IDS ?? "").split(",").map((id) => id.trim()).filter(Boolean);
  const attestation = options.attestation ?? (useMockAttestation ? new MockDeviceAttestationAdapter(approvedDeviceIds) : new RejectingDeviceAttestationAdapter());
  // Unit tests may load DATABASE_URL from the developer .env while using
  // explicit memory identity repositories. Keep those tests hermetic; the
  // real persistence suites pass their Prisma client explicitly, and
  // production always uses the configured database.
  const domainPrisma = options.prisma ?? (production ? prisma : undefined);
  const assetRepository = options.assets ?? (domainPrisma ? new PrismaAssetRepository(domainPrisma) : new MemoryAssetRepository());
  const jobRepository = options.jobs ?? (domainPrisma ? new PrismaJobRepository(domainPrisma) : new MemoryJobRepository());
  const assets = new AssetsServiceImpl(chain, assetRepository);
  return {
    chain,
    repositories,
    integrity,
    attestation,
    prisma,
    auth: new AuthServiceImpl(repositories),
    users: new UsersServiceImpl(chain, repositories, integrity, attestation),
    assets,
    jobs: new JobsServiceImpl(chain, jobRepository, assetRepository),
    audit: new AuditServiceImpl(chain),
    blockchain: new BlockchainController(chain),
  };
}
