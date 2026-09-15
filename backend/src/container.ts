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
  prisma?: PrismaClient;
};

export type ContainerOptions = { repositories?: IdentityRepositories; integrity?: IntegrityAdapter; prisma?: PrismaClient };

export function createContainer(chain: BlockchainService = new MockBlockchainAdapter(), options: ContainerOptions = {}): Container {
  // The integrity adapter is likewise injectable; the real permissioned-chain
  // adapter replaces MemoryIntegrityAdapter when that chain endpoint exists.
  const prisma = options.prisma ?? (options.repositories ? undefined : process.env.DATABASE_URL ? new PrismaClient() : undefined);
  const repositories = options.repositories ?? (prisma ? createPrismaRepositories(prisma) : createMemoryRepositories());
  const integrity = options.integrity ?? new MemoryIntegrityAdapter();
  return {
    chain,
    repositories,
    integrity,
    prisma,
    auth: new AuthServiceImpl(repositories),
    users: new UsersServiceImpl(chain, repositories, integrity),
    assets: new AssetsServiceImpl(chain),
    jobs: new JobsServiceImpl(chain),
    audit: new AuditServiceImpl(),
    blockchain: new BlockchainController(chain),
  };
}
