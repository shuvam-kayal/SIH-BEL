import { describe, expect, it, beforeEach } from "vitest";
import request from "supertest";
import type { BlockchainService } from "../src/adapters/BlockchainService";
import { createApp } from "../src/app";
import { createContainer } from "../src/container";
import { AssetsServiceImpl } from "../src/assets/assets.service";
import { authorizationGrantsStore } from "../src/assets/authorization-grants.store";
import type { BlockchainStatus, MockBlockchainResult } from "../../shared/api";
import type { Asset, Block, Identity, Job, Transaction, Validator, Wallet } from "../../shared/types";

class FakeBlockchain implements BlockchainService {
  readonly transactions: Transaction[] = [];
  status: MockBlockchainResult["status"] = "SUCCESS";

  async submitTransaction(tx: Transaction): Promise<MockBlockchainResult> {
    this.transactions.push(tx);
    return { txId: tx.txId, status: this.status };
  }

  async getIdentity(_identityId: string): Promise<Identity | null> { return null; }
  async getWallet(_address: string): Promise<Wallet | null> { return null; }
  async getAsset(_id: string): Promise<Asset | null> { return null; }
  async getJob(_id: string): Promise<Job | null> { return null; }
  async getValidators(): Promise<Validator[]> { return []; }
  async getCommittee(_height: number): Promise<string[]> { return []; }
  async getBlock(_height: number): Promise<Block | null> { return null; }
  async getStatus(): Promise<BlockchainStatus> {
    return { height: 0, healthy: true, finalityLag: 0, lastFinalizedHeight: 0 };
  }
}

const actor = { identityId: "DID:BEL:ADMIN", walletAddress: "0xAdmin" };

describe("AssetsServiceImpl", () => {
  beforeEach(() => authorizationGrantsStore.clear());

  it("round-trips a created asset through list and getById", async () => {
    const chain = new FakeBlockchain();
    const service = new AssetsServiceImpl(chain);

    const created = await service.create(
      { assetId: "AST-001", assetType: "TOOL", ownerId: "DID:BEL:1", custodianId: "DID:BEL:1" },
      actor
    );

    expect(await service.list()).toEqual([created]);
    expect(await service.getById("AST-001")).toEqual(created);
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

    const withSeparateCustodian = await service.transfer(
      "AST-002",
      "DID:BEL:3",
      "DID:BEL:4",
      actor
    );
    expect(withSeparateCustodian.custodianId).toBe("DID:BEL:4");
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
    });

    const app = createApp(container);
    const response = await request(app)
      .post("/assets/AST-AUTH/transfer")
      .set("x-bel-employee-id", "EMP-ENGINEER")
      .set("x-bel-role", "ENGINEER")
      .send({ newOwnerId: "DID:BEL:NEW" });

    expect(response.status).toBe(403);
    expect(chain.transactions).toHaveLength(1);
  });

  it("accepts an active grant and respects a separate new custodian", async () => {
    const chain = new FakeBlockchain();
    const container = createContainer(chain);
    await container.assets.create({
      assetId: "AST-GRANTED",
      assetType: "TOOL",
      ownerId: "DID:BEL:OWNER",
      custodianId: "DID:BEL:OWNER",
    });
    authorizationGrantsStore.add({
      authorizationGrantId: "GRANT-001",
      actorIdentityId: "DID:BEL:EMP-ENGINEER",
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
      .set("x-bel-employee-id", "EMP-ENGINEER")
      .set("x-bel-role", "ENGINEER")
      .send({ newOwnerId: "DID:BEL:NEW", newCustodianId: "DID:BEL:CUSTODIAN" });

    expect(response.status).toBe(200);
    expect(response.body.ownerId).toBe("DID:BEL:NEW");
    expect(response.body.custodianId).toBe("DID:BEL:CUSTODIAN");
  });
});
