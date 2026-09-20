// Owner: Person 5. Maps the frozen Transaction envelope (shared/types) to a
// concrete contract call. This file is the payload contract for Persons 1-3:
// it says exactly which payload fields each TransactionType needs.
//
// Identity references may be given as a DID (identityId) or as a wallet
// address; DIDs are resolved on-chain to the identity's wallet, so domain
// services never need to know wallet addresses (Persons 2/3 only hold
// identity ids). Several aliases are accepted so existing payloads
// (e.g. Person 1's `address`) keep working.
//
// | Type                                   | Contract.function                   | Payload fields                                                   |
// |----------------------------------------|-------------------------------------|------------------------------------------------------------------|
// | IDENTITY_CREATE / IDENTITY_REGISTER / WALLET_REGISTER | IdentityRegistry.createIdentity | identityId, walletAddress (alias: address)   |
// | WALLET_ACTIVATE                        | IdentityRegistry.activateWallet     | walletAddress (alias: address)                                   |
// | WALLET_REVOKE                          | IdentityRegistry.revokeWallet       | walletAddress (alias: address), reason                           |
// | ROLE_ASSIGN / ROLE_REVOKE              | RoleRegistry.assignRole/revokeRole  | role, and walletAddress | address | identityId                  |
// | ASSET_MINT                             | AssetRegistry.mintAsset             | assetId, ownerId (DID or address; alias ownerWallet)             |
// | ASSET_TRANSFER                         | AssetRegistry.transferAsset         | assetId | nftId, newOwnerId (DID or address); newCustodianId must equal newOwnerId if given |
// | ASSET_STATE_CHANGE                     | AssetRegistry.changeAssetState      | assetId | nftId, newState (alias: status)                        |
// | COMPONENT_ATTACH / COMPONENT_REMOVE    | AssetRegistry.attach/removeComponent| parentAssetId | parentNftId, componentAssetId | componentNftId (alias componentId) |
// | JOB_CREATE                             | JobManager.createJob                | jobId, assetId | assetNftId                                      |
// | JOB_ASSIGN                             | JobManager.assignJob                | jobId, technicianId (DID or address; alias technicianWallet)     |
// | JOB_START / JOB_APPROVE                | JobManager.startJob/approveJob      | jobId                                                            |
// | JOB_COMPLETE                           | JobManager.completeJob              | jobId, evidenceHash (32-byte hex, with or without 0x)            |
// | VALIDATOR_REGISTER / VALIDATOR_ACTIVATE | ValidatorRegistry.registerValidator | validatorId, publicKey, signingPublicKey, activationHeight |
// | VALIDATOR_REMOVE                      | ValidatorRegistry.scheduleRemoval | validatorId, removalHeight, reason |
// | JOB_REJECT                             | JobManager.rejectJob                | jobId, reason                                                    |
//
// Off-chain-only fields (assetType, priority, verifierId, deviceId, ...) are
// ignored here: they never go on-chain (ADR-005).

import { getAddress, isAddress } from "ethers";
import type { Transaction } from "../../../shared/types";
import { ASSET_STATUSES, ROLES, TRANSACTION_TYPES, type TransactionType } from "../../../shared/enums";
import type { ContractName } from "./config";
import { BlockchainError } from "./errors";

export type CallPlan = { contract: ContractName; method: string; args: unknown[] };

/** On-chain lookups needed to resolve payload references. */
export interface ChainLookups {
  /** 0n when the assetId was never minted. */
  nftIdOf(assetId: string): Promise<bigint>;
  /** A wallet of the identity; `requireActive` limits the choice to ACTIVE wallets. */
  walletOfIdentity(identityId: string, requireActive: boolean): Promise<string | null>;
}

type Payload = Record<string, unknown>;

function invalid(type: string, message: string): never {
  throw new BlockchainError("INVALID_PAYLOAD", `${type}: ${message}`);
}

function str(type: string, p: Payload, keys: string[], required = true): string | undefined {
  for (const k of keys) {
    const v = p[k];
    if (typeof v === "string" && v.trim() !== "") return v.trim();
  }
  if (required) invalid(type, `payload.${keys[0]} is required`);
  return undefined;
}

