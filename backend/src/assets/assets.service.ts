// Owner: Person 2. Backs GET/POST /assets, GET /assets/:id,
// POST /assets/:id/transfer (docs/API_SPEC.yaml).
// Covers: Asset creation, Asset transfer, Asset state change
// (docs/SYSTEM_SPEC.md Core Workflows). Use mock identities from
// backend/src/users until Person 1's service is ready.

import { Asset } from "../../../shared/types";
import { BlockchainService } from "../adapters/BlockchainService";
import { NotImplementedError } from "../errors";

export interface AssetsService {
  list(): Promise<Asset[]>;
  getById(id: string): Promise<Asset | null>;
  create(input: Partial<Asset>): Promise<Asset>;
  transfer(id: string, newOwnerId: string): Promise<Asset>;
}

export class AssetsServiceImpl implements AssetsService {
  constructor(private readonly chain: BlockchainService) {}

  async list(): Promise<Asset[]> {
    throw new NotImplementedError("AssetsService.list()");
  }

  async getById(_id: string): Promise<Asset | null> {
    throw new NotImplementedError("AssetsService.getById()");
  }

  async create(_input: Partial<Asset>): Promise<Asset> {
    // TODO: ASSET_MINT tx via this.chain, per docs/CONTRACT_SPEC.md.
    throw new NotImplementedError("AssetsService.create()");
  }

  async transfer(_id: string, _newOwnerId: string): Promise<Asset> {
    // TODO: ASSET_TRANSFER tx via this.chain. Enforce RBAC_MATRIX.md's
    // "Transfer asset" row (Engineer only if explicitly `auth`orized).
    throw new NotImplementedError("AssetsService.transfer()");
  }
}
