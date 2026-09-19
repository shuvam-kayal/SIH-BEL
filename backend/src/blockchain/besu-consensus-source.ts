// Person 4 consensus integration: committee data exposed by Besu's
// custom bel_getCommittee JSON-RPC method.
//
// This source intentionally implements only committee retrieval for Stage 1.
// Validator metadata belongs to a separate Person 4 integration and must not
// be fabricated from committee IDs.

import type { AbstractProvider } from "ethers";
import { BlockchainError } from "./errors";
import type { ConsensusInfoSource } from "./evm-adapter";

export type BelCommitteeResponse = {
  height: number;
  validatorIds: string[];
};

function blockTag(height: number): string {
  if (!Number.isSafeInteger(height) || height < 0) {
    throw new BlockchainError("INVALID_PAYLOAD", "Committee height must be a non-negative safe integer");
  }
  return `0x${height.toString(16)}`;
}

function isHexAddress(value: unknown): value is string {
  return typeof value === "string" && /^0x[0-9a-fA-F]{40}$/.test(value);
}

/** Reads Person 4's committee RPC from the same JSON-RPC endpoint as EVM calls. */
export class BesuConsensusSource implements ConsensusInfoSource {
  constructor(private readonly provider: AbstractProvider) {}

  async getCommittee(height: number): Promise<string[]> {
    const requestedTag = blockTag(height);
    let raw: unknown;
    try {
      const rpc = this.provider as AbstractProvider & {
        send(method: string, params: unknown[]): Promise<unknown>;
      };
      raw = await rpc.send("bel_getCommittee", [requestedTag]);
    } catch (cause) {
      throw new BlockchainError("NETWORK", `bel_getCommittee failed for block ${height}`, undefined, { cause });
    }

    if (!raw || typeof raw !== "object") {
      throw new BlockchainError("NETWORK", "bel_getCommittee returned an invalid response");
    }
    const response = raw as Partial<BelCommitteeResponse>;
    if (!Number.isSafeInteger(response.height) || response.height !== height) {
      throw new BlockchainError("NETWORK", `bel_getCommittee returned unexpected height for block ${height}`, {
        requestedHeight: height,
        returnedHeight: response.height,
      });
    }
    if (!Array.isArray(response.validatorIds) || !response.validatorIds.every(isHexAddress)) {
      throw new BlockchainError("NETWORK", "bel_getCommittee returned invalid validatorIds");
    }
    return response.validatorIds;
  }
}