function optionalAddress(type: string, p: Payload, keys: string[]): string | undefined {
  const v = str(type, p, keys, false);
  if (v === undefined) return undefined;
  if (!isAddress(v)) invalid(type, `payload.${keys[0]} is not a valid address`);
  return getAddress(v);
}

function requiredAddress(type: string, p: Payload, keys: string[]): string {
  return optionalAddress(type, p, keys) ?? invalid(type, `payload.${keys[0]} is required`);
}

/** Resolves "DID or address" to an address (ACTIVE wallet when a DID is given). */
async function party(type: string, p: Payload, keys: string[], lookups: ChainLookups, requireActive: boolean): Promise<string> {
  const ref = str(type, p, keys)!;
  if (isAddress(ref)) return getAddress(ref);
  const wallet = await lookups.walletOfIdentity(ref, requireActive);
  if (!wallet) {
    throw new BlockchainError("NOT_FOUND", `${type}: identity ${ref} has no ${requireActive ? "ACTIVE " : ""}wallet on-chain`);
  }
  return wallet;
}

async function nftRef(type: string, p: Payload, idKeys: string[], nftKeys: string[], lookups: ChainLookups): Promise<bigint> {
  for (const k of nftKeys) {
    const v = p[k];
    if ((typeof v === "string" && /^\d+$/.test(v)) || (typeof v === "number" && Number.isSafeInteger(v) && v > 0) || typeof v === "bigint") {
      const n = BigInt(v as string | number | bigint);
      if (n > 0n) return n;
    }
  }
  const assetId = str(type, p, idKeys, false);
  if (!assetId) invalid(type, `payload.${idKeys[0]} or payload.${nftKeys[0]} is required`);
  const n = await lookups.nftIdOf(assetId);
  if (n === 0n) throw new BlockchainError("NOT_FOUND", `${type}: asset ${assetId} is not registered on-chain`);
  return n;
}

function roleIndex(type: string, p: Payload): number {
  const role = str(type, p, ["role"])!;
  const i = (ROLES as readonly string[]).indexOf(role);
  if (i < 0) invalid(type, `unknown role ${role}`);
  return i; // shared ROLES order == IRoleRegistry.Role enum order
}

export function normalizeBytes32(type: string, value: string): string {
  const hex = value.startsWith("0x") || value.startsWith("0X") ? value.slice(2) : value;
  if (!/^[0-9a-fA-F]{64}$/.test(hex)) invalid(type, "evidenceHash must be a 32-byte hex string (e.g. a SHA-256 digest)");
  if (/^0+$/.test(hex)) invalid(type, "evidenceHash must not be zero");
  return `0x${hex.toLowerCase()}`;
}

