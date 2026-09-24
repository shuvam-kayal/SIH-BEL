import { Router } from "express";
import type { Container } from "../container";
import { requirePermission } from "../auth/rbac.middleware";
import { requireSession } from "../middleware/session";
import { readEvidenceMultipart } from "../evidence/multipart";
import { sanitizeFilename } from "../evidence/evidence.service";

function actor(req: Express.Request) {
  return { identityId: req.user!.identityId, walletAddress: req.user!.walletAddress, role: req.user!.role };
}

function viewPermission(c: Container) {
  return requirePermission("VIEW_AUDIT_HISTORY", async (req) => {
    const job = await c.jobRepository.findById(req.params.jobId);
    return { resourceOwnerId: job?.assignedTo };
  });
}

export function evidenceRouter(c: Container): Router {
  const router = Router();

  router.post(
    "/jobs/:jobId/evidence",
    requireSession,
    requirePermission("PERFORM_MAINTENANCE"),
    async (req, res, next) => {
      try {
        const file = await readEvidenceMultipart(req, c.evidence.uploadLimitBytes);
        const evidence = await c.evidence.upload(req.params.jobId, actor(req), file);
        res.status(201).json(toResponse(evidence));
      } catch (error) {
        next(error);
      }
    },
  );

  router.get("/jobs/:jobId/evidence", requireSession, viewPermission(c), async (req, res, next) => {
    try {
      const evidence = await c.evidence.list(req.params.jobId, actor(req));
      res.json(evidence.map(toResponse));
    } catch (error) {
      next(error);
    }
  });

  router.get("/jobs/:jobId/evidence/:evidenceId", requireSession, viewPermission(c), async (req, res, next) => {
    try {
      const result = await c.evidence.download(req.params.jobId, req.params.evidenceId, actor(req));
      res.setHeader("Content-Type", result.evidence.contentType);
      res.setHeader("Content-Length", String(result.bytes.length));
      res.setHeader("Content-Disposition", `attachment; filename="${sanitizeFilename(result.evidence.originalFilename)}"`);
      res.send(result.bytes);
    } catch (error) {
      next(error);
    }
  });

  return router;
}

function toResponse(evidence: Awaited<ReturnType<Container["evidence"]["list"]>>[number]) {
  return {
    id: evidence.evidenceId,
    evidenceId: evidence.evidenceId,
    jobId: evidence.jobId,
    cid: evidence.cid,
    sha256: evidence.sha256,
    filename: evidence.originalFilename,
    originalFilename: evidence.originalFilename,
    contentType: evidence.contentType,
    sizeBytes: evidence.sizeBytes,
    uploadedBy: evidence.uploadedBy,
    createdAt: evidence.createdAt,
    updatedAt: evidence.updatedAt,
  };
}
