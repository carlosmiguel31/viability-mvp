import { NextFunction, Request, Response } from "express";
import { AppError } from "../utils/errors";
import { verifyAccessToken } from "../utils/jwt";
import { prisma } from "../db/prisma";
import type { UserRole } from "../generated/prisma/enums";

export interface AuthenticatedUser {
  id: string;
  role: UserRole;
  name: string;
  email: string;
}

declare module "express-serve-static-core" {
  interface Request {
    user?: AuthenticatedUser;
  }
}

/**
 * 401 quando nao autenticado (Bearer access token ausente ou invalido).
 * Alem da assinatura/expiracao, UMA consulta (relacao + some) confirma que:
 * - o usuario segue ATIVO (inativacao vale imediatamente); e
 * - a FAMILIA de sessao do token ainda possui um refresh ativo (nao
 *   revogado e nao expirado) — logout, troca de senha e reset revogam a
 *   familia e derrubam o access token na hora, sem esperar expirar.
 * A resposta nunca detalha o motivo.
 */
export async function requireAuth(
  req: Request,
  _res: Response,
  next: NextFunction
): Promise<void> {
  const header = req.header("authorization") ?? "";
  const [scheme, token] = header.split(" ");
  if (scheme !== "Bearer" || !token) {
    next(new AppError("UNAUTHORIZED", "Autenticação necessária.", 401));
    return;
  }
  try {
    const payload = verifyAccessToken(token);
    const sessionUser = await prisma.user.findFirst({
      where: {
        id: payload.sub,
        active: true,
        refreshTokens: {
          some: {
            familyId: payload.familyId,
            revokedAt: null,
            expiresAt: { gt: new Date() },
          },
        },
      },
      select: { id: true },
    });
    if (!sessionUser) {
      next(new AppError("UNAUTHORIZED", "Sessão inválida ou expirada.", 401));
      return;
    }
    req.user = {
      id: payload.sub,
      role: payload.role,
      name: payload.name,
      email: payload.email,
    };
    next();
  } catch {
    next(new AppError("UNAUTHORIZED", "Sessão inválida ou expirada.", 401));
  }
}

/**
 * 403 quando autenticado sem permissao. O frontend esconde menus, mas a
 * autorizacao REAL acontece aqui — chamadas manuais a API recebem 403.
 */
export function requireRoles(...roles: UserRole[]) {
  return (req: Request, _res: Response, next: NextFunction): void => {
    if (!req.user) {
      next(new AppError("UNAUTHORIZED", "Autenticação necessária.", 401));
      return;
    }
    if (!roles.includes(req.user.role)) {
      next(new AppError("FORBIDDEN", "Você não tem permissão para esta ação.", 403));
      return;
    }
    next();
  };
}
