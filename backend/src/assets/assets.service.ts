// Owner: Person 2. Backs GET/POST /assets, GET /assets/:id,
// POST /assets/:id/transfer (docs/API_SPEC.yaml).

import { randomUUID } from "node:crypto";
import type { BlockchainService } from "../adapters/BlockchainService";
import { HttpError, NotFoundError, ValidationError } from "../errors";
import type { Asset, Transaction } from "../../../shared/types";
import type { MockBlockchainResult } from "../../../shared/api";
import { ASSET_STATUSES, type AssetStatus } from "../../../shared/enums";
import { MemoryAssetRepository, type AssetRepository } from "../domain/repositories";

/** The authenticated identity and wallet that sign a transaction envelope. */
export type AssetActor = {
  identityId: string;
  walletAddress: string;
};

/** A chain submission that did not reach the success state. */
export class TransactionRejectedError extends HttpError {
  constructor(transactionType: string) {
    super(502, `Blockchain rejected ${transactionType}`, "INTERNAL_ERROR");
    this.name = "TransactionRejectedError";
  }
}

/** A successful write could not be reconciled with the chain read path. */
export class BlockchainStateUnavailableError extends HttpError {
  constructor(assetId: string, txId: string) {
    super(502, `Blockchain accepted ${txId}, but asset ${assetId} is not queryable`, "INTERNAL_ERROR");
    this.name = "BlockchainStateUnavailableError";
  }
}

export interface AssetsService {
  list(): Promise<Asset[]>;
  getById(id: string): Promise<Asset | null>;
  create(input: Partial<Asset>, actor?: AssetActor): Promise<Asset>;
  transfer(
    id: string,
    newOwnerId: string,
    newCustodianId?: string,
    actor?: AssetActor
  ): Promise<Asset>;
  changeAssetState(id: string, newState: AssetStatus, actor?: AssetActor): Promise<Asset>;
  attachComponent(parentAssetId: string, componentId: string, actor?: AssetActor): Promise<Asset>;
  removeComponent(parentAssetId: string, componentId: string, actor?: AssetActor): Promise<Asset>;
}

type DetailedBlockchainService = BlockchainService & {
  submitTransactionDetailed?: (tx: Transaction) => Promise<MockBlockchainResult & { nftId?: string }>;
};

/**
 * Chain state is authoritative for nftId, owner, custodian, parent and
 * lifecycle status. The local map is only an off-chain index/metadata cache:
 * the frozen BlockchainService has no listAssets method and assetType is not
 * stored by the registry. A successful write is never projected until it can
 * be reconciled through getAsset(), or a detailed adapter result supplies the
 * chain-issued nftId.
 */
export class AssetsServiceImpl implements AssetsService {
  private readonly assets = new Map<string, Asset>();

  constructor(private readonly chain: BlockchainService, private readonly repository: AssetRepository = new MemoryAssetRepository()) {}

  async list(): Promise<Asset[]> {
    const stored = await this.repository.list();
    const assets = await Promise.all([...new Set([...stored.map((a) => a.assetId), ...this.assets.keys()])].map((assetId) => this.getById(assetId)));
    return assets.filter((asset): asset is Asset => asset !== null);
  }

  async getById(id: string): Promise<Asset | null> {
    const cached = this.assets.get(id) ?? await this.repository.findById(id);
    const onChain = await this.chain.getAsset(id);
    if (onChain) {
      const reconciled = this.mergeAsset(onChain, cached ?? undefined);
      this.assets.set(id, reconciled);
      return { ...reconciled };
    }
    return cached ? { ...cached } : null;
  }

  async create(input: Partial<Asset>, actor?: AssetActor): Promise<Asset> {
    const assetType = this.requiredString(input.assetType, "assetType");
    const ownerId = this.requiredString(input.ownerId, "ownerId");
    const custodianId = this.requiredString(input.custodianId, "custodianId");
    if (custodianId !== ownerId) {
      throw new ValidationError([
        "custodianId must equal ownerId because the frozen mintAsset interface mints custody to the owner",
      ]);
    }
    const assetId = input.assetId?.trim() || `AST-${randomUUID()}`;
    if (await this.getById(assetId)) {
      throw new ValidationError([`assetId ${assetId} already exists`]);
    }
    if (input.parentAssetId !== undefined && input.parentAssetId !== null) {
      await this.requireAsset(input.parentAssetId, "parentAssetId");
    }

    const tx = this.transaction("ASSET_MINT", actor, {
      assetId,
      assetType,
      ownerId,
      custodianId,
      parentAssetId: input.parentAssetId ?? null,
    });
    const result = await this.submit(tx);
    const reconciled = await this.reconcileAfterWrite(
      assetId,
      result,
      {
        assetId,
        nftId: "",
        assetType,
        ownerId,
        custodianId,
        parentAssetId: input.parentAssetId ?? null,
        status: "ACTIVE",
      }
    );
    this.assets.set(assetId, reconciled);
    await this.repository.save(reconciled);
    return { ...reconciled };
  }

