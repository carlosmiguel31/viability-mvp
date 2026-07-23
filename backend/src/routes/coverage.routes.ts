import { Router } from "express";
import {
  coverageAreasHandler,
  coverageReloadHandler,
  coverageStatusHandler,
} from "../controllers/coverage.controller";
import { requireAuth, requireRoles } from "../middlewares/auth.middleware";

export const coverageRoutes = Router();

// Status e poligonos exigem autenticacao (qualquer perfil).
coverageRoutes.get("/status", requireAuth, coverageStatusHandler);
coverageRoutes.get("/areas", requireAuth, coverageAreasHandler);
// Recarga: acao administrativa auditada, exclusiva de ADMIN.
coverageRoutes.post("/reload", requireAuth, requireRoles("ADMIN"), coverageReloadHandler);
