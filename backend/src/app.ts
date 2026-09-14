// Express app assembly. Exported separately from index.ts so tests can
// mount it with a stub container and no listening socket.

import express, { type Express, type NextFunction, type Request, type Response } from "express";
import cors from "cors";
import { createContainer, type Container } from "./container";
import { HttpError } from "./errors";
import { attachSession } from "./middleware/session";
import { assetsRouter } from "./routes/assets.routes";
import { chainRouter } from "./routes/chain.routes";
import { jobsRouter } from "./routes/jobs.routes";
import { usersRouter } from "./routes/users.routes";

export function createApp(container: Container = createContainer()): Express {
  const app = express();

  app.use(cors());
  app.use(express.json());
  app.use(attachSession);

  // Liveness probe for docker-compose / nginx — deliberately not in
  // API_SPEC.yaml, since it is infrastructure rather than product API.
  app.get("/health", (_req, res) => res.json({ status: "ok" }));

  app.use(usersRouter(container));
  app.use(assetsRouter(container));
  app.use(jobsRouter(container));
  app.use(chainRouter(container));

  app.use((_req, res) => {
    res.status(404).json({ code: "NOT_FOUND", message: "No such route" });
  });

  // Single error serializer. NotImplementedError surfaces as 501 so an
  // unfinished module is visible in the response rather than hidden
  // behind a generic 500.
  app.use((err: unknown, _req: Request, res: Response, _next: NextFunction) => {
    if (err instanceof HttpError) {
      return res.status(err.status).json({ code: err.code, message: err.message });
    }
    console.error("[backend] unhandled error:", err);
    res.status(500).json({ code: "INTERNAL_ERROR", message: "Unexpected server error" });
  });

  return app;
}
