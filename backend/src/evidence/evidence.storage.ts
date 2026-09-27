export type StoredEvidence = { cid: string; sizeBytes: number };

export interface EvidenceStorage {
  upload(bytes: Buffer, contentType: string): Promise<StoredEvidence>;
  download(cid: string): Promise<Buffer>;
  exists(cid: string): Promise<boolean>;
}

export class EvidenceStorageError extends Error {
  constructor(message: string, options?: { cause?: unknown }) {
    super(message, options);
    this.name = "EvidenceStorageError";
  }
}

type IpfsAddResponse = { Hash?: unknown; Size?: unknown; Name?: unknown };

/** Private Kubo HTTP API adapter. No caller receives the API URL or node error. */
export class IpfsEvidenceStorage implements EvidenceStorage {
  // Compose overrides this with the internal service name. Host-run tests and
  // local development use the published localhost API instead.
  constructor(private readonly apiUrl: string = process.env.IPFS_API_URL ?? "http://localhost:5001") {}

  async upload(bytes: Buffer, contentType: string): Promise<StoredEvidence> {
    const form = new FormData();
    form.append("file", new Blob([bytes], { type: contentType }), "evidence");
    const response = await this.request("/api/v0/add?pin=true", { method: "POST", body: form });
    const raw = await response.text();
    let parsed: IpfsAddResponse;
    try {
      parsed = JSON.parse(raw.trim().split("\n").filter(Boolean).at(-1) ?? "") as IpfsAddResponse;
    } catch (error) {
      throw new EvidenceStorageError("IPFS returned an invalid upload response", { cause: error });
    }
    if (typeof parsed.Hash !== "string" || !parsed.Hash.trim()) {
      throw new EvidenceStorageError("IPFS upload response did not contain a CID");
    }
    // Kubo's Size is the UnixFS/DAG representation size, not necessarily the
    // original file length. The application metadata must describe the exact
    // bytes supplied by the caller, so use the already-known input length.
    if (parsed.Size !== undefined && (!Number.isSafeInteger(Number(parsed.Size)) || Number(parsed.Size) <= 0)) {
      throw new EvidenceStorageError("IPFS upload response contained an invalid size");
    }
    return { cid: parsed.Hash, sizeBytes: bytes.length };
  }

  async download(cid: string): Promise<Buffer> {
    const response = await this.request(`/api/v0/cat?arg=${encodeURIComponent(cid)}`, { method: "POST" });
    const declaredSize = Number(response.headers.get("content-length") ?? 0);
    const maxBytes = parseMaxDownloadBytes();
    if (declaredSize > maxBytes) throw new EvidenceStorageError("IPFS object exceeds the configured evidence limit");
    if (!response.body) {
      const bytes = Buffer.from(await response.arrayBuffer());
      if (bytes.length > maxBytes) throw new EvidenceStorageError("IPFS object exceeds the configured evidence limit");
      return bytes;
    }
    const reader = response.body.getReader();
    const chunks: Buffer[] = [];
    let total = 0;
    for (;;) {
      const part = await reader.read();
      if (part.done) break;
      total += part.value.byteLength;
      if (total > maxBytes) {
        await reader.cancel();
        throw new EvidenceStorageError("IPFS object exceeds the configured evidence limit");
      }
      chunks.push(Buffer.from(part.value));
    }
    return Buffer.concat(chunks, total);
  }

  async exists(cid: string): Promise<boolean> {
    try {
      await this.request(`/api/v0/block/stat?arg=${encodeURIComponent(cid)}`, { method: "POST" });
      return true;
    } catch (error) {
      if (error instanceof EvidenceStorageError && error.message === "IPFS object was not found") return false;
      throw error;
    }
  }

  private async request(path: string, init?: RequestInit): Promise<Response> {
    try {
      const response = await fetch(`${this.apiUrl.replace(/\/$/, "")}${path}`, init);
      if (response.ok) return response;
      if (response.status === 404) throw new EvidenceStorageError("IPFS object was not found");
      throw new EvidenceStorageError(`IPFS request failed with status ${response.status}`);
    } catch (error) {
      if (error instanceof EvidenceStorageError) throw error;
      throw new EvidenceStorageError("Private evidence storage is unavailable", { cause: error });
    }
  }
}

function parseMaxDownloadBytes(): number {
  const mb = Number(process.env.EVIDENCE_MAX_FILE_SIZE_MB ?? 25);
  return Number.isFinite(mb) && mb > 0 ? Math.floor(mb * 1024 * 1024) : 25 * 1024 * 1024;
}

export class MemoryEvidenceStorage implements EvidenceStorage {
  constructor(private readonly objects = new Map<string, Buffer>(), private readonly prefix = "bafy-memory-") {}

  async upload(bytes: Buffer): Promise<StoredEvidence> {
    const cid = `${this.prefix}${this.objects.size + 1}`;
    this.objects.set(cid, Buffer.from(bytes));
    return { cid, sizeBytes: bytes.length };
  }

  async download(cid: string): Promise<Buffer> {
    const bytes = this.objects.get(cid);
    if (!bytes) throw new EvidenceStorageError("IPFS object was not found");
    return Buffer.from(bytes);
  }

  async exists(cid: string): Promise<boolean> { return this.objects.has(cid); }
}
