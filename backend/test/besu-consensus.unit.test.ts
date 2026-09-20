import { describe, expect, it } from "vitest";
import { BesuConsensusSource, BlockchainError, createBlockchainServiceFromEnv, EvmBlockchainAdapter } from "../src/blockchain";

const validator = {
  validatorId: `0x${"11".repeat(20)}`,
  publicKey: `0x${"ab".repeat(64)}`,
  status: "ACTIVE",
  joinedAt: "2026-09-10T12:30:00Z",
};

function rpc(responses: Record<string, unknown> = {}) {
  const calls: Array<{ method: string; params: unknown[] }> = [];
  return {
    calls,
    provider: {
      async send(method: string, params: unknown[]) {
        calls.push({ method, params });
        const response = responses[method];
        if (response instanceof Error) throw response;
        return response;
      },
    },
  };
}

describe("BesuConsensusSource", () => {
  it("loads and maps validators from bel_getValidators at latest", async () => {
    const fake = rpc({ bel_getValidators: { height: 123, validators: [validator] } });
    await expect(new BesuConsensusSource(fake.provider).getValidators()).resolves.toEqual([validator]);
    expect(fake.calls).toEqual([{ method: "bel_getValidators", params: ["latest"] }]);
  });

  it("rejects malformed validator responses", async () => {
    const fake = rpc({ bel_getValidators: { height: 123, validators: [{ ...validator, status: "UNKNOWN" }] } });
    await expect(new BesuConsensusSource(fake.provider).getValidators()).rejects.toMatchObject({
      kind: "NETWORK",
      message: expect.stringContaining("invalid response"),
    });

    const badKey = rpc({ bel_getValidators: { height: 123, validators: [{ ...validator, publicKey: "0x04abcd" }] } });
    await expect(new BesuConsensusSource(badKey.provider).getValidators()).rejects.toMatchObject({ kind: "NETWORK" });

    const badId = rpc({ bel_getValidators: { height: 123, validators: [{ ...validator, validatorId: "val_1" }] } });
    await expect(new BesuConsensusSource(badId.provider).getValidators()).rejects.toMatchObject({ kind: "NETWORK" });
  });

  it("maps validator RPC failures to BlockchainError NETWORK", async () => {
    const fake = rpc({ bel_getValidators: new Error("connection refused") });
    await expect(new BesuConsensusSource(fake.provider).getValidators()).rejects.toMatchObject({
      kind: "NETWORK",
      status: 502,
    });
  });

  it("loads a committee using a Besu hex block quantity", async () => {
    const ids = [`0x${"11".repeat(20)}`, `0x${"22".repeat(20)}`];
    const fake = rpc({ bel_getCommittee: { height: 123, validatorIds: ids } });
    await expect(new BesuConsensusSource(fake.provider).getCommittee(123)).resolves.toEqual(ids);
    expect(fake.calls).toEqual([{ method: "bel_getCommittee", params: ["0x7b"] }]);
  });

  it("rejects invalid heights before making an RPC call", async () => {
    const fake = rpc();
    await expect(new BesuConsensusSource(fake.provider).getCommittee(-1)).rejects.toBeInstanceOf(BlockchainError);
    await expect(new BesuConsensusSource(fake.provider).getCommittee(Number.MAX_SAFE_INTEGER + 1)).rejects.toMatchObject({ kind: "INVALID_PAYLOAD" });
    expect(fake.calls).toHaveLength(0);
  });

  it("rejects committee responses with the wrong height or malformed IDs", async () => {
    const wrongHeight = rpc({ bel_getCommittee: { height: 122, validatorIds: ["0x1111"] } });
    await expect(new BesuConsensusSource(wrongHeight.provider).getCommittee(123)).rejects.toMatchObject({ kind: "NETWORK" });

    const malformed = rpc({ bel_getCommittee: { height: 123, validatorIds: ["0x1111"] } });
    await expect(new BesuConsensusSource(malformed.provider).getCommittee(123)).rejects.toMatchObject({ kind: "NETWORK" });
  });

  it("maps committee RPC failures to BlockchainError NETWORK", async () => {
    const fake = rpc({ bel_getCommittee: new Error("node unavailable") });
    await expect(new BesuConsensusSource(fake.provider).getCommittee(1)).rejects.toMatchObject({ kind: "NETWORK", status: 502 });
  });

  it("is wired by the EVM factory and delegates through the adapter", async () => {
    const fake = rpc({ bel_getValidators: { height: 1, validators: [validator] } });
    const service = createBlockchainServiceFromEnv(
      { BEL_BLOCKCHAIN: "evm", BEL_CHAIN_RPC_URL: "http://unused" },
      { provider: fake.provider as never },
    );
    expect(service).toBeInstanceOf(EvmBlockchainAdapter);
    await expect(service.getValidators()).resolves.toEqual([validator]);
    expect(fake.calls).toEqual([{ method: "bel_getValidators", params: ["latest"] }]);
  });

  it("is wired by the EVM factory and delegates committee reads through the injected provider", async () => {
    const validatorIds = [`0x${"11".repeat(20)}`, `0x${"22".repeat(20)}`];
    const fake = rpc({ bel_getCommittee: { height: 123, validatorIds } });
    const service = createBlockchainServiceFromEnv(
      { BEL_BLOCKCHAIN: "evm", BEL_CHAIN_RPC_URL: "http://unused" },
      { provider: fake.provider as never },
    );

    await expect(service.getCommittee(123)).resolves.toEqual(validatorIds);
    expect(fake.calls).toEqual([{ method: "bel_getCommittee", params: ["0x7b"] }]);
  });
});