  async transfer(
    id: string,
    newOwnerId: string,
    newCustodianId?: string,
    actor?: AssetActor
  ): Promise<Asset> {
    const asset = await this.requireAsset(id);
    const ownerId = this.requiredString(newOwnerId, "newOwnerId");
    const custodianId = newCustodianId === undefined
      ? ownerId
      : this.requiredString(newCustodianId, "newCustodianId");
    if (custodianId !== ownerId) {
      throw new ValidationError([
        "newCustodianId must equal newOwnerId because the frozen transferAsset interface moves custody with ownership",
      ]);
    }
    if (asset.status === "DECOMMISSIONED") {
      throw new ValidationError([`Asset ${id} is decommissioned and cannot be transferred`]);
    }
    if (asset.parentAssetId !== undefined && asset.parentAssetId !== null) {
      throw new ValidationError([`Component ${id} must be detached before transfer`]);
    }
    if (asset.ownerId === ownerId) {
      throw new ValidationError([`Asset ${id} is already owned by ${ownerId}`]);
    }

    const tx = this.transaction("ASSET_TRANSFER", actor, {
      assetId: asset.assetId,
      nftId: asset.nftId,
      newOwnerId: ownerId,
      newCustodianId: custodianId,
    });
    const result = await this.submit(tx);
    const reconciled = await this.reconcileAfterWrite(
      id,
      result,
      { ...asset, ownerId, custodianId }
    );
    this.assets.set(id, reconciled);
    await this.repository.save(reconciled);
    return { ...reconciled };
  }

  async changeAssetState(id: string, newState: AssetStatus, actor?: AssetActor): Promise<Asset> {
    if (!ASSET_STATUSES.includes(newState)) {
      throw new ValidationError([`newState must be one of ${ASSET_STATUSES.join(", ")}`]);
    }
    const asset = await this.requireAsset(id);
    this.assertStateTransition(asset.status, newState);
    const tx = this.transaction("ASSET_STATE_CHANGE", actor, {
      assetId: asset.assetId,
      nftId: asset.nftId,
      previousState: asset.status,
      newState,
    });
    const result = await this.submit(tx);
    const reconciled = await this.reconcileAfterWrite(id, result, { ...asset, status: newState });
    this.assets.set(id, reconciled);
    await this.repository.save(reconciled);
    return { ...reconciled };
  }

  async attachComponent(parentAssetId: string, componentId: string, actor?: AssetActor): Promise<Asset> {
    const parent = await this.requireAsset(parentAssetId, "parentAssetId");
    const component = await this.requireAsset(componentId, "componentId");
    if (parentAssetId === componentId) {
      throw new ValidationError(["An asset cannot be attached to itself"]);
    }
    if (parent.status === "DECOMMISSIONED" || component.status === "DECOMMISSIONED") {
      throw new ValidationError(["Decommissioned assets cannot be attached"]);
    }
    if (component.parentAssetId !== undefined && component.parentAssetId !== null) {
      throw new ValidationError([`Component ${componentId} is already attached`]);
    }
    await this.assertNoCycle(parentAssetId, componentId);

    const tx = this.transaction("COMPONENT_ATTACH", actor, {
      parentAssetId,
      parentNftId: parent.nftId,
      componentId,
      componentNftId: component.nftId,
    });
    const result = await this.submit(tx);
    const reconciled = await this.reconcileAfterWrite(
      componentId,
      result,
      { ...component, parentAssetId }
    );
    this.assets.set(componentId, reconciled);
    await this.repository.save(reconciled);
    return { ...reconciled };
  }

