import { afterEach, describe, expect, it, vi } from "vitest";
import { EvidenceStorageError, IpfsEvidenceStorage } from "../src/evidence/evidence.storage";

afterEach(() => { vi.restoreAllMocks(); });

describe("IpfsEvidenceStorage", () => {
  it("uploads exact bytes and validates the returned CID and size", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response(JSON.stringify({ Hash: "bafy-test", Size: "46" }), { status: 200 }));
    const result = await new IpfsEvidenceStorage("http://private-ipfs:5001").upload(Buffer.from("hello"), "text/plain");
    expect(result).toEqual({ cid: "bafy-test", sizeBytes: 5 });
    expect(fetchMock).toHaveBeenCalledWith("http://private-ipfs:5001/api/v0/add?pin=true", expect.objectContaining({ method: "POST" }));
  });

  it("downloads and bounds the response", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response(Buffer.from("hello"), { status: 200 }));
    await expect(new IpfsEvidenceStorage().download("bafy-test")).resolves.toEqual(Buffer.from("hello"));
  });

  it("rejects malformed responses and provider failures", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(new Response("not-json", { status: 200 }));
    await expect(new IpfsEvidenceStorage().upload(Buffer.from("hello"), "text/plain")).rejects.toBeInstanceOf(EvidenceStorageError);

    vi.spyOn(globalThis, "fetch").mockRejectedValueOnce(new Error("connection refused"));
    await expect(new IpfsEvidenceStorage().download("bafy-test")).rejects.toMatchObject({ message: "Private evidence storage is unavailable" });
  });
});
