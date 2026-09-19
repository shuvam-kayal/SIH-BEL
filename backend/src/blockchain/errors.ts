// Owner: Person 5. Typed failures from the blockchain adapter.
//
// Two kinds of failure are deliberately kept apart:
//   - A contract REVERT is a business rejection (unauthorized, invalid state
//     transition, duplicate id...). `submitTransaction` reports it as
//     status "REJECTED"; the detailed result carries the decoded reason.
//   - Everything else (bad payload, missing config, RPC down, timeout,
//     signer problems) is thrown as a BlockchainError. It extends HttpError,
//     so if it escapes a route the existing error handler maps it cleanly.

import { HttpError } from "../errors";

export type BlockchainErrorKind =
  | "INVALID_PAYLOAD" // envelope/payload cannot be mapped to a contract call
  | "UNSUPPORTED_TRANSACTION" // valid TransactionType with no on-chain function
  | "NOT_FOUND" // a referenced on-chain entity (asset, job, identity) is missing
  | "CONFIG" // missing/invalid RPC, deployment file or ABI
  | "SIGNER" // no permitted way to sign for actorWallet, or signed tx mismatch
  | "NETWORK" // RPC unreachable / transport failure
  | "TIMEOUT" // no receipt within the configured timeout
  | "REVERTED"; // thrown only by callers that opt into throwing on rejection

const HTTP: Record<BlockchainErrorKind, { status: number; code: string }> = {
  INVALID_PAYLOAD: { status: 400, code: "VALIDATION_FAILED" },
  UNSUPPORTED_TRANSACTION: { status: 400, code: "VALIDATION_FAILED" },
  NOT_FOUND: { status: 404, code: "NOT_FOUND" },
  CONFIG: { status: 500, code: "INTERNAL_ERROR" },
  SIGNER: { status: 500, code: "INTERNAL_ERROR" },
  NETWORK: { status: 502, code: "INTERNAL_ERROR" },
  TIMEOUT: { status: 504, code: "INTERNAL_ERROR" },
  REVERTED: { status: 409, code: "CONFLICT" },
};

export class BlockchainError extends HttpError {
  constructor(
    public readonly kind: BlockchainErrorKind,
    message: string,
    public readonly details?: Record<string, unknown>,
    options?: { cause?: unknown },
  ) {
    super(HTTP[kind].status, message, HTTP[kind].code);
    this.name = "BlockchainError";
    if (options?.cause !== undefined) (this as { cause?: unknown }).cause = options.cause;
  }
}

/** Decoded custom error from a reverted contract call. */
export type DecodedRevert = {
  /** Solidity error name, e.g. "Unauthorized", "InvalidTransition". */
  name: string;
  /** Positional arguments, stringified (bigint -> decimal string). */
  args: string[];
  /** One-line human readable summary. */
  message: string;
};
