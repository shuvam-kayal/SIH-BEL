// Re-export the frozen cross-workstream adapter contract.
// Backend owners must depend on this interface only; mocks and the eventual
// real blockchain adapter implement the exact same contract.
export type { BlockchainService } from "../../../shared/api";