  async removeComponent(parentAssetId: string, componentId: string, actor?: AssetActor): Promise<Asset> {
    const parent = await this.requireAsset(parentAssetId, "parentAssetId");
    const component = await this.requireAsset(componentId, "componentId");
    if (component.parentAssetId !== parentAssetId) {
      throw new ValidationError([`Component ${componentId} is not attached to ${parentAssetId}`]);
    }

    const tx = this.transaction("COMPONENT_REMOVE", actor, {
      parentAssetId,
      parentNftId: parent.nftId,
      componentId,
      componentNftId: component.nftId,
    });
    const result = await this.submit(tx);
    const reconciled = await this.reconcileAfterWrite(
      componentId,
      result,
      { ...component, parentAssetId: null }
    );
    this.assets.set(componentId, reconciled);
    await this.repository.save(reconciled);
    return { ...reconciled };
  }

  assertStateTransition(current: AssetStatus, next: AssetStatus): void {
    const allowed: Record<AssetStatus, AssetStatus[]> = {
      ACTIVE: ["IN_MAINTENANCE", "DECOMMISSIONED"],
      IN_MAINTENANCE: ["ACTIVE", "DECOMMISSIONED"],
      DECOMMISSIONED: [],
    };
    if (!allowed[current].includes(next)) {
      throw new ValidationError([`Invalid asset state transition: ${current} -> ${next}`]);
    }
  }

  private async assertNoCycle(parentAssetId: string, componentId: string): Promise<void> {
    let current: Asset | null = await this.getById(parentAssetId);
    const visited = new Set<string>();
    while (current?.parentAssetId) {
      if (visited.has(current.assetId)) {
        throw new ValidationError(["Asset component hierarchy contains a cycle"]);
      }
      visited.add(current.assetId);
      if (current.parentAssetId === componentId) {
        throw new ValidationError(["Component attachment would create a cycle"]);
      }
      current = await this.getById(current.parentAssetId);
    }
  }

  private async requireAsset(id: string, field = "assetId"): Promise<Asset> {
    const asset = await this.getById(id);
    if (!asset) {
      if (field === "assetId") throw new NotFoundError(`No asset ${id}`);
      throw new ValidationError([`${field} ${id} does not exist`]);
    }
    return asset;
  }

  private requiredString(value: unknown, field: string): string {
    if (typeof value !== "string" || value.trim().length === 0) {
      throw new ValidationError([`${field} is required`]);
    }
    return value.trim();
  }

  private requireActor(actor?: AssetActor): AssetActor {
    const identityId = this.requiredString(actor?.identityId, "actorIdentity");
    const walletAddress = this.requiredString(actor?.walletAddress, "actorWallet");
    return { identityId, walletAddress };
  }

  private transaction(
    type: Transaction["type"],
    actor: AssetActor | undefined,
    payload: Record<string, unknown>
  ): Transaction {
    const signer = this.requireActor(actor);
    return {
      txId: randomUUID(),
      type,
      actorIdentity: signer.identityId,
      actorWallet: signer.walletAddress,
      payload,
      timestamp: new Date().toISOString(),
      // The production adapter replaces this with a device-signed payload;
      // this matches the development transaction path used by user writes.
      signature: "development",
    };
  }

  private async submit(tx: Transaction): Promise<MockBlockchainResult & { nftId?: string }> {
    const detailed = (this.chain as DetailedBlockchainService).submitTransactionDetailed;
    const result = detailed
      ? await detailed.call(this.chain, tx)
      : await this.chain.submitTransaction(tx);
    if (result.status !== "SUCCESS") {
      throw new TransactionRejectedError(tx.type);
    }
    return result;
  }

  private async reconcileAfterWrite(
    assetId: string,
    result: MockBlockchainResult & { nftId?: string },
    fallback: Asset
  ): Promise<Asset> {
    const onChain = await this.chain.getAsset(assetId);
    if (onChain) return this.mergeAsset(onChain, fallback);
    if (result.nftId) return { ...fallback, nftId: result.nftId };
    throw new BlockchainStateUnavailableError(assetId, result.txId);
  }

  private mergeAsset(onChain: Asset, cached?: Asset): Asset {
    return {
      ...(cached ?? onChain),
      ...onChain,
      assetId: onChain.assetId || cached?.assetId || "",
      assetType: onChain.assetType || cached?.assetType || "",
      parentAssetId: onChain.parentAssetId === undefined
        ? cached?.parentAssetId ?? null
        : onChain.parentAssetId,
    };
  }
}
