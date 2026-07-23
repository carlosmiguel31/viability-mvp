import { createHash, randomUUID } from "crypto";
import { prisma } from "../db/prisma";
import { env } from "../config/env";
import { AppError } from "../utils/errors";
import {
  hashPassword,
  isPasswordStrongEnough,
  PASSWORD_POLICY_MESSAGE,
  verifyPassword,
} from "../utils/password";
import { parseDurationMs } from "../utils/duration";
import {
  signAccessToken,
  signRefreshToken,
  verifyRefreshToken,
} from "../utils/jwt";
import { recordAudit } from "./audit.service";
import { logger } from "../utils/logger";
import type { User } from "../generated/prisma/client";

/** Mensagem publica generica: nunca revela qual campo esta incorreto. */
const INVALID_CREDENTIALS = new AppError(
  "INVALID_CREDENTIALS",
  "E-mail ou senha inválidos.",
  401
);

const SESSION_ERROR = () => new AppError("UNAUTHORIZED", "Sessão inválida ou expirada.", 401);

/**
 * Corrida LEGITIMA: outra renovacao concorrente consumiu este token primeiro.
 * Nao e falha de autenticacao — a familia continua valida e o cookie do
 * navegador ja foi atualizado pela requisicao vencedora. O controller NAO
 * limpa o cookie e o frontend pode tentar de novo (uma vez) com o cookie
 * atualizado. 409 para nao se confundir com 401 de sessao invalida.
 */
const RACE_LOST_ERROR = () =>
  new AppError(
    "REFRESH_RACE_LOST",
    "A sessão foi renovada por outra requisição simultânea.",
    409
  );

/**
 * Janela em que um token recem-rotacionado apresentado de novo e tratado
 * como corrida legitima de renovacoes simultaneas (nao como roubo).
 */
const REFRESH_REUSE_GRACE_MS = 10_000;

