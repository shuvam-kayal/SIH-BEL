import { describe, expect, it } from "vitest";
import request from "supertest";
import type { BlockchainService } from "../src/adapters/BlockchainService";
import { createApp } from "../src/app";
import { createContainer } from "../src/container";
import { AssetsServiceImpl } from "../src/assets/assets.service";
import type { BlockchainStatus, MockBlockchainResult } from "../../shared/api";
import type { Asset, Block, Identity, Job, Transaction, Validator, Wallet } from "../../shared/types";

class FakeBlockchain implements BlockchainService {
  readonly transactions: Transaction[] = [];
  status: MockBlockchainResult["status"] = "SUCCESS";
  private nextNftId = 700;
  private readonly assets = new Map<string, Asset>();

  async submitTransaction(tx: Transaction): Promise<MockBlockchainResult> {
    this.transactions.push(tx);
    if (this.status === "SUCCESS") {
      const payload = tx.payload;
      if (tx.type === "ASSET_MINT") {
        const assetId = String(payload.assetId);
        this.assets.set(assetId, {
          assetId,
          nftId: String(this.nextNftId++),
          assetType: String(payload.assetType),
          ownerId: String(payload.ownerId),
          custodianId: String(payload.ownerId),
          parentAssetId: (payload.parentAssetId as string | null) ?? null,
          status: "ACTIVE",
        });
      } else if (tx.type === "ASSET_TRANSFER") {
        const asset = this.assets.get(String(payload.assetId));
        if (asset) {
          asset.ownerId = String(payload.newOwnerId);
          asset.custodianId = asset.ownerId;
        }
      } else if (tx.type === "ASSET_STATE_CHANGE") {
        const asset = this.assets.get(String(payload.assetId));
        if (asset) asset.status = payload.newState as Asset["status"];
      } else if (tx.type === "COMPONENT_ATTACH") {
        const asset = this.assets.get(String(payload.componentId));
        if (asset) asset.parentAssetId = String(payload.parentAssetId);
      } else if (tx.type === "COMPONENT_REMOVE") {
        const asset = this.assets.get(String(payload.componentId));
        if (asset) asset.parentAssetId = null;
      }
    }
    return { txId: tx.txId, status: this.status };
  }

  async getIdentity(_identityId: string): Promise<Identity | null> { return null; }
  async getWallet(_address: string): Promise<Wallet | null> { return null; }
  async getAsset(id: string): Promise<Asset | null> {
    const asset = this.assets.get(id);
    return asset ? { ...asset } : null;
  }
  async getJob(_id: string): Promise<Job | null> { return null; }
  async getValidators(): Promise<Validator[]> { return []; }
  async getCommittee(_height: number): Promise<string[]> { return []; }
  async getBlock(_height: number): Promise<Block | null> { return null; }
  async getStatus(): Promise<BlockchainStatus> {
    return { height: 0, healthy: true, finalityLag: 0, lastFinalizedHeight: 0 };
  }
}

const actor = { identityId: "DID:BEL:ADMIN", walletAddress: "0xAdmin" };

async function createSession(container: ReturnType<typeof createContainer>, employeeId: string, role: "ENGINEER") {
  const created = await container.users.createUser({ employeeId, fullName: employeeId, role, department: "TEST" });
  await container.users.registerDevice(employeeId, `${employeeId}-DEVICE`, `${employeeId}-CREDENTIAL`, `PUBLIC-${employeeId}`);
  await container.users.registerWallet(employeeId, `${employeeId}-DEVICE`, `0xTEST-${employeeId}`);
  await container.users.activateWallet(employeeId, `${employeeId}-DEVICE`, `0xTEST-${employeeId}`);
  const session = await container.auth.login(`${employeeId}-CREDENTIAL`);
  return { identityId: created.identity.identityId, token: session.token };
}

