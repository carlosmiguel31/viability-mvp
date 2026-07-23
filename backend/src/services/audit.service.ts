import { prisma } from "../db/prisma";
import type { Prisma } from "../generated/prisma/client";
import { logger } from "../utils/logger";

export type AuditAction =
  | "LOGIN_SUCCESS"
  | "LOGIN_FAILED"
  | "LOGOUT"
  | "USER_CREATED"
  | "USER_UPDATED"
  | "USER_ACTIVATED"
  | "USER_DEACTIVATED"
  | "USER_ROLE_CHANGED"
  | "USER_PASSWORD_RESET"
  | "USER_PASSWORD_CHANGED"
  | "COVERAGE_RELOADED"
  | "COVERAGE_PARTNER_CREATED"
  | "COVERAGE_PARTNER_UPDATED"
  | "COVERAGE_PARTNER_ACTIVATED"
  | "COVERAGE_PARTNER_DEACTIVATED"
  | "COVERAGE_LAYER_UPLOADED"
  | "COVERAGE_LAYER_UPDATED"
  | "COVERAGE_LAYER_ACTIVATED"
  | "COVERAGE_LAYER_DEACTIVATED"
  | "COVERAGE_LAYER_DELETED"
  | "COVERAGE_LAYER_PROCESSING_FAILED";

/** Chaves que NUNCA podem aparecer na auditoria. */
const FORBIDDEN_METADATA_KEYS = [
  "password",
  "senha",
  "passwordhash",
  "hash",
  "token",
  "refreshtoken",
  "accesstoken",
  "secret",
  "key",
  "authorization",
  "credential",
  "street",
  "address",
];

function sanitizeMetadata(
  metadata: Record<string, unknown> | undefined
): Record<string, unknown> | undefined {
  if (!metadata) return undefined;
  const cleaned: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(metadata)) {
    const lower = key.toLowerCase();
    if (FORBIDDEN_METADATA_KEYS.some((forbidden) => lower.includes(forbidden))) continue;
    cleaned[key] = value;
  }
  return cleaned;
}

/**
 * Auditoria em banco da aplicacao. Nunca registra senhas, hashes, tokens,
 * chaves, credenciais do Voalle nem o conteudo completo de enderecos.
 * Falha de auditoria nao derruba a operacao principal (best-effort + log).
 */
export async function recordAudit(entry: {
  userId?: string | null;
  action: AuditAction;
  entity: string;
  entityId?: string | null;
  metadata?: Record<string, unknown>;
  ipAddress?: string | null;
}): Promise<void> {
  try {
    await prisma.auditLog.create({
      data: {
        userId: entry.userId ?? null,
        action: entry.action,
        entity: entry.entity,
        entityId: entry.entityId ?? null,
        metadata: sanitizeMetadata(entry.metadata) as Prisma.InputJsonValue | undefined,
        ipAddress: entry.ipAddress ?? null,
      },
    });
  } catch (err) {
    logger.warn("Falha ao registrar auditoria", {
      action: entry.action,
      message: err instanceof Error ? err.message : "erro desconhecido",
    });
  }
}
