import { NextFunction, Request, Response, Router } from "express";
import multer from "multer";
import { AppError } from "../utils/errors";
import { env } from "../config/env";
import {
  coverageAreasHandler,
  coverageReloadHandler,
  coverageStatusHandler,
} from "../controllers/coverage.controller";
import {
  createLayerHandler,
  createPartnerHandler,
  deleteLayerHandler,
  getLayerHandler,
  getPartnerHandler,
  listLayersHandler,
  listPartnersHandler,
  setLayerStatusHandler,
  setPartnerStatusHandler,
  updateLayerHandler,
  updatePartnerHandler,
} from "../controllers/coverage-admin.controller";
import { requireAuth, requireRoles } from "../middlewares/auth.middleware";
import { maxCoverageFileBytes } from "../services/coverage-storage.service";

/**
 * Upload em memoria (o servico grava com nome interno seguro). O limite do
 * multer fica 1 byte ACIMA do maximo permitido para que o excesso seja
 * respondido com o codigo da aplicacao (COVERAGE_FILE_TOO_LARGE), nao com o
 * erro generico do multer.
 */
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: maxCoverageFileBytes() + 1, files: 1 },
});

/** Converte erros do multer nos codigos da aplicacao (sem 500 generico). */
function uploadCoverageFile(req: Request, res: Response, next: NextFunction): void {
  upload.single("file")(req, res, (err: unknown) => {
    if (!err) return next();
    if (err instanceof multer.MulterError && err.code === "LIMIT_FILE_SIZE") {
      return next(
        new AppError(
          "COVERAGE_FILE_TOO_LARGE",
          `O arquivo excede o limite de ${env.COVERAGE_MAX_FILE_SIZE_MB} MB.`,
          400
        )
      );
    }
    return next(new AppError("COVERAGE_FILE_INVALID", "Falha ao receber o arquivo.", 400));
  });
}

export const coverageRoutes = Router();

// Status e poligonos exigem autenticacao (qualquer perfil).
coverageRoutes.get("/status", requireAuth, coverageStatusHandler);
coverageRoutes.get("/areas", requireAuth, coverageAreasHandler);
// Reconstrucao do snapshot: acao administrativa auditada, exclusiva de ADMIN.
coverageRoutes.post("/reload", requireAuth, requireRoles("ADMIN"), coverageReloadHandler);

// ── Parceiros ─────────────────────────────────────────────────
// Leitura: qualquer perfil autenticado (nao-admins veem apenas ativos).
coverageRoutes.get("/partners", requireAuth, listPartnersHandler);
coverageRoutes.get("/partners/:id", requireAuth, requireRoles("ADMIN"), getPartnerHandler);
// Gerenciamento: exclusivo de ADMIN.
coverageRoutes.post("/partners", requireAuth, requireRoles("ADMIN"), createPartnerHandler);
coverageRoutes.patch("/partners/:id", requireAuth, requireRoles("ADMIN"), updatePartnerHandler);
coverageRoutes.patch(
  "/partners/:id/status",
  requireAuth,
  requireRoles("ADMIN"),
  setPartnerStatusHandler
);

// ── Camadas ───────────────────────────────────────────────────
// Leitura: qualquer perfil autenticado (nao-admins: lista basica de ativas).
coverageRoutes.get("/layers", requireAuth, listLayersHandler);
coverageRoutes.get("/layers/:id", requireAuth, requireRoles("ADMIN"), getLayerHandler);
// Upload e gerenciamento: exclusivos de ADMIN.
coverageRoutes.post(
  "/layers",
  requireAuth,
  requireRoles("ADMIN"),
  uploadCoverageFile,
  createLayerHandler
);
coverageRoutes.patch("/layers/:id", requireAuth, requireRoles("ADMIN"), updateLayerHandler);
coverageRoutes.patch(
  "/layers/:id/status",
  requireAuth,
  requireRoles("ADMIN"),
  setLayerStatusHandler
);
coverageRoutes.delete("/layers/:id", requireAuth, requireRoles("ADMIN"), deleteLayerHandler);
