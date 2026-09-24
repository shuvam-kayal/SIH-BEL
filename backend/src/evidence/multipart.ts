import type { Request } from "express";
import { PayloadTooLargeError, UnsupportedMediaTypeError, ValidationError } from "../errors";

export type MultipartEvidence = { bytes: Buffer; filename: string; contentType: string };

/**
 * Small, bounded parser for the single-file evidence contract. The request is
 * capped before buffering, so the backend never allocates unbounded memory for
 * a multipart request. The returned bytes are the exact file part bytes.
 */
export async function readEvidenceMultipart(req: Request, maxFileSizeBytes: number): Promise<MultipartEvidence> {
  const header = req.header("content-type") ?? "";
  const boundaryMatch = /boundary=(?:"([^"]+)"|([^;]+))/i.exec(header);
  if (!boundaryMatch) throw new UnsupportedMediaTypeError("Evidence upload must be multipart/form-data");
  const boundary = Buffer.from(`--${boundaryMatch[1] ?? boundaryMatch[2]}`);
  const chunks: Buffer[] = [];
  let total = 0;
  for await (const chunk of req) {
    const value = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    total += value.length;
    if (total > maxFileSizeBytes + 32 * 1024) throw new PayloadTooLargeError();
    chunks.push(value);
  }
  const body = Buffer.concat(chunks);
  const headerEnd = body.indexOf(Buffer.from("\r\n\r\n"));
  if (headerEnd < 0) throw new ValidationError(["Multipart evidence part is malformed"]);
  const fileStart = headerEnd + 4;
  const endMarker = Buffer.from(`\r\n${boundary.toString()}--`);
  const fileEnd = body.indexOf(endMarker, fileStart);
  if (fileEnd < 0) throw new ValidationError(["Multipart evidence part is malformed"]);
  const partHeaders = body.subarray(0, headerEnd).toString("utf8").split("\r\n");
  const disposition = partHeaders.find((line) => /^content-disposition:/i.test(line)) ?? "";
  const filenameMatch = /filename="([^"]*)"/i.exec(disposition);
  const nameMatch = /name="([^"]*)"/i.exec(disposition);
  if (!filenameMatch || !nameMatch || !["file", "evidence"].includes(nameMatch[1])) {
    throw new ValidationError(["A file field named file is required"]);
  }
  const typeHeader = partHeaders.find((line) => /^content-type:/i.test(line));
  const contentType = typeHeader?.slice(typeHeader.indexOf(":") + 1).trim().toLowerCase() || "application/octet-stream";
  const bytes = body.subarray(fileStart, fileEnd);
  if (bytes.length > maxFileSizeBytes) throw new PayloadTooLargeError();
  return { bytes: Buffer.from(bytes), filename: filenameMatch[1], contentType };
}
