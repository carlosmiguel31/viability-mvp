import { Router } from "express";
import { listAuditLogsHandler } from "../controllers/user.controller";
import { requireAuth, requireRoles } from "../middlewares/auth.middleware";

export const auditRoutes = Router();

auditRoutes.get("/", requireAuth, requireRoles("ADMIN"), listAuditLogsHandler);
