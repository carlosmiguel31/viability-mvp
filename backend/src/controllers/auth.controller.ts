import { NextFunction, Request, Response } from "express";
import { changePasswordSchema, loginSchema } from "../schemas/auth.schema";
import * as authService from "../services/auth.service";
import { env } from "../config/env";
import { AppError } from "../utils/errors";

export const REFRESH_COOKIE_NAME = "viability.refresh";
// Cookie restrito ao caminho de auth: nao trafega nas demais rotas.
const REFRESH_COOKIE_PATH = "/api/auth";

function cookieSecure(): boolean {
  if (env.COOKIE_SECURE === "true") return true;
  if (env.COOKIE_SECURE === "false") return false;
  return env.NODE_ENV === "production";
}

function setRefreshCookie(res: Response, token: string): void {
  res.cookie(REFRESH_COOKIE_NAME, token, {
    httpOnly: true,
    secure: cookieSecure(),
    sameSite: "strict", // proteção CSRF principal para refresh/logout
    path: REFRESH_COOKIE_PATH,
    // Mesma duração do JWT de refresh e do expiresAt persistido (fonte única).
    maxAge: authService.refreshTtlMs(),
  });
}

function clearRefreshCookie(res: Response): void {
  res.clearCookie(REFRESH_COOKIE_NAME, { path: REFRESH_COOKIE_PATH });
}

function clientIp(req: Request): string | null {
  return req.ip ?? null;
}

export async function loginHandler(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const parsed = loginSchema.safeParse(req.body);
    if (!parsed.success) {
      next(new AppError("VALIDATION_ERROR", "E-mail ou senha inválidos.", 400));
      return;
    }
    const tokens = await authService.login(parsed.data.email, parsed.data.password, clientIp(req));
    setRefreshCookie(res, tokens.refreshToken);
    res.status(200).json({ accessToken: tokens.accessToken, user: tokens.user });
  } catch (err) {
    next(err);
  }
}

export async function refreshHandler(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const token = req.cookies?.[REFRESH_COOKIE_NAME];
    if (!token) {
      next(new AppError("UNAUTHORIZED", "Sessão inválida ou expirada.", 401));
      return;
    }
    const tokens = await authService.refresh(token);
    setRefreshCookie(res, tokens.refreshToken); // rotação
    res.status(200).json({ accessToken: tokens.accessToken, user: tokens.user });
  } catch (err) {
    // Corrida legitima (outra renovacao venceu): NAO limpar o cookie — o
    // navegador ja guarda o cookie NOVO gravado pela requisicao vencedora e
    // um Set-Cookie de limpeza aqui apagaria a sessao valida.
    const raceLost = err instanceof AppError && err.code === "REFRESH_RACE_LOST";
    if (!raceLost) clearRefreshCookie(res);
    next(err);
  }
}

export async function logoutHandler(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    await authService.logout(req.cookies?.[REFRESH_COOKIE_NAME], clientIp(req));
    clearRefreshCookie(res);
    res.status(204).send();
  } catch (err) {
    next(err);
  }
}

export function meHandler(req: Request, res: Response): void {
  // requireAuth garante req.user
  res.status(200).json({ user: req.user });
}

export async function changePasswordHandler(
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> {
  try {
    const parsed = changePasswordSchema.safeParse(req.body);
    if (!parsed.success) {
      next(
        new AppError(
          "VALIDATION_ERROR",
          parsed.error.errors[0]?.message ?? "Dados inválidos.",
          400
        )
      );
      return;
    }
    await authService.changeOwnPassword(
      req.user!.id,
      parsed.data.currentPassword,
      parsed.data.newPassword,
      clientIp(req)
    );
    // Todas as sessões foram revogadas: limpa o cookie e exige novo login.
    clearRefreshCookie(res);
    res.status(204).send();
  } catch (err) {
    next(err);
  }
}
