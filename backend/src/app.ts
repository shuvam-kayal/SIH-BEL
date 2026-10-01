// Express app assembly. Exported separately from index.ts so tests can
// mount it with a stub container and no listening socket.

import express, { type Express, type NextFunction, type Request, type Response } from "express";
import cors from "cors";
import { appendFile, mkdir } from "node:fs/promises";
import { dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { randomUUID } from "node:crypto";
import { createContainer, type Container } from "./container";
import { HttpError } from "./errors";
import { attachSession } from "./middleware/session";
import { assetsRouter } from "./routes/assets.routes";
import { chainRouter } from "./routes/chain.routes";
import { jobsRouter } from "./routes/jobs.routes";
import { usersRouter } from "./routes/users.routes";
import { evidenceRouter } from "./routes/evidence.routes";

type RequestDiagnostics = Request & { requestId?: string };

export async function writeBackendErrorLog(req: RequestDiagnostics, err: unknown): Promise<void> {
  const body = req.body as Record<string, unknown> | undefined;
  const signature = typeof body?.signature === "string" ? body.signature : undefined;
  const status = err instanceof HttpError ? err.status : 500;
  const entry = {
    timestamp: new Date().toISOString(),
    method: req.method,
    path: req.originalUrl || req.path,
    requestId: req.requestId,
    status,
    errorName: err instanceof Error ? err.name : "UnknownError",
    message: err instanceof Error ? err.message : String(err),
    stack: err instanceof Error ? err.stack : undefined,
    actorIdentity: req.user?.identityId,
    actorWallet: req.user?.walletAddress,
    signaturePresent: Boolean(signature),
    signatureLength: signature?.length ?? 0,
    transactionType: req.path === "/assets" ? "ASSET_MINT" : req.path === "/jobs" ? "JOB_CREATE" : undefined,
  };
  const path = process.env.BEL_BACKEND_ERROR_LOG?.trim() || fileURLToPath(new URL("../logs/backend-errors.log", import.meta.url));
  try {
    await mkdir(dirname(path), { recursive: true });
    await appendFile(path, `${JSON.stringify(entry)}\n`, "utf8");
  } catch {
    // Error logging must never turn the original request failure into another failure.
  }
}

export function createApp(container: Container = createContainer()): Express {
  const app = express();

  app.use((req, res, next) => {
    const requestId = randomUUID();
    (req as RequestDiagnostics).requestId = requestId;
    res.setHeader("X-Request-Id", requestId);
    next();
  });

  const origins = (process.env.BEL_CORS_ORIGINS ?? (process.env.BEL_ENV === "production" ? "" : "http://localhost:3000,http://127.0.0.1:3000"))
    .split(",")
    .map((origin) => origin.trim())
    .filter(Boolean);
  app.use(cors({
    origin: origins.length ? origins : false,
    credentials: true,
  }));
  app.use(express.json());
  app.use(attachSession(container.auth));

  // Liveness probe for docker-compose / nginx — deliberately not in
  // API_SPEC.yaml, since it is infrastructure rather than product API.
  app.get("/health", (_req, res) => res.json({ status: "ok" }));

  app.use(usersRouter(container));
  app.use(assetsRouter(container));
  app.use(jobsRouter(container));
  app.use(evidenceRouter(container));
  app.use(chainRouter(container));

  app.use((_req, res) => {
    res.status(404).json({ code: "NOT_FOUND", message: "No such route" });
  });

  // Single error serializer. NotImplementedError surfaces as 501 so an
  // unfinished module is visible in the response rather than hidden
  // behind a generic 500.
  app.use((err: unknown, req: Request, res: Response, _next: NextFunction) => {
    if ((err instanceof HttpError ? err.status : 500) === 500) void writeBackendErrorLog(req as RequestDiagnostics, err);
    if (err instanceof HttpError) {
      return res.status(err.status).json({ code: err.code, message: err.message });
    }
    console.error("[backend] unhandled error:", err);
    res.status(500).json({ code: "INTERNAL_ERROR", message: "Unexpected server error" });
  });

  return app;
}
