import { randomUUID } from "node:crypto";
import type { ValidatorAddInput, ValidatorRemovalInput, ValidatorRestoreInput, ValidatorRemoveCancelInput } from "../../../shared/api";
import type { Identity, ValidatorHistoryRecord, ValidatorRegistration } from "../../../shared/types";
import type { BlockchainService } from "../adapters/BlockchainService";
import { ConflictError, ForbiddenError, NotFoundError, ValidationError } from "../errors";
import type { IdentityRepositories } from "../users/repositories";
import { isAddress } from "ethers";
import { NotificationService } from "../notifications/notification.service";

const SYSTEM = "DID:BEL:SYSTEM";
const SYSTEM_WALLET = "SYSTEM";

export interface ValidatorService {
  addValidator(actorId: string, input: ValidatorAddInput): Promise<ValidatorRegistration>;
  removeValidator(actorId: string, id: string, input: ValidatorRemovalInput): Promise<ValidatorRegistration>;
  restoreValidator(actorId: string, id: string, input: ValidatorRestoreInput): Promise<ValidatorRegistration>;
  cancelScheduledRemoval(actorId: string, id: string, input: ValidatorRemoveCancelInput): Promise<ValidatorRegistration>;
  list(): Promise<ValidatorRegistration[]>;
  getHistory(): Promise<ValidatorHistoryRecord[]>;
}

export class ValidatorServiceImpl implements ValidatorService {
  private readonly notifications: NotificationService;
  constructor(private readonly chain: BlockchainService, private readonly repositories: IdentityRepositories) { this.notifications = new NotificationService(repositories); }

  async addValidator(actorId: string, input: ValidatorAddInput): Promise<ValidatorRegistration> {
    const actor = await this.admin(actorId); this.assertMetadata(input);
    const existing = await this.repositories.validators.findByValidatorId(input.validatorId.trim());
    if (existing && existing.status !== "REMOVED") throw new ConflictError("Validator is already active or scheduled");
    const head = (await this.chain.getStatus()).height;
    if (!Number.isSafeInteger(input.activationHeight) || input.activationHeight <= head) throw new ValidationError([`activationHeight must be greater than current chain height ${head}`]);
    const user = await this.repositories.users.findByIdentityId(actor.identityId);
    const registration: ValidatorRegistration = { registrationId: existing?.registrationId ?? `VREG:${randomUUID()}`, validatorId: input.validatorId.trim(), identityId: actor.identityId, walletAddress: user?.walletAddress ?? SYSTEM_WALLET, nodeId: input.validatorId.trim(), nodeAddress: input.nodeAddress.trim(), publicKey: input.publicKey.trim(), signingPublicKey: input.signingPublicKey.trim(), status: input.activationHeight > head ? "PENDING" : "ACTIVE", requestedAt: existing?.requestedAt ?? new Date().toISOString(), activationHeight: input.activationHeight, removalHeight: null, removalReason: null, txHash: null, blockNumber: null };
    const result = await this.submit("VALIDATOR_ADD", actor, registration, {});
    registration.txHash = result.transactionHash ?? result.txId; registration.blockNumber = result.blockNumber ?? null;
    await this.repositories.validators.save(registration); await this.recordHistory(registration, actor, "VALIDATOR_ADD", null, registration.status, null, result); await this.notifications.validatorChanged("VALIDATOR_ADD", registration, actor);
    return { ...registration };
  }

