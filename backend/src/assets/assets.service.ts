// Owner: Person 2. Backs GET/POST /assets, GET /assets/:id,
// POST /assets/:id/transfer (docs/API_SPEC.yaml).

import type { BlockchainService } from "../adapters/BlockchainService";
import { HttpError, NotFoundError, ValidationError } from "../errors";
import type { Asset, Transaction } from "../../../shared/types";
import { ASSET_STATUSES, type AssetStatus } from "../../../shared/enums";

/** The authenticated identity and wallet that sign a transaction envelope. */
export type AssetActor = {
  identityId: string;
  walletAddress: string;
};

/** A chain submission that did not reach the success state. */
export class TransactionRejectedError extends HttpError {
  constructor(transactionType: string) {
    super(502, `Blockchain rejected ${transactionType}`, "TRANSACTION_REJECTED");
    this.name = "TransactionRejectedError";
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

/**
 * The adapter's submitTransaction method is deliberately write-only: a
 * successful submission does not promise that getAsset() can read the write
 * back. This map is therefore the backend's off-chain asset projection until
 * the real registry/indexer read path is integrated. nftId values are simple
 * monotonic strings because they are only an off-chain representation here;
 * the deployed registry assigns the authoritative token id.
 */
export class AssetsServiceImpl implements AssetsService {
  private readonly assets = new Map<string, Asset>();
  private nextNftId = 1;
  private nextTransactionId = 1;

  constructor(private readonly chain: BlockchainService) {}

  async list(): Promise<Asset[]> {
    return Array.from(this.assets.values(), (asset) => ({ ...asset }));
  }

  async getById(id: string): Promise<Asset | null> {
    const asset = this.assets.get(id);
    return asset ? { ...asset } : null;
  }

  async create(input: Partial<Asset>, actor?: AssetActor): Promise<Asset> {
    const assetType = this.requiredString(input.assetType, "assetType");
    const ownerId = this.requiredString(input.ownerId, "ownerId");
    const custodianId = this.requiredString(input.custodianId, "custodianId");
    const nftId = String(this.nextNftId++);
    const assetId = input.assetId?.trim() || `AST-${nftId}`;

    if (this.assets.has(assetId)) {
      throw new ValidationError([`assetId ${assetId} already exists`]);
    }
    if (input.parentAssetId !== undefined && input.parentAssetId !== null) {
      this.requireAsset(input.parentAssetId, "parentAssetId");
    }

    const asset: Asset = {
      assetId,
      nftId,
      assetType,
      ownerId,
      custodianId,
      parentAssetId: input.parentAssetId ?? null,
      status: "ACTIVE",
    };

    await this.submit(
      this.transaction("ASSET_MINT", actor, {
        assetId,
        nftId,
        assetType,
        ownerId,
        custodianId,
        parentAssetId: asset.parentAssetId,
      })
    );
    this.assets.set(assetId, asset);
    return { ...asset };
  }

  async transfer(
    id: string,
    newOwnerId: string,
    newCustodianId?: string,
    actor?: AssetActor
  ): Promise<Asset> {
    const asset = this.requireAsset(id);
    const ownerId = this.requiredString(newOwnerId, "newOwnerId");
    const custodianId = newCustodianId === undefined
      ? ownerId
      : this.requiredString(newCustodianId, "newCustodianId");

    await this.submit(
      this.transaction("ASSET_TRANSFER", actor, {
        assetId: asset.assetId,
        nftId: asset.nftId,
        newOwnerId: ownerId,
        newCustodianId: custodianId,
      })
    );

    const updated = { ...asset, ownerId, custodianId };
    this.assets.set(id, updated);
    return { ...updated };
  }

  async changeAssetState(id: string, newState: AssetStatus, actor?: AssetActor): Promise<Asset> {
    if (!ASSET_STATUSES.includes(newState)) {
      throw new ValidationError([`newState must be one of ${ASSET_STATUSES.join(", ")}`]);
    }
    const asset = this.requireAsset(id);
    await this.submit(
      this.transaction("ASSET_STATE_CHANGE", actor, {
        assetId: asset.assetId,
        nftId: asset.nftId,
        previousState: asset.status,
        newState,
      })
    );

    const updated = { ...asset, status: newState };
    this.assets.set(id, updated);
    return { ...updated };
  }

  async attachComponent(parentAssetId: string, componentId: string, actor?: AssetActor): Promise<Asset> {
    const parent = this.requireAsset(parentAssetId, "parentAssetId");
    const component = this.requireAsset(componentId, "componentId");
    if (parentAssetId === componentId) {
      throw new ValidationError(["An asset cannot be attached to itself"]);
    }
    if (component.parentAssetId !== undefined && component.parentAssetId !== null) {
      throw new ValidationError([`Component ${componentId} is already attached`]);
    }

    await this.submit(
      this.transaction("COMPONENT_ATTACH", actor, {
        parentAssetId,
        parentNftId: parent.nftId,
        componentId,
        componentNftId: component.nftId,
      })
    );

    const updated = { ...component, parentAssetId };
    this.assets.set(componentId, updated);
    return { ...updated };
  }

  async removeComponent(parentAssetId: string, componentId: string, actor?: AssetActor): Promise<Asset> {
    const parent = this.requireAsset(parentAssetId, "parentAssetId");
    const component = this.requireAsset(componentId, "componentId");
    if (component.parentAssetId !== parentAssetId) {
      throw new ValidationError([`Component ${componentId} is not attached to ${parentAssetId}`]);
    }

    await this.submit(
      this.transaction("COMPONENT_REMOVE", actor, {
        parentAssetId,
        parentNftId: parent.nftId,
        componentId,
        componentNftId: component.nftId,
      })
    );

    const updated = { ...component, parentAssetId: null };
    this.assets.set(componentId, updated);
    return { ...updated };
  }

  private requireAsset(id: string, field = "assetId"): Asset {
    const asset = this.assets.get(id);
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

  private transaction(
    type: Transaction["type"],
    actor: AssetActor | undefined,
    payload: Record<string, unknown>
  ): Transaction {
    return {
      txId: `asset-tx-${this.nextTransactionId++}`,
      type,
      actorIdentity: actor?.identityId ?? "UNKNOWN",
      actorWallet: actor?.walletAddress ?? "UNKNOWN",
      payload,
      timestamp: new Date().toISOString(),
      // Signing is performed by the real adapter. Keep the envelope complete
      // for the mock adapter and make the hand-off explicit.
      signature: "backend-adapter-pending-signature",
    };
  }

  private async submit(tx: Transaction): Promise<void> {
    const result = await this.chain.submitTransaction(tx);
    if (result.status !== "SUCCESS") {
      throw new TransactionRejectedError(tx.type);
    }
  }
}
