import { Router } from "express";
import rateLimit from "express-rate-limit";
import {
  exportConsultationsHandler,
  getConsultationByProtocolHandler,
  getConsultationHandler,
  listConsultationsHandler,
} from "../controllers/consultation.controller";
import { requireAuth, requireRoles } from "../middlewares/auth.middleware";

export const consultationRoutes = Router();

/** Exportação é custosa: rate limit próprio, além do limite de linhas. */
const exportLimiter = rateLimit({
  windowMs: 10 * 60 * 1000,
  limit: 10,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: { code: "RATE_LIMITED", message: "Muitas exportações; aguarde." } },
});

// Histórico é IMUTÁVEL: somente leitura (nenhum PATCH/DELETE).
consultationRoutes.get("/", requireAuth, listConsultationsHandler);
consultationRoutes.get(
  "/export",
  requireAuth,
  requireRoles("ADMIN"),
  exportLimiter,
  exportConsultationsHandler
);
consultationRoutes.get("/protocol/:protocol", requireAuth, getConsultationByProtocolHandler);
consultationRoutes.get("/:id", requireAuth, getConsultationHandler);