  async removeValidator(actorId: string, id: string, input: ValidatorRemovalInput): Promise<ValidatorRegistration> {
    const actor = await this.admin(actorId);
    if (!Number.isSafeInteger(input?.removalHeight) || input.removalHeight < 1) throw new ValidationError(["removalHeight must be a positive integer"]);
    if (!input.reason?.trim()) throw new ValidationError(["reason is required"]);
    const registration = await this.get(id); if (!["PENDING", "ACTIVE"].includes(registration.status)) throw new ConflictError("Validator is not removable in its current state");
    const head = (await this.chain.getStatus()).height; if (input.removalHeight <= head || input.removalHeight <= registration.activationHeight) throw new ValidationError([`removalHeight must be greater than current chain height ${head} and activation height`]);
    const result = await this.submit("VALIDATOR_REMOVE", actor, registration, { removalHeight: input.removalHeight, reason: input.reason.trim() });
    const previous = registration.status; registration.status = "REMOVAL_SCHEDULED"; registration.removalHeight = input.removalHeight; registration.removalReason = input.reason.trim(); registration.txHash = result.transactionHash ?? result.txId; registration.blockNumber = result.blockNumber ?? null;
    await this.repositories.validators.save(registration); await this.recordHistory(registration, actor, "VALIDATOR_REMOVE", previous, "REMOVAL_SCHEDULED", input.reason.trim(), result); await this.notifications.validatorChanged("VALIDATOR_REMOVE", registration, actor);
    return { ...registration };
  }

  async restoreValidator(actorId: string, id: string, input: ValidatorRestoreInput): Promise<ValidatorRegistration> {
    const actor = await this.admin(actorId); if (!input?.reason?.trim()) throw new ValidationError(["reason is required"]);
    const registration = await this.get(id); const head = (await this.chain.getStatus()).height;
    const effectiveStatus = registration.status === "REMOVAL_SCHEDULED" && registration.removalHeight !== null && registration.removalHeight <= head ? "REMOVED" : registration.status;
    if (effectiveStatus !== "REMOVED" || !registration.removalHeight || registration.removalHeight > head) throw new ConflictError("Only a validator whose removal is effective can be restored; cancel a scheduled removal instead");
    const result = await this.submit("VALIDATOR_RESTORE", actor, registration, { reason: input.reason.trim() });
    registration.status = "ACTIVE"; registration.removalHeight = null; registration.removalReason = null; registration.txHash = result.transactionHash ?? result.txId; registration.blockNumber = result.blockNumber ?? null;
    await this.repositories.validators.save(registration); await this.recordHistory(registration, actor, "VALIDATOR_RESTORE", "REMOVED", "ACTIVE", input.reason.trim(), result); await this.notifications.validatorChanged("VALIDATOR_RESTORE", registration, actor);
    return { ...registration };
  }

  async cancelScheduledRemoval(actorId: string, id: string, input: ValidatorRemoveCancelInput): Promise<ValidatorRegistration> {
    const actor = await this.admin(actorId); if (!input?.reason?.trim()) throw new ValidationError(["reason is required"]);
    const registration = await this.get(id); if (registration.status !== "REMOVAL_SCHEDULED") throw new ConflictError("Only a scheduled removal can be cancelled");
    const result = await this.submit("VALIDATOR_REMOVE_CANCEL", actor, registration, { reason: input.reason.trim() });
    registration.status = "ACTIVE"; registration.removalHeight = null; registration.removalReason = null; registration.txHash = result.transactionHash ?? result.txId; registration.blockNumber = result.blockNumber ?? null;
    await this.repositories.validators.save(registration); await this.recordHistory(registration, actor, "VALIDATOR_REMOVE_CANCEL", "REMOVAL_SCHEDULED", "ACTIVE", input.reason.trim(), result); await this.notifications.validatorChanged("VALIDATOR_REMOVE_CANCEL", registration, actor);
    return { ...registration };
  }

  async list() {
    const head = (await this.chain.getStatus()).height;
    return (await this.repositories.validators.list()).map((value) => this.effectiveRegistration(value, head));
  }
  async getHistory() { return this.repositories.validatorHistory.list(); }

