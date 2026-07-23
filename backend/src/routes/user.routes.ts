import { Router } from "express";
import {
  createUserHandler,
  getUserHandler,
  listUsersHandler,
  resetPasswordHandler,
  setUserStatusHandler,
  updateUserHandler,
} from "../controllers/user.controller";
import { requireAuth, requireRoles } from "../middlewares/auth.middleware";

/** Administracao de usuarios: EXCLUSIVA do perfil ADMIN. Sem exclusao fisica. */
export const userRoutes = Router();

userRoutes.use(requireAuth, requireRoles("ADMIN"));

userRoutes.post("/", createUserHandler);
userRoutes.get("/", listUsersHandler);
userRoutes.get("/:id", getUserHandler);
userRoutes.patch("/:id", updateUserHandler);
userRoutes.patch("/:id/status", setUserStatusHandler);
userRoutes.post("/:id/reset-password", resetPasswordHandler);
