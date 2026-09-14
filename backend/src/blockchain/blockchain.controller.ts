import type { BlockchainService } from "../adapters/BlockchainService";
import type { BlockchainStatus, CommitteeResponse } from "../../../shared/api";
import type { Validator } from "../../../shared/types";

export class BlockchainController {
  constructor(private readonly chain: BlockchainService) {}

  async getStatus(): Promise<BlockchainStatus> {
    return this.chain.getStatus();
  }

  async getValidators(): Promise<Validator[]> {
    return this.chain.getValidators();
  }

  async getCommittee(height: number): Promise<CommitteeResponse> {
    return { height, validatorIds: await this.chain.getCommittee(height) };
  }
}
