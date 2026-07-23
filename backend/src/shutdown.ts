import type { Server } from "http";
import { closeVoallePool } from "./config/database";
import { disconnectAppDatabase } from "./db/prisma";
import { logger } from "./utils/logger";

/**
 * Encerramento correto: para de aceitar novas conexoes HTTP, fecha o pool
 * somente-leitura do Voalle e a conexao Prisma do banco da aplicacao, e so
 * entao encerra o processo.
 */
export async function shutdown(
  server: Pick<Server, "close">,
  closePool: () => Promise<void> = closeVoallePool,
  closeAppDb: () => Promise<void> = disconnectAppDatabase
): Promise<void> {
  await new Promise<void>((resolve) => {
    server.close(() => resolve());
  });
  await closePool();
  await closeAppDb();
  logger.info("Servidor encerrado com seguranca");
}

export function setupGracefulShutdown(server: Server): void {
  const handle = (signal: string) => {
    logger.info("Sinal de encerramento recebido", { signal });
    void shutdown(server)
      .catch((err) => {
        const message = err instanceof Error ? err.message : "erro desconhecido";
        logger.error("Falha durante o encerramento", { message });
      })
      .finally(() => process.exit(0));
  };
  process.on("SIGINT", () => handle("SIGINT"));
  process.on("SIGTERM", () => handle("SIGTERM"));
}
