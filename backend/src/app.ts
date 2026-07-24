import express from "express";
import cors from "cors";
import helmet from "helmet";
import rateLimit from "express-rate-limit";
import { viabilityRoutes } from "./routes/viability.routes";
import { coverageRoutes } from "./routes/coverage.routes";
import { consultationRoutes } from "./routes/consultation.routes";
import { dashboardRoutes } from "./routes/dashboard.routes";
import { addressRoutes } from "./routes/address.routes";
import { authRoutes } from "./routes/auth.routes";
import { userRoutes } from "./routes/user.routes";
import { auditRoutes } from "./routes/audit.routes";
import cookieParser from "cookie-parser";
import { errorMiddleware } from "./middlewares/error.middleware";
import { env } from "./config/env";
import { AppError } from "./utils/errors";

/**
 * Em desenvolvimento/teste a origem local e sempre aceita e requisicoes sem
 * header Origin (curl, healthchecks) sao permitidas. Em producao, somente as
 * origens listadas em CORS_ALLOWED_ORIGINS.
 */
export function isOriginAllowed(
  origin: string | undefined,
  allowedOrigins: string[],
  nodeEnv: string
): boolean {
  if (!origin) return true; // Requisicoes sem Origin (curl, server-to-server).
  if (nodeEnv !== "production" && /^https?:\/\/localhost(:\d+)?$/.test(origin)) return true;
  return allowedOrigins.includes(origin);
}

function parseAllowedOrigins(raw: string): string[] {
  return raw
    .split(",")
    .map((o) => o.trim())
    .filter(Boolean);
}

export interface AppRateLimits {
  viabilityMaxPerMinute: number;
  reloadMaxPerFifteenMinutes: number;
}

const DEFAULT_RATE_LIMITS: AppRateLimits = {
  viabilityMaxPerMinute: 60,
  reloadMaxPerFifteenMinutes: 5,
};

export function createApp(rateLimits: AppRateLimits = DEFAULT_RATE_LIMITS): express.Express {
  const app = express();
  const allowedOrigins = parseAllowedOrigins(env.CORS_ALLOWED_ORIGINS);

  // Atras de Nginx/Cloudflare, habilite TRUST_PROXY explicitamente para o
  // rate limiting identificar o IP real. Nunca irrestrito por padrao.
  if (env.TRUST_PROXY !== false) {
    app.set("trust proxy", env.TRUST_PROXY);
  }

  app.use(helmet());
  app.use(
    cors({
      credentials: true, // cookie HttpOnly do refresh token
      origin: (origin, callback) => {
        if (isOriginAllowed(origin, allowedOrigins, env.NODE_ENV)) {
          callback(null, true);
        } else {
          // Erro explicito: a requisicao NAO chega aos controllers e o
          // handler global responde 403 com CORS_ORIGIN_DENIED.
          callback(new AppError("CORS_ORIGIN_DENIED", "Origem não autorizada.", 403));
        }
      },
    })
  );
  app.use(express.json({ limit: "100kb" })); // limite de body
  app.use(cookieParser());

  const viabilityLimiter = rateLimit({
    windowMs: 60_000,
    max: rateLimits.viabilityMaxPerMinute,
    standardHeaders: true,
    legacyHeaders: false,
    message: {
      error: {
        code: "RATE_LIMITED",
        message: "Muitas consultas em sequencia. Aguarde um instante e tente novamente.",
      },
    },
  });

  const reloadLimiter = rateLimit({
    windowMs: 15 * 60_000,
    max: rateLimits.reloadMaxPerFifteenMinutes,
    standardHeaders: true,
    legacyHeaders: false,
    message: {
      error: {
        code: "RATE_LIMITED",
        message: "Limite de recargas atingido. Tente novamente mais tarde.",
      },
    },
  });

  app.get("/api/health", (_req, res) => {
    res.json({ status: "ok" });
  });

  app.use("/api/auth", authRoutes);
  app.use("/api/users", userRoutes);
  app.use("/api/audit-logs", auditRoutes);
  app.use("/api/viabilities", viabilityLimiter, viabilityRoutes);
  app.use("/api/addresses", viabilityLimiter, addressRoutes);
  app.use("/api/coverage/reload", reloadLimiter);
  app.use("/api/coverage", coverageRoutes);
  app.use("/api/consultations", consultationRoutes);
  app.use("/api/dashboard", dashboardRoutes);

  // Rotas inexistentes retornam JSON amigavel.
  app.use((_req, res) => {
    res.status(404).json({
      error: { code: "ROUTE_NOT_FOUND", message: "Rota nao encontrada." },
    });
  });

  app.use(errorMiddleware);
  return app;
}
