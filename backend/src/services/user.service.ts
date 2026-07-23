import { prisma } from "../db/prisma";
import type { Prisma } from "../generated/prisma/client";
import { AppError } from "../utils/errors";
import {
  hashPassword,
  isPasswordStrongEnough,
  PASSWORD_POLICY_MESSAGE,
} from "../utils/password";
import { recordAudit } from "./audit.service";
import type { User } from "../generated/prisma/client";
import type { UserRole } from "../generated/prisma/enums";

/** Resposta publica: passwordHash NUNCA sai daqui. */
export interface PublicUser {
  id: string;
  name: string;
  email: string;
  role: UserRole;
  active: boolean;
  lastLoginAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

export function toPublicUser(user: User): PublicUser {
  return {
    id: user.id,
    name: user.name,
    email: user.email,
    role: user.role,
    active: user.active,
    lastLoginAt: user.lastLoginAt,
    createdAt: user.createdAt,
    updatedAt: user.updatedAt,
  };
}

export function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}

function assertPassword(password: string): void {
  if (!isPasswordStrongEnough(password)) {
    throw new AppError("WEAK_PASSWORD", PASSWORD_POLICY_MESSAGE, 400);
  }
}

async function assertEmailAvailable(email: string, ignoreUserId?: string): Promise<void> {
  const existing = await prisma.user.findUnique({ where: { email } });
  if (existing && existing.id !== ignoreUserId) {
    throw new AppError("EMAIL_IN_USE", "Já existe um usuário com este e-mail.", 409);
  }
}

/**
 * Garante que a acao nao remove o ULTIMO ADMIN ativo do sistema.
 * Executa DENTRO de uma transacao e trava (FOR UPDATE) as linhas dos ADMINs
 * ativos, serializando duas alteracoes concorrentes: a segunda so prossegue
 * depois da primeira e ve o estado ja atualizado.
 */
async function assertNotLastActiveAdmin(
  tx: Prisma.TransactionClient,
  userId: string
): Promise<void> {
  const lockedAdmins = await tx.$queryRaw<Array<{ id: string }>>`
    SELECT "id" FROM "users"
    WHERE "role" = 'ADMIN'::"UserRole" AND "active" = TRUE
    FOR UPDATE
  `;
  const target = await tx.user.findUnique({ where: { id: userId } });
  if (!target || target.role !== "ADMIN" || !target.active) return;
  if (lockedAdmins.length <= 1) {
    throw new AppError(
      "LAST_ADMIN",
      "Este é o único administrador ativo: promova outro administrador antes.",
      409
    );
  }
}

export async function createUser(
  input: { name: string; email: string; password: string; role: UserRole; active?: boolean },
  actor: { id: string },
  ipAddress: string | null
): Promise<PublicUser> {
  const email = normalizeEmail(input.email);
  assertPassword(input.password);
  await assertEmailAvailable(email);
  const user = await prisma.user.create({
    data: {
      name: input.name.trim(),
      email,
      passwordHash: await hashPassword(input.password),
      role: input.role,
      active: input.active ?? true,
      createdBy: actor.id,
      updatedBy: actor.id,
    },
  });
  await recordAudit({
    userId: actor.id,
    action: "USER_CREATED",
    entity: "user",
    entityId: user.id,
    metadata: { role: user.role },
    ipAddress,
  });
  return toPublicUser(user);
}

export async function listUsers(filters: {
  search?: string;
  role?: UserRole;
  active?: boolean;
  page: number;
  pageSize: number;
}): Promise<{ users: PublicUser[]; total: number; page: number; pageSize: number }> {
  const where = {
    ...(filters.role ? { role: filters.role } : {}),
    ...(filters.active !== undefined ? { active: filters.active } : {}),
    ...(filters.search
      ? {
          OR: [
            { name: { contains: filters.search, mode: "insensitive" as const } },
            { email: { contains: filters.search.toLowerCase() } },
          ],
        }
      : {}),
  };
  const [total, users] = await Promise.all([
    prisma.user.count({ where }),
    prisma.user.findMany({
      where,
      orderBy: { name: "asc" },
      skip: (filters.page - 1) * filters.pageSize,
      take: filters.pageSize,
    }),
  ]);
  return { users: users.map(toPublicUser), total, page: filters.page, pageSize: filters.pageSize };
}