describe("AssetsServiceImpl", () => {
  it("round-trips a created asset through list and getById", async () => {
    const chain = new FakeBlockchain();
    const service = new AssetsServiceImpl(chain);

    const created = await service.create(
      { assetId: "AST-001", assetType: "TOOL", ownerId: "DID:BEL:1", custodianId: "DID:BEL:1" },
      actor
    );

    expect(await service.list()).toEqual([created]);
    expect(await service.getById("AST-001")).toEqual(created);
    expect(created.nftId).toBe("700");
    expect(chain.transactions[0]).toMatchObject({
      type: "ASSET_MINT",
      actorIdentity: actor.identityId,
      actorWallet: actor.walletAddress,
    });
  });

  it("updates owner and custodian on transfer, defaulting custody to owner", async () => {
    const chain = new FakeBlockchain();
    const service = new AssetsServiceImpl(chain);
    await service.create(
      { assetId: "AST-002", assetType: "VEHICLE", ownerId: "DID:BEL:1", custodianId: "DID:BEL:1" },
      actor
    );

    const transferred = await service.transfer("AST-002", "DID:BEL:2", undefined, actor);
    expect(transferred.ownerId).toBe("DID:BEL:2");
    expect(transferred.custodianId).toBe("DID:BEL:2");
  });

  it("enforces lifecycle transitions and prevents component cycles", async () => {
    const chain = new FakeBlockchain();
    const service = new AssetsServiceImpl(chain);
    await service.create({ assetId: "AST-PARENT", assetType: "VEHICLE", ownerId: "DID:BEL:1", custodianId: "DID:BEL:1" }, actor);
    await service.create({ assetId: "AST-CHILD", assetType: "PART", ownerId: "DID:BEL:1", custodianId: "DID:BEL:1" }, actor);
    await service.create({ assetId: "AST-GRANDCHILD", assetType: "PART", ownerId: "DID:BEL:1", custodianId: "DID:BEL:1" }, actor);

    await service.changeAssetState("AST-PARENT", "IN_MAINTENANCE", actor);
    await service.changeAssetState("AST-PARENT", "ACTIVE", actor);
    await service.attachComponent("AST-PARENT", "AST-CHILD", actor);
    await service.attachComponent("AST-CHILD", "AST-GRANDCHILD", actor);
    await expect(service.attachComponent("AST-GRANDCHILD", "AST-PARENT", actor))
      .rejects.toThrow("Component attachment would create a cycle");
    await service.removeComponent("AST-PARENT", "AST-CHILD", actor);
    await service.changeAssetState("AST-PARENT", "DECOMMISSIONED", actor);
    await expect(service.changeAssetState("AST-PARENT", "ACTIVE", actor))
      .rejects.toThrow("Invalid asset state transition");
  });

  it("does not project a rejected submission", async () => {
    const chain = new FakeBlockchain();
    chain.status = "REJECTED";
    const service = new AssetsServiceImpl(chain);

    await expect(
      service.create(
        { assetId: "AST-REJECTED", assetType: "TOOL", ownerId: "DID:BEL:1", custodianId: "DID:BEL:1" },
        actor
      )
    ).rejects.toThrow("Blockchain rejected ASSET_MINT");
    expect(await service.getById("AST-REJECTED")).toBeNull();
  });

  it("blocks an Engineer transfer without an active asset grant", async () => {
    const chain = new FakeBlockchain();
    const container = createContainer(chain);
    await container.assets.create({
      assetId: "AST-AUTH",
      assetType: "TOOL",
      ownerId: "DID:BEL:OWNER",
      custodianId: "DID:BEL:OWNER",
    }, actor);
    const engineer = await createSession(container, "EMP-ENGINEER", "ENGINEER");

    const app = createApp(container);
    const response = await request(app)
      .post("/assets/AST-AUTH/transfer")
      .set("Authorization", `Bearer ${engineer.token}`)
      .send({ newOwnerId: "DID:BEL:NEW" });

    expect(response.status).toBe(403);
    expect(chain.transactions.filter((tx) => tx.type === "ASSET_TRANSFER")).toHaveLength(0);
  });

  it("accepts an active grant and keeps custody consistent with ownership", async () => {
    const chain = new FakeBlockchain();
    const container = createContainer(chain);
    await container.assets.create({
      assetId: "AST-GRANTED",
      assetType: "TOOL",
      ownerId: "DID:BEL:OWNER",
      custodianId: "DID:BEL:OWNER",
    }, actor);
    const engineer = await createSession(container, "EMP-ENGINEER", "ENGINEER");
    await container.repositories.grants.save({
      authorizationGrantId: "GRANT-001",
      actorIdentityId: engineer.identityId,
      resourceType: "ASSET",
      resourceId: "AST-GRANTED",
      action: "TRANSFER_ASSET",
      grantedByIdentityId: "DID:BEL:OWNER",
      issuedAt: new Date().toISOString(),
      expiresAt: null,
      status: "ACTIVE",
    });

    const response = await request(createApp(container))
      .post("/assets/AST-GRANTED/transfer")
      .set("Authorization", `Bearer ${engineer.token}`)
      .send({ newOwnerId: "DID:BEL:NEW" });

    expect(response.status).toBe(200);
    expect(response.body.ownerId).toBe("DID:BEL:NEW");
    expect(response.body.custodianId).toBe("DID:BEL:NEW");
  });

  it("rejects a separate custodian because the frozen contract moves both together", async () => {
    const chain = new FakeBlockchain();
    const service = new AssetsServiceImpl(chain);
    await service.create(
      { assetId: "AST-CUSTODY", assetType: "TOOL", ownerId: "DID:BEL:1", custodianId: "DID:BEL:1" },
      actor
    );

    await expect(service.transfer("AST-CUSTODY", "DID:BEL:2", "DID:BEL:3", actor))
      .rejects.toThrow("newCustodianId must equal newOwnerId");
    expect(chain.transactions).toHaveLength(1);
  });
});
