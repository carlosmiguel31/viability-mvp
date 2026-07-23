/**
 * Limpeza periodica de refresh tokens (npm run auth:cleanup):
 * remove registros EXPIRADOS ou REVOGADOS ha mais de
 * AUTH_CLEANUP_RETENTION_DAYS dias (padrao 30). Nao roda a cada requisicao —
 * agende via cron/systemd timer (ex.: uma vez por dia).
 */
import "dotenv/config";
import { prisma, disconnectAppDatabase } from "../db/prisma";

export async function cleanupRefreshTokens(retentionDays?: number): Promise<number> {
  const days = retentionDays ?? Number(process.env.AUTH_CLEANUP_RETENTION_DAYS ?? 30);
  if (!Number.isFinite(days) || days < 0) {
    throw new Error("AUTH_CLEANUP_RETENTION_DAYS deve ser um número de dias >= 0.");
  }
  const cutoff = new Date(Date.now() - days * 86_400_000);
  const result = await prisma.refreshToken.deleteMany({
    where: {
      OR: [{ expiresAt: { lt: cutoff } }, { revokedAt: { lt: cutoff } }],
    },
  });
  return result.count;
}

if (process.argv[1]?.endsWith("auth-cleanup.ts")) {
  cleanupRefreshTokens()
    .then((count) => {
      console.log(`Limpeza concluída: ${count} refresh token(s) removido(s).`);
    })
    .catch((err) => {
      console.error(err instanceof Error ? err.message : err);
      process.exitCode = 1;
    })
    .finally(() => disconnectAppDatabase());
}
