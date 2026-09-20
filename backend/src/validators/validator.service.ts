import { randomUUID } from "node:crypto";
import type { ValidatorApprovalInput, ValidatorRemovalInput, ValidatorRequestInput } from "../../../shared/api";
import type { Identity, ValidatorRegistration } from "../../../shared/types";
import type { BlockchainService } from "../adapters/BlockchainService";
import { ConflictError, ForbiddenError, NotFoundError, ValidationError } from "../errors";
import type { IdentityRepositories } from "../users/repositories";
import { isAddress } from "ethers";

const SYSTEM = "DID:BEL:SYSTEM";
const SYSTEM_WALLET = "SYSTEM";

export interface ValidatorService {
  request(actorId: string, input: ValidatorRequestInput): Promise<ValidatorRegistration>;
  list(): Promise<ValidatorRegistration[]>;
  approve(actorId: string, id: string, input: ValidatorApprovalInput): Promise<ValidatorRegistration>;
  registerMetadata(actorId: string, id: string, input: Pick<ValidatorRequestInput, "nodeId" | "nodeAddress" | "publicKey" | "signingPublicKey">): Promise<ValidatorRegistration>;
  remove(actorId: string, id: string, input: ValidatorRemovalInput): Promise<ValidatorRegistration>;
}

export class ValidatorServiceImpl implements ValidatorService {
  constructor(private readonly chain: BlockchainService, private readonly repositories: IdentityRepositories) {}

  async request(actorId: string, input: ValidatorRequestInput): Promise<ValidatorRegistration> {
    const identity = await this.activeIdentity(actorId);
    this.assertFields(input);
    const wallet = await this.repositories.wallets.findByAddress(input.walletAddress.trim());
    if (!wallet || wallet.identityId !== identity.identityId || wallet.status !== "ACTIVE") throw new ForbiddenError("An active wallet owned by the requesting identity is required");
    const existing = await this.repositories.validators.findByValidatorId(input.nodeId.trim());
    if (existing && !["REJECTED", "REMOVED", "INACTIVE"].includes(existing.status)) throw new ConflictError("A validator request already exists for this node");
    const now = new Date().toISOString();
    const registration: ValidatorRegistration = {
      registrationId: `VREQ:${randomUUID()}`, validatorId: input.nodeId.trim(), identityId: identity.identityId,
      walletAddress: wallet.address, nodeId: input.nodeId.trim(), nodeAddress: input.nodeAddress.trim(),
      publicKey: input.publicKey.trim(), signingPublicKey: input.signingPublicKey.trim(), status: "PENDING",
      requestedAt: now, approvedAt: null, approvedBy: null, activationHeight: null, removalHeight: null,
      removedAt: null, removalReason: null,
    };
    await this.repositories.validators.save(registration);
    return { ...registration };
  }

  async list() { return this.repositories.validators.list(); }

  async approve(actorId: string, id: string, input: ValidatorApprovalInput): Promise<ValidatorRegistration> {
    const actor = await this.admin(actorId);
    if (!Number.isSafeInteger(input?.activationHeight) || input.activationHeight < 1) throw new ValidationError(["activationHeight must be a positive integer"]);
    const registration = await this.get(id);
    if (registration.status !== "PENDING") throw new ConflictError("Only pending validator requests can be approved");
    const head = (await this.chain.getStatus()).height;
    if (input.activationHeight <= head) throw new ValidationError([`activationHeight must be greater than current chain height ${head}`]);
    registration.status = "APPROVED"; registration.approvedAt = new Date().toISOString(); registration.approvedBy = actor.identityId; registration.activationHeight = input.activationHeight;
    await this.repositories.validators.save(registration);
    return { ...registration };
  }

  async registerMetadata(actorId: string, id: string, input: Pick<ValidatorRequestInput, "nodeId" | "nodeAddress" | "publicKey" | "signingPublicKey">): Promise<ValidatorRegistration> {
    const actor = await this.admin(actorId);
    this.assertFields({ walletAddress: "placeholder", ...input });
    const registration = await this.get(id);
    if (registration.status !== "APPROVED") throw new ConflictError("Validator must be approved before node metadata is registered");
    if (registration.validatorId !== input.nodeId.trim()) throw new ConflictError("Node identity does not match the approved request");
    if (!isAddress(input.nodeId.trim())) throw new ValidationError(["nodeId must be the validator EVM address"]);
    registration.nodeAddress = input.nodeAddress.trim(); registration.publicKey = input.publicKey.trim(); registration.signingPublicKey = input.signingPublicKey.trim();
    await this.repositories.validators.save(registration);
    await this.submit("VALIDATOR_REGISTER", actor, registration);
    return { ...registration };
  }

  async remove(actorId: string, id: string, input: ValidatorRemovalInput): Promise<ValidatorRegistration> {
    const actor = await this.admin(actorId);
    if (!Number.isSafeInteger(input?.removalHeight) || input.removalHeight < 1) throw new ValidationError(["removalHeight must be a positive integer"]);
    if (!input.reason?.trim()) throw new ValidationError(["reason is required"]);
    const registration = await this.get(id);
    if (!["APPROVED", "ACTIVE", "INACTIVE"].includes(registration.status)) throw new ConflictError("Validator is not removable in its current state");
    const head = (await this.chain.getStatus()).height;
    if (input.removalHeight <= head) throw new ValidationError([`removalHeight must be greater than current chain height ${head}`]);
    registration.status = "REMOVED"; registration.removalHeight = input.removalHeight; registration.removedAt = new Date().toISOString(); registration.removalReason = input.reason.trim();
    await this.repositories.validators.save(registration);
    await this.submit("VALIDATOR_REMOVE", actor, registration);
    return { ...registration };
  }

  private async get(id: string) { const value = await this.repositories.validators.findById(id); if (!value) throw new NotFoundError(`No validator request ${id}`); return value; }
  private async activeIdentity(id: string): Promise<Identity> { const value = await this.repositories.identities.findById(id); if (!value || value.status !== "ACTIVE") throw new ForbiddenError("An active identity is required"); return value; }
  private async admin(id: string) { const identity = await this.activeIdentity(id); if (identity.role !== "ADMIN") throw new ForbiddenError("Only an active admin may manage validators"); return identity; }
  private assertFields(input: Partial<ValidatorRequestInput>) { const errors: string[] = []; for (const field of ["walletAddress", "nodeId", "nodeAddress", "publicKey", "signingPublicKey"] as const) if (typeof input[field] !== "string" || !input[field]!.trim()) errors.push(`${field} is required`); if (Object.keys(input).some((key) => /private|secret|mnemonic|seed/i.test(key))) errors.push("private key material must never be submitted"); if (errors.length) throw new ValidationError(errors); }
  private async submit(type: "VALIDATOR_REGISTER" | "VALIDATOR_REMOVE", actor: Identity, registration: ValidatorRegistration) { const user = await this.repositories.users.findByIdentityId(actor.identityId); const result = await this.chain.submitTransaction({ txId: randomUUID(), type, actorIdentity: actor.identityId || SYSTEM, actorWallet: user?.walletAddress ?? SYSTEM_WALLET, payload: { registrationId: registration.registrationId, validatorId: registration.validatorId, nodeId: registration.nodeId, nodeAddress: registration.nodeAddress, publicKey: registration.publicKey, signingPublicKey: registration.signingPublicKey, activationHeight: registration.activationHeight, removalHeight: registration.removalHeight, status: registration.status }, timestamp: new Date().toISOString(), signature: "development" }); if (result.status !== "SUCCESS") throw new Error(`Blockchain rejected ${type}`); }
}



