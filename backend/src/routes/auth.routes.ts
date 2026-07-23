import { Router } from "express";
import rateLimit from "express-rate-limit";
import {
  changePasswordHandler,
  loginHandler,
  logoutHandler,
  meHandler,
  refreshHandler,
} from "../controllers/auth.controller";
import { requireAuth } from "../middlewares/auth.middleware";
import { env } from "../config/env";

/** Protecao contra brute force: limite especifico e mais rigido no login. */
export const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 10,
  skip: () => env.NODE_ENV === "test", // suite compartilha o mesmo IP
  standardHeaders: true,
  legacyHeaders: false,
  message: {
    error: {
      code: "TOO_MANY_ATTEMPTS",
      message: "Muitas tentativas de login. Aguarde alguns minutos.",
    },
  },
});

export const authRoutes = Router();

authRoutes.post("/login", loginLimiter, loginHandler);
authRoutes.post("/refresh", refreshHandler);
authRoutes.post("/logout", logoutHandler);
authRoutes.get("/me", requireAuth, meHandler);
authRoutes.post("/change-password", requireAuth, changePasswordHandler);
