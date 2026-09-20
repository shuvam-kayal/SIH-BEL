// Public surface of the backend blockchain layer (Person 5).
// Domain services should keep depending on the BlockchainService interface
// (backend/src/adapters/BlockchainService.ts); import from here only when you
// need the richer, EVM-specific result or configuration types.
export { BlockchainError, type BlockchainErrorKind, type DecodedRevert } from "./errors";
export { CONTRACT_NAMES, loadAbis, loadChainConfigFromEnv, loadDeployment, parseDeployment } from "./config";
export type { ContractName, DeploymentFile, EvmChainConfig } from "./config";
export { buildCallPlan, normalizeBytes32, type CallPlan, type ChainLookups } from "./payloads";
export {
  EvmBlockchainAdapter,
  type ChainEvent,
  type ConsensusInfoSource,
  type EvmAdapterOptions,
  type OffChainMetadataProvider,
  type PreparedTransaction,
  type SubmitResult,
} from "./evm-adapter";
export { createBlockchainServiceFromEnv } from "./factory";
export { BesuConsensusSource, type BesuRpcProvider } from "./besu-consensus";
export { assertWalletMatchesPublicKey, parseCompactSignature, publicKeyToEvmAddress, verifyCompactSignature } from "./crypto";
