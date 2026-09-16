// Plug-and-play wiring. This is the only file that names a concrete
// BlockchainService implementation. Services receive it by constructor
// injection, so swapping the mock for the real chain touches nothing else.

import { MockBlockchainAdapter } from "../../mocks/mock-blockchain";
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
import { RejectingDeviceAttestationAdapter, type DeviceAttestationAdapter } from "./devices/device-attestation";

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

export function createContainer(chain: BlockchainService = new MockBlockchainAdapter(), options: ContainerOptions = {}): Container {
  // Development may use the recording adapter, but production must provide
  // an explicit durable adapter backed by the permissioned blockchain.
  const production = process.env.BEL_ENV === "production";
  if (production && (!process.env.DATABASE_URL || !options.integrity || options.repositories)) {
    throw new Error("Production requires DATABASE_URL and an explicit durable integrity adapter");
  }
  const prisma = options.prisma ?? (process.env.DATABASE_URL ? new PrismaClient() : undefined);
  const repositories = options.repositories ?? (prisma ? createPrismaRepositories(prisma) : createMemoryRepositories());
  const integrity = options.integrity ?? new MemoryIntegrityAdapter();
  const attestation = options.attestation ?? new RejectingDeviceAttestationAdapter();
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