export async function buildCallPlan(tx: Transaction, lookups: ChainLookups): Promise<CallPlan> {
  const type = tx.type as TransactionType;
  if (!(TRANSACTION_TYPES as readonly string[]).includes(type)) {
    throw new BlockchainError("UNSUPPORTED_TRANSACTION", `Unknown transaction type ${String(tx.type)}`);
  }
  const p: Payload = tx.payload && typeof tx.payload === "object" ? tx.payload : {};
  const wallet = ["walletAddress", "address", "wallet"];

  switch (type) {
    case "VALIDATOR_REGISTER":
    case "VALIDATOR_ACTIVATE": {
      const validator = requiredAddress(type, p, ["validatorId", "validator", "address"]);
      const publicKey = str(type, p, ["publicKey"]);
      const signingPublicKey = str(type, p, ["signingPublicKey"]);
      const activationHeight = p.activationHeight;
      if (!(typeof activationHeight === "number" && Number.isSafeInteger(activationHeight) && activationHeight > 0)) invalid(type, "payload.activationHeight must be a positive integer");
      return { contract: "ValidatorRegistry", method: "registerValidator", args: [validator, publicKey, signingPublicKey, activationHeight] };
    }
    case "VALIDATOR_REMOVE": {
      const validator = requiredAddress(type, p, ["validatorId", "validator", "address"]);
      const removalHeight = p.removalHeight;
      if (!(typeof removalHeight === "number" && Number.isSafeInteger(removalHeight) && removalHeight > 0)) invalid(type, "payload.removalHeight must be a positive integer");
      return { contract: "ValidatorRegistry", method: "scheduleRemoval", args: [validator, removalHeight, str(type, p, ["reason"])] };
    }    case "IDENTITY_CREATE":
    case "IDENTITY_REGISTER":
    case "WALLET_REGISTER":
      return {
        contract: "IdentityRegistry",
        method: "createIdentity",
        args: [requiredAddress(type, p, wallet), str(type, p, ["identityId", "did"])],
      };
    case "WALLET_ACTIVATE":
      return { contract: "IdentityRegistry", method: "activateWallet", args: [requiredAddress(type, p, wallet)] };
    case "WALLET_REVOKE":
      return {
        contract: "IdentityRegistry",
        method: "revokeWallet",
        args: [requiredAddress(type, p, wallet), str(type, p, ["reason"])],
      };
    case "ROLE_ASSIGN":
    case "ROLE_REVOKE": {
      // Roles live on the identity, so any linked wallet (even PENDING) identifies it.
      const target = optionalAddress(type, p, wallet) ?? (await party(type, p, ["identityId"], lookups, false));
      return { contract: "RoleRegistry", method: type === "ROLE_ASSIGN" ? "assignRole" : "revokeRole", args: [target, roleIndex(type, p)] };
    }
    case "ASSET_MINT":
      return {
        contract: "AssetRegistry",
        method: "mintAsset",
        args: [str(type, p, ["assetId"]), await party(type, p, ["ownerId", "ownerWallet", "owner"], lookups, true)],
      };
    case "ASSET_TRANSFER": {
      const newOwner = str(type, p, ["newOwnerId", "newOwnerWallet", "newOwner"])!;
      const custodian = str(type, p, ["newCustodianId"], false);
      if (custodian !== undefined && custodian !== newOwner) {
        throw new BlockchainError(
          "UNSUPPORTED_TRANSACTION",
          "ASSET_TRANSFER: a custodian different from the new owner cannot be recorded on-chain (IAssetRegistry.transferAsset moves both together)",
        );
      }
      return {
        contract: "AssetRegistry",
        method: "transferAsset",
        args: [await nftRef(type, p, ["assetId"], ["nftId"], lookups), await party(type, p, ["newOwnerId", "newOwnerWallet", "newOwner"], lookups, true)],
      };
    }
    case "ASSET_STATE_CHANGE": {
      const state = str(type, p, ["newState", "status"])!;
      if (!(ASSET_STATUSES as readonly string[]).includes(state)) invalid(type, `unknown asset state ${state}`);
      return { contract: "AssetRegistry", method: "changeAssetState", args: [await nftRef(type, p, ["assetId"], ["nftId"], lookups), state] };
    }
    case "COMPONENT_ATTACH":
    case "COMPONENT_REMOVE":
      return {
        contract: "AssetRegistry",
        method: type === "COMPONENT_ATTACH" ? "attachComponent" : "removeComponent",
        args: [
          await nftRef(type, p, ["parentAssetId"], ["parentNftId"], lookups),
          await nftRef(type, p, ["componentAssetId", "componentId"], ["componentNftId"], lookups),
        ],
      };
    case "JOB_CREATE":
      return {
        contract: "JobManager",
        method: "createJob",
        args: [str(type, p, ["jobId"]), await nftRef(type, p, ["assetId"], ["assetNftId"], lookups)],
      };
    case "JOB_ASSIGN":
      return {
        contract: "JobManager",
        method: "assignJob",
        args: [str(type, p, ["jobId"]), await party(type, p, ["technicianId", "technicianWallet", "technician"], lookups, true)],
      };
    case "JOB_START":
      return { contract: "JobManager", method: "startJob", args: [str(type, p, ["jobId"])] };
    case "JOB_COMPLETE":
      return {
        contract: "JobManager",
        method: "completeJob",
        args: [str(type, p, ["jobId"]), normalizeBytes32(type, str(type, p, ["evidenceHash"])!)],
      };
    case "JOB_APPROVE":
      return { contract: "JobManager", method: "approveJob", args: [str(type, p, ["jobId"])] };
    case "JOB_REJECT":
      return { contract: "JobManager", method: "rejectJob", args: [str(type, p, ["jobId"]), str(type, p, ["reason"])] };
  }
}

