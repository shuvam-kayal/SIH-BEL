// Owner: Person 1. Backs POST /admin/users, POST /admin/users/:id/revoke-wallet,
// GET /users/me, GET /users/:id (docs/API_SPEC.yaml).
// Covers: Employee provisioning, Wallet activation, Wallet revocation
// (docs/SYSTEM_SPEC.md Core Workflows).

import { User, Identity, Wallet } from "../../../shared/types";
import { BlockchainService } from "../adapters/BlockchainService";
import { NotImplementedError } from "../errors";

export interface UsersService {
  createUser(input: Partial<Identity>): Promise<User>;
  revokeWallet(userId: string, reason: string): Promise<Wallet>;
  activateWallet(userId: string, deviceId: string): Promise<Wallet>;
  getById(id: string): Promise<User | null>;
}

export class UsersServiceImpl implements UsersService {
  constructor(private readonly chain: BlockchainService) {}

  async createUser(_input: Partial<Identity>): Promise<User> {
    // TODO: create Identity, then IDENTITY_CREATE tx via this.chain.
    throw new NotImplementedError("UsersService.createUser()");
  }

  async revokeWallet(_userId: string, _reason: string): Promise<Wallet> {
    // TODO: mark Wallet REVOKED, then WALLET_REVOKE tx via this.chain.
    // Per RBAC_MATRIX.md, only ADMIN may call this at the route layer.
    throw new NotImplementedError("UsersService.revokeWallet()");
  }

  async activateWallet(_userId: string, _deviceId: string): Promise<Wallet> {
    // TODO: bind a new Wallet to the managed device, then
    // WALLET_ACTIVATE tx via this.chain.
    throw new NotImplementedError("UsersService.activateWallet()");
  }

  async getById(_id: string): Promise<User | null> {
    throw new NotImplementedError("UsersService.getById()");
  }
}
