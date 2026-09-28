// Owner: Person 5. Chooses the BlockchainService implementation from the
// environment so backend/src/container.ts stays the single wiring point.
//
//   BEL_BLOCKCHAIN=mock (default)  in-memory mocks/mock-blockchain
//   BEL_BLOCKCHAIN=evm             EvmBlockchainAdapter; see config.ts for BEL_CHAIN_* vars

import { MockBlockchainAdapter } from "../../../mocks/mock-blockchain";
import type { BlockchainService } from "../adapters/BlockchainService";
import { loadChainConfigFromEnv } from "./config";
import { BlockchainError } from "./errors";
import { BesuConsensusSource } from "./besu-consensus";
import { EvmBlockchainAdapter, type EvmAdapterOptions } from "./evm-adapter";
import { JsonRpcProvider } from "ethers";

export function createBlockchainServiceFromEnv(
  env: NodeJS.ProcessEnv = process.env,
  options: EvmAdapterOptions = {},
): BlockchainService {
  const kind = (env.BEL_BLOCKCHAIN ?? "mock").trim().toLowerCase();
  if (kind === "mock" || kind === "") return new MockBlockchainAdapter();
  if (kind === "evm") {
    const config = loadChainConfigFromEnv(env);
    const provider = options.provider ?? new JsonRpcProvider(config.rpcUrl, config.deployment.chainId, {
      staticNetwork: true,
      pollingInterval: config.pollingIntervalMs ?? 1_000,
    });
    const consensus = options.consensus ?? new BesuConsensusSource(provider as { send(method: string, params: unknown[]): Promise<unknown> });
    return new EvmBlockchainAdapter(config, { ...options, provider, consensus });
  }
  throw new BlockchainError("CONFIG", `BEL_BLOCKCHAIN must be "mock" or "evm", got "${kind}"`);
}
