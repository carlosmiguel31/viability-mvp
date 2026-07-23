import { NextFunction, Request, Response } from "express";
import { ZodError } from "zod";
import { AppError } from "../utils/errors";
import { env } from "../config/env";
import { logger } from "../utils/logger";

/**
 * Middleware global de erros.
 * Em producao, nunca expoe stack trace, SQL ou detalhes internos.
 */
export function errorMiddleware(
  err: unknown,
  _req: Request,
  res: Response,
  _next: NextFunction
): void {
  if (err instanceof ZodError) {
    res.status(400).json({
      error: {
        code: "VALIDATION_ERROR",
        message: "Dados invalidos na requisicao.",
        details: err.errors.map((e) => ({ field: e.path.join("."), message: e.message })),
      },
    });
    return;
  }

  if (err instanceof AppError) {
    res.status(err.statusCode).json({
      error: { code: err.code, message: err.message },
    });
    return;
  }

  const message = err instanceof Error ? err.message : "Erro desconhecido";
  logger.error("Erro nao tratado", { message });
  res.status(500).json({
    error: {
      code: "INTERNAL_ERROR",
      message:
        env.NODE_ENV === "production"
          ? "Ocorreu um erro interno. Tente novamente mais tarde."
          : message,
    },
  });
}