function sha256(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

/** Duracao do refresh em ms — mesma fonte para JWT, banco e cookie. */
export function refreshTtlMs(): number {
  return parseDurationMs(env.JWT_REFRESH_EXPIRES_IN, 7 * 86_400_000);
}

function refreshExpiresAt(): Date {
  return new Date(Date.now() + refreshTtlMs());
}

export interface AuthTokens {
  accessToken: string;
  refreshToken: string;
  user: { id: string; name: string; email: string; role: User["role"] };
}

function toPublicUser(user: User): AuthTokens["user"] {
  return { id: user.id, name: user.name, email: user.email, role: user.role };
}

function buildAccessToken(user: User, familyId: string): string {
  // O access token carrega a familia da sessao: revogar a familia (logout,
  // troca/reset de senha, inativacao) derruba o access imediatamente.
  return signAccessToken({
    sub: user.id,
    familyId,
    role: user.role,
    name: user.name,
    email: user.email,
  });
}

/** Emite access + refresh (persistindo SOMENTE o hash do refresh). */
async function issueTokens(user: User, familyId: string): Promise<AuthTokens> {
  const jti = randomUUID();
  const refreshToken = signRefreshToken({ sub: user.id, jti, familyId });
  await prisma.refreshToken.create({
    data: {
      id: jti,
      userId: user.id,
      tokenHash: sha256(refreshToken),
      familyId,
      expiresAt: refreshExpiresAt(),
    },
  });
  return {
    accessToken: buildAccessToken(user, familyId),
    refreshToken,
    user: toPublicUser(user),
  };
}

export async function login(
  email: string,
  password: string,
  ipAddress: string | null
): Promise<AuthTokens> {
  const normalizedEmail = email.trim().toLowerCase();
  const user = await prisma.user.findUnique({ where: { email: normalizedEmail } });

  // Falha generica para e-mail inexistente, senha incorreta ou usuario inativo.
  const passwordOk = user ? await verifyPassword(password, user.passwordHash) : false;
  if (!user || !passwordOk || !user.active) {
    await recordAudit({
      userId: user?.id ?? null,
      action: "LOGIN_FAILED",
      entity: "auth",
      // Sem senha e sem dados sensiveis; apenas o motivo interno.
      metadata: {
        reason: !user ? "unknown_email" : !passwordOk ? "wrong_password" : "inactive_user",
      },
      ipAddress,
    });
    throw INVALID_CREDENTIALS;
  }

  await prisma.user.update({ where: { id: user.id }, data: { lastLoginAt: new Date() } });
  await recordAudit({
    userId: user.id,
    action: "LOGIN_SUCCESS",
    entity: "auth",
    ipAddress,
  });
  // Cada login abre uma NOVA familia de sessao: logins em outros
  // computadores nao encerram sessoes anteriores.
  return issueTokens(user, randomUUID());
}

/**
 * Gancho EXCLUSIVO DE TESTE: executado dentro da transacao de rotacao,
 * apos o consumo do token antigo e antes da criacao do sucessor. Permite
 * simular falha na criacao e comprovar o rollback. Nunca definir fora de
 * testes.
 */
export const rotationTestHooks: { beforeCreateSuccessor?: () => void } = {};

export async function refresh(refreshTokenValue: string): Promise<AuthTokens> {
  let payload;
  try {
    payload = verifyRefreshToken(refreshTokenValue);
  } catch {
    throw SESSION_ERROR();
  }

  const stored = await prisma.refreshToken.findUnique({
    where: { tokenHash: sha256(refreshTokenValue) },
  });
  if (!stored) throw SESSION_ERROR();
  if (!stored.revokedAt && stored.expiresAt <= new Date()) throw SESSION_ERROR();

  // O conteudo assinado precisa corresponder EXATAMENTE ao registro.
  if (
    payload.sub !== stored.userId ||
    payload.jti !== stored.id ||
    payload.familyId !== stored.familyId
  ) {
    throw SESSION_ERROR();
  }

  if (stored.revokedAt) {
    // Revogacao de SEGURANCA (logout, inativacao, troca/reset de senha,
    // familia punida): sessao encerrada de fato — 401 e cookie limpo.
    if (stored.revokedReason !== "ROTATED") throw SESSION_ERROR();

    // Token consumido por ROTACAO. Duas situacoes distintas:
    // - dentro da janela de graca: quase certamente uma CORRIDA legitima
    //   (duas renovacoes simultaneas) — 409 REFRESH_RACE_LOST, familia
    //   intacta e cookie preservado;
    // - fora da janela: REUSO real (possivel roubo) — revoga a familia toda.
    const elapsedMs = Date.now() - stored.revokedAt.getTime();
    if (elapsedMs > REFRESH_REUSE_GRACE_MS) {
      logger.warn("Reuso de refresh token detectado; familia revogada", {
        familyId: stored.familyId,
      });
      await prisma.refreshToken.updateMany({
        where: { familyId: stored.familyId, revokedAt: null },
        data: { revokedAt: new Date(), revokedReason: "SECURITY" },
      });
      throw SESSION_ERROR(); // reuso real: 401 + cookie limpo
    }
    throw RACE_LOST_ERROR(); // corrida legitima: familia intacta
  }

  // Sucessor gerado ANTES da transacao (jti, token assinado, hash, validade).
  const jti = randomUUID();
  const nextRefreshToken = signRefreshToken({
    sub: stored.userId,
    jti,
    familyId: stored.familyId,
  });
  const nextTokenHash = sha256(nextRefreshToken);
  const nextExpiresAt = refreshExpiresAt();

  // ROTACAO ATOMICA: consumo do token antigo + criacao do sucessor na MESMA
  // transacao. Qualquer falha (inclusive na criacao) faz rollback e o token
  // antigo permanece NAO revogado — a familia nunca fica sem token ativo.
  const user = await prisma.$transaction(async (tx) => {
    const consumed = await tx.refreshToken.updateMany({
      where: { id: stored.id, revokedAt: null, expiresAt: { gt: new Date() } },
      data: { revokedAt: new Date(), revokedReason: "ROTATED" },
    });
    if (consumed.count !== 1) {
      // Alguem consumiu entre a leitura e o update: corrida legitima
      // (expiracao real ja teria sido barrada acima pelo stored.expiresAt).
      if (stored.expiresAt <= new Date()) throw SESSION_ERROR();
      throw RACE_LOST_ERROR();
    }

    const currentUser = await tx.user.findUnique({ where: { id: payload.sub } });
    // Usuario inativado nao renova a sessao.
    if (!currentUser || !currentUser.active) throw SESSION_ERROR();

    rotationTestHooks.beforeCreateSuccessor?.();

    await tx.refreshToken.create({
      data: {
        id: jti,
        userId: currentUser.id,
        tokenHash: nextTokenHash,
        familyId: stored.familyId,
        expiresAt: nextExpiresAt,
      },
    });
    return currentUser;
  });

  // Alteracao de perfil vale a partir daqui: o novo access token e emitido
  // com o papel ATUAL lido do banco, na MESMA familia de sessao.
  return {
    accessToken: buildAccessToken(user, stored.familyId),
    refreshToken: nextRefreshToken,
    user: toPublicUser(user),
  };
}

export async function logout(
  refreshTokenValue: string | undefined,
  ipAddress: string | null
): Promise<void> {
  if (!refreshTokenValue) return;
  const stored = await prisma.refreshToken.findUnique({
    where: { tokenHash: sha256(refreshTokenValue) },
  });
  if (!stored) return;
  // Logout encerra a sessao ATUAL (familia deste refresh), preservando
  // sessoes de outros dispositivos.
  await prisma.refreshToken.updateMany({
    where: { familyId: stored.familyId, revokedAt: null },
    data: { revokedAt: new Date(), revokedReason: "SECURITY" },
  });
  await recordAudit({
    userId: stored.userId,
    action: "LOGOUT",
    entity: "auth",
    ipAddress,
  });
}

/**
 * Alteracao da PROPRIA senha: verifica a atual, aplica a politica, exige
 * nova diferente e revoga TODAS as sessoes na mesma transacao (novo login
 * obrigatorio). Nenhuma senha e registrada em log ou auditoria.
 */
export async function changeOwnPassword(
  userId: string,
  currentPassword: string,
  newPassword: string,
  ipAddress: string | null
): Promise<void> {
  const user = await prisma.user.findUnique({ where: { id: userId } });
  if (!user || !user.active) throw SESSION_ERROR();

  const currentOk = await verifyPassword(currentPassword, user.passwordHash);
  if (!currentOk) {
    throw new AppError("INVALID_CURRENT_PASSWORD", "Senha atual incorreta.", 400);
  }
  if (!isPasswordStrongEnough(newPassword)) {
    throw new AppError("WEAK_PASSWORD", PASSWORD_POLICY_MESSAGE, 400);
  }
  const sameAsCurrent = await verifyPassword(newPassword, user.passwordHash);
  if (sameAsCurrent) {
    throw new AppError(
      "PASSWORD_UNCHANGED",
      "A nova senha deve ser diferente da senha atual.",
      400
    );
  }

  const passwordHash = await hashPassword(newPassword);
  // Transacao: hash novo + revogacao de todas as sessoes, tudo ou nada.
  await prisma.$transaction([
    prisma.user.update({
      where: { id: userId },
      data: { passwordHash, updatedBy: userId },
    }),
    prisma.refreshToken.updateMany({
      where: { userId, revokedAt: null },
      data: { revokedAt: new Date(), revokedReason: "SECURITY" },
    }),
  ]);
  await recordAudit({
    userId,
    action: "USER_PASSWORD_CHANGED",
    entity: "user",
    entityId: userId,
    ipAddress,
  });
}
