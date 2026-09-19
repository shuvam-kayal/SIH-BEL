import { describe, expect, it, vi } from "vitest";
import { BlockchainError } from "../src/blockchain/errors";
import { BesuConsensusSource } from "../src/blockchain/besu-consensus-source";

function providerReturning(result: unknown) {
  return { send: vi.fn().mockResolvedValue(result) } as never;
}

describe("BesuConsensusSource", () => {
  it("calls bel_getCommittee with a hex block quantity and returns validatorIds", async () => {
    const provider = providerReturning({
      height: 123,
      validatorIds: ["0x1111111111111111111111111111111111111111", "0x2222222222222222222222222222222222222222"],
    });
    const source = new BesuConsensusSource(provider);
    await expect(source.getCommittee(123)).resolves.toEqual([
      "0x1111111111111111111111111111111111111111",
      "0x2222222222222222222222222222222222222222",
    ]);
    expect((provider as { send: ReturnType<typeof vi.fn> }).send).toHaveBeenCalledWith("bel_getCommittee", ["0x7b"]);
  });

  it("converts a block height to the Besu hex quantity format", async () => {
    const provider = providerReturning({ height: 7, validatorIds: [] });
    const source = new BesuConsensusSource(provider);
    await expect(source.getCommittee(7)).resolves.toEqual([]);
    expect((provider as { send: ReturnType<typeof vi.fn> }).send).toHaveBeenCalledWith("bel_getCommittee", ["0x7"]);
  });

  it("rejects invalid heights before making an RPC call", async () => {
    const provider = providerReturning({ height: 0, validatorIds: [] });
    const source = new BesuConsensusSource(provider);
    await expect(source.getCommittee(-1)).rejects.toMatchObject({ kind: "INVALID_PAYLOAD" });
    expect((provider as { send: ReturnType<typeof vi.fn> }).send).not.toHaveBeenCalled();
  });

  it("rejects malformed Besu responses", async () => {
    const provider = providerReturning({ height: 123, validatorIds: ["not-an-address"] });
    const source = new BesuConsensusSource(provider);
    await expect(source.getCommittee(123)).rejects.toBeInstanceOf(BlockchainError);
  });

  it("maps an RPC failure to a NETWORK error", async () => {
    const provider = { send: vi.fn().mockRejectedValue(new Error("method not found")) } as never;
    const source = new BesuConsensusSource(provider);
    await expect(source.getCommittee(123)).rejects.toMatchObject({ kind: "NETWORK" });
  });
});
