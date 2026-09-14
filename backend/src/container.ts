// Phase 9 plug-and-play wiring. This is the ONLY file that names a
// concrete BlockchainService implementation. Services receive it by
// constructor injection, so swapping the mock for the real chain at
// integration time (Phase 12, step 8) is a one-line change here and
// touches nothing else.

import { MockBlockchainAdapter } from "../../mocks/mock-blockchain";
import type { BlockchainService } from "./adapters/BlockchainService";
import { AssetsServiceImpl, type AssetsService } from "./assets/assets.service";
import { AuditServiceImpl, type AuditService } from "./audit/audit.service";
import { AuthServiceImpl, type AuthService } from "./auth/auth.service";
import { BlockchainController } from "./blockchain/blockchain.controller";
import { JobsServiceImpl, type JobsService } from "./jobs/jobs.service";
import { UsersServiceImpl, type UsersService } from "./users/users.service";

export type Container = {
  chain: BlockchainService;
  auth: AuthService;
  users: UsersService;
  assets: AssetsService;
  jobs: JobsService;
  audit: AuditService;
  blockchain: BlockchainController;
};

export function createContainer(chain: BlockchainService = new MockBlockchainAdapter()): Container {
  // At Phase 12: pass a RealBlockchainAdapter here instead. Everything
  // below is written against the interface and needs no edit.
  return {
    chain,
    auth: new AuthServiceImpl(),
    users: new UsersServiceImpl(chain),
    assets: new AssetsServiceImpl(chain),
    jobs: new JobsServiceImpl(chain),
    audit: new AuditServiceImpl(),
    blockchain: new BlockchainController(chain),
  };
}