export async function getUser(id: string): Promise<PublicUser> {
  const user = await prisma.user.findUnique({ where: { id } });
  if (!user) throw new AppError("USER_NOT_FOUND", "Usuário não encontrado.", 404);
  return toPublicUser(user);
}

export async function updateUser(
  id: string,
  input: { name?: string; email?: string; role?: UserRole },
  actor: { id: string },
  ipAddress: string | null
): Promise<PublicUser> {
  const current = await prisma.user.findUnique({ where: { id } });
  if (!current) throw new AppError("USER_NOT_FOUND", "Usuário não encontrado.", 404);

  const email = input.email !== undefined ? normalizeEmail(input.email) : undefined;
  if (email) await assertEmailAvailable(email, id);

  const roleChanged = input.role !== undefined && input.role !== current.role;
  const user = await prisma.$transaction(async (tx) => {
    if (roleChanged && current.role === "ADMIN") {
      // Nao permitir rebaixar o ultimo ADMIN ativo (inclusive a si mesmo).
      await assertNotLastActiveAdmin(tx, id);
    }
    return tx.user.update({
      where: { id },
      data: {
        ...(input.name !== undefined ? { name: input.name.trim() } : {}),
        ...(email !== undefined ? { email } : {}),
        ...(input.role !== undefined ? { role: input.role } : {}),
        updatedBy: actor.id,
      },
    });
  });

  await recordAudit({
    userId: actor.id,
    action: roleChanged ? "USER_ROLE_CHANGED" : "USER_UPDATED",
    entity: "user",
    entityId: id,
    metadata: roleChanged ? { from: current.role, to: user.role } : undefined,
    ipAddress,
  });
  return toPublicUser(user);
}

export async function setUserStatus(
  id: string,
  active: boolean,
  options: { confirmSelfDeactivation?: boolean },
  actor: { id: string },
  ipAddress: string | null
): Promise<PublicUser> {
  const current = await prisma.user.findUnique({ where: { id } });
  if (!current) throw new AppError("USER_NOT_FOUND", "Usuário não encontrado.", 404);

  if (!active && id === actor.id && !options.confirmSelfDeactivation) {
    throw new AppError(
      "SELF_DEACTIVATION_CONFIRMATION_REQUIRED",
      "Para inativar a própria conta, envie a confirmação explícita.",
      400
    );
  }

  // Transacao: proteção do último ADMIN + inativação + revogação das
  // sessões acontecem juntas — sem estado parcialmente atualizado.
  const user = await prisma.$transaction(async (tx) => {
    if (!active) {
      await assertNotLastActiveAdmin(tx, id);
      // Inativacao encerra todas as sessoes do usuario.
      await tx.refreshToken.updateMany({
        where: { userId: id, revokedAt: null },
        data: { revokedAt: new Date(), revokedReason: "SECURITY" },
      });
    }
    return tx.user.update({
      where: { id },
      data: { active, updatedBy: actor.id },
    });
  });
  await recordAudit({
    userId: actor.id,
    action: active ? "USER_ACTIVATED" : "USER_DEACTIVATED",
    entity: "user",
    entityId: id,
    ipAddress,
  });
  return toPublicUser(user);
}

export async function resetUserPassword(
  id: string,
  newPassword: string,
  actor: { id: string },
  ipAddress: string | null
): Promise<void> {
  const current = await prisma.user.findUnique({ where: { id } });
  if (!current) throw new AppError("USER_NOT_FOUND", "Usuário não encontrado.", 404);
  assertPassword(newPassword);
  const passwordHash = await hashPassword(newPassword);
  // Transacao: novo hash + revogacao das sessoes, tudo ou nada.
  await prisma.$transaction([
    prisma.user.update({
      where: { id },
      data: { passwordHash, updatedBy: actor.id },
    }),
    prisma.refreshToken.updateMany({
      where: { userId: id, revokedAt: null },
      data: { revokedAt: new Date(), revokedReason: "SECURITY" },
    }),
  ]);
  await recordAudit({
    userId: actor.id,
    action: "USER_PASSWORD_RESET",
    entity: "user",
    entityId: id,
    ipAddress,
  });
}