  private async submit(type: "VALIDATOR_ADD" | "VALIDATOR_REMOVE" | "VALIDATOR_RESTORE" | "VALIDATOR_REMOVE_CANCEL", actor: Identity, registration: ValidatorRegistration, extra: Record<string, unknown>) {
    const user = await this.repositories.users.findByIdentityId(actor.identityId);
    try {
      const result = await this.chain.submitTransaction({ txId: randomUUID(), type, actorIdentity: actor.identityId || SYSTEM, actorWallet: user?.walletAddress ?? SYSTEM_WALLET, payload: { validatorId: registration.validatorId, nodeAddress: registration.nodeAddress, publicKey: registration.publicKey, signingPublicKey: registration.signingPublicKey, activationHeight: registration.activationHeight, ...extra }, timestamp: new Date().toISOString(), signature: this.envelopeSignature() });
      const expected = type === "VALIDATOR_ADD" ? "ValidatorAdded" : type === "VALIDATOR_REMOVE" ? "ValidatorRemoved" : type === "VALIDATOR_RESTORE" ? "ValidatorRestored" : "ValidatorRemovalCancelled";
      if (result.status !== "SUCCESS" || (result.event && result.event !== expected)) throw new Error(`Blockchain did not confirm ${expected}`);
      return result;
    } catch (error) {
      await this.repositories.validatorHistory.append({ historyId: `VH:${randomUUID()}`, validatorId: registration.validatorId, operation: type, actorIdentityId: actor.identityId, actorWallet: user?.walletAddress ?? SYSTEM_WALLET, timestamp: new Date().toISOString(), blockNumber: null, transactionHash: null, previousState: registration.status, newState: registration.status, reason: typeof extra.reason === "string" ? extra.reason : null, status: "FAILED", inverseTransactionHash: null });
      throw error;
    }
  }

  private async recordHistory(registration: ValidatorRegistration, actor: Identity, operation: ValidatorHistoryRecord["operation"], previousState: string | null, newState: string, reason: string | null, result: { txId: string; transactionHash?: string; blockNumber?: number }) {
    await this.repositories.validatorHistory.append({ historyId: `VH:${randomUUID()}`, validatorId: registration.validatorId, operation, actorIdentityId: actor.identityId, actorWallet: (await this.repositories.users.findByIdentityId(actor.identityId))?.walletAddress ?? SYSTEM_WALLET, timestamp: new Date().toISOString(), blockNumber: result.blockNumber ?? null, transactionHash: result.transactionHash ?? result.txId, previousState, newState, reason, status: "SUCCESS", inverseTransactionHash: null });
  }

  private async get(id: string) { const value = await this.repositories.validators.findById(id) ?? await this.repositories.validators.findByValidatorId(id); if (!value) throw new NotFoundError(`Validator ${id} was not found`); return this.effectiveRegistration(value, (await this.chain.getStatus()).height); }
  private effectiveRegistration(value: ValidatorRegistration, head: number): ValidatorRegistration {
    const status = value.status === "PENDING" && value.activationHeight <= head
      ? "ACTIVE"
      : value.status === "REMOVAL_SCHEDULED" && value.removalHeight !== null && value.removalHeight <= head
        ? "REMOVED"
        : value.status;
    return status === value.status ? { ...value } : { ...value, status };
  }
  private envelopeSignature(): string {
    if (process.env.BEL_ENV === "production") throw new ForbiddenError("Production validator transactions require the configured device-signed transaction provider");
    return "development";
  }
  private async activeIdentity(id: string) { const value = await this.repositories.identities.findById(id); if (!value || value.status !== "ACTIVE") throw new ForbiddenError("An active identity is required"); return value; }
  private async admin(id: string) { const identity = await this.activeIdentity(id); if (identity.role !== "ADMIN") throw new ForbiddenError("Only an active admin may manage validators"); return identity; }
  private assertMetadata(input: ValidatorAddInput) { const errors: string[] = []; for (const field of ["validatorId", "nodeAddress", "publicKey", "signingPublicKey"] as const) if (typeof input?.[field] !== "string" || !input[field].trim()) errors.push(`${field} is required`); if (typeof input?.validatorId === "string" && !isAddress(input.validatorId.trim())) errors.push("validatorId must be a valid EVM address"); if (Object.keys(input ?? {}).some((key) => /private|secret|mnemonic|seed/i.test(key))) errors.push("private key material must never be submitted"); if (errors.length) throw new ValidationError(errors); }
}
