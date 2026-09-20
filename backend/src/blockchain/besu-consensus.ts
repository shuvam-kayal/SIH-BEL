import type { Validator } from "../../../shared/types";
import { VALIDATOR_STATUSES, type ValidatorStatus } from "../../../shared/enums";
import { isAddress } from "ethers";
import { BlockchainError } from "./errors";

/** The JSON-RPC capability needed by Besu's consensus extensions. */
export type BesuRpcProvider = {
  send(method: string, params: unknown[]): Promise<unknown>;
};

type ValidatorsResponse = {
  height: number;
  validators: Validator[];
};

type CommitteeResponse = {
  height: number;
  validatorIds: string[];
};

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

function invalidResponse(method: string, detail: string): BlockchainError {
  return new BlockchainError("NETWORK", `${method} returned an invalid response: ${detail}`);
}

function stringField(value: unknown, field: string, method: string): string {
  if (typeof value !== "string" || value.trim() === "") {
    throw invalidResponse(method, `${field} must be a non-empty string`);
  }
  return value;
}

function validatorId(value: unknown, field: string, method: string): string {
  const id = stringField(value, field, method);
  if (!isAddress(id)) throw invalidResponse(method, `${field} must be an EVM address`);
  return id;
}

function publicKey(value: unknown, field: string, method: string): string {
  const key = stringField(value, field, method);
  if (!/^0x[0-9a-fA-F]{128}$/.test(key)) {
    throw invalidResponse(method, `${field} must be a 0x-prefixed 64-byte X || Y public key`);
  }
  return key;
}

function responseHeight(value: unknown, method: string): number {
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value < 0) {
    throw invalidResponse(method, "height must be a non-negative safe integer");
  }
  return value;
}

function validatorStatus(value: unknown, method: string): ValidatorStatus {
  if (typeof value !== "string" || !(VALIDATOR_STATUSES as readonly string[]).includes(value)) {
    throw invalidResponse(method, `status must be one of ${VALIDATOR_STATUSES.join(", ")}`);
  }
  return value as ValidatorStatus;
}

function isoDate(value: unknown, method: string): string {
  const joinedAt = stringField(value, "joinedAt", method);
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/.test(joinedAt) || !Number.isFinite(Date.parse(joinedAt))) {
    throw invalidResponse(method, "joinedAt must be an ISO date-time string");
  }
  return joinedAt;
}

function parseValidators(value: unknown): ValidatorsResponse {
  const method = "bel_getValidators";
  if (!isRecord(value)) throw invalidResponse(method, "response must be an object");
  const height = responseHeight(value.height, method);
  if (!Array.isArray(value.validators)) throw invalidResponse(method, "validators must be an array");

  const validators = value.validators.map((entry, index): Validator => {
    if (!isRecord(entry)) throw invalidResponse(method, `validators[${index}] must be an object`);
    return {
      validatorId: validatorId(entry.validatorId, `validators[${index}].validatorId`, method),
      publicKey: publicKey(entry.publicKey, `validators[${index}].publicKey`, method),
      status: validatorStatus(entry.status, method),
      joinedAt: isoDate(entry.joinedAt, method),
    };
  });

  return { height, validators };
}

function parseCommittee(value: unknown): CommitteeResponse {
  const method = "bel_getCommittee";
  if (!isRecord(value)) throw invalidResponse(method, "response must be an object");
  const height = responseHeight(value.height, method);
  if (!Array.isArray(value.validatorIds)) throw invalidResponse(method, "validatorIds must be an array");
  const validatorIds = value.validatorIds.map((id, index) => validatorId(id, `validatorIds[${index}]`, method));
  return { height, validatorIds };
}

function quantity(height: number): string {
  if (!Number.isSafeInteger(height) || height < 0) {
    throw new BlockchainError("INVALID_PAYLOAD", "Committee height must be a non-negative safe integer");
  }
  return `0x${height.toString(16)}`;
}

export class BesuConsensusSource {
  constructor(private readonly provider: BesuRpcProvider) {}

  async getValidators(): Promise<Validator[]> {
    let response: unknown;
    try {
      response = await this.provider.send("bel_getValidators", ["latest"]);
    } catch (cause) {
      throw new BlockchainError("NETWORK", "bel_getValidators RPC request failed", undefined, { cause });
    }
    return parseValidators(response).validators;
  }

  async getCommittee(height: number): Promise<string[]> {
    const block = quantity(height);
    let response: unknown;
    try {
      response = await this.provider.send("bel_getCommittee", [block]);
    } catch (cause) {
      throw new BlockchainError("NETWORK", "bel_getCommittee RPC request failed", undefined, { cause });
    }
    const parsed = parseCommittee(response);
    if (parsed.height !== height) {
      throw invalidResponse("bel_getCommittee", `height ${parsed.height} does not match requested height ${height}`);
    }
    return parsed.validatorIds;
  }
}
