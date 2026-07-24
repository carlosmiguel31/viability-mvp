import { Router } from "express";
import rateLimit from "express-rate-limit";
import {
  dashboardUsersHandler,
  dashboardBreakdownsHandler,
  dashboardRankingsHandler,
  dashboardRecentConsultationsHandler,
  dashboardSummaryHandler,
  dashboardTimelineHandler,
} from "../controllers/dashboard.controller";
import { requireAuth, requireRoles } from "../middlewares/auth.middleware";

export const dashboardRoutes = Router();

/** Uso normal do dashboard: 5 endpoints por aplicacao de filtros. */
const dashboardLimiter = rateLimit({
  windowMs: 60 * 1000,
  limit: 60,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: { code: "RATE_LIMITED", message: "Muitas requisições ao dashboard." } },
});

// Somente leitura, sempre autenticado; nenhum endpoint publico.
dashboardRoutes.use(requireAuth, dashboardLimiter);
dashboardRoutes.get("/summary", dashboardSummaryHandler);
dashboardRoutes.get("/timeline", dashboardTimelineHandler);
dashboardRoutes.get("/breakdowns", dashboardBreakdownsHandler);
dashboardRoutes.get("/rankings", dashboardRankingsHandler);
dashboardRoutes.get("/recent-consultations", dashboardRecentConsultationsHandler);
// Opcoes minimas de usuarios para o filtro (VIEWER: 403). O /api/users
// administrativo segue exclusivo de ADMIN.
dashboardRoutes.get(
  "/users",
  requireRoles("ADMIN", "OPERATOR", "TECHNICIAN"),
  dashboardUsersHandler
);
