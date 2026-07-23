import { Pool } from "pg";
import { env, isVoalleConfigured } from "./env";
import { logger } from "../utils/logger";

let pool: Pool | null = null;

/**
 * Pool de conexao SOMENTE LEITURA com o banco do Voalle.
 * - `default_transaction_read_only=on` faz o proprio PostgreSQL rejeitar escrita.
 * - Timeouts de conexao e de consulta definidos via env.
 * - Nenhuma credencial e logada.
 */
export function getVoallePool(): Pool {
  if (!isVoalleConfigured()) {
    throw new Error("VOALLE_NOT_CONFIGURED");
  }
  if (!pool) {
    pool = new Pool({
      host: env.VOALLE_DB_HOST,
      port: env.VOALLE_DB_PORT,
      database: env.VOALLE_DB_NAME,
      user: env.VOALLE_DB_USER,
      password: env.VOALLE_DB_PASSWORD,
      ssl: env.VOALLE_DB_SSL ? { rejectUnauthorized: false } : undefined,
      max: 5,
      connectionTimeoutMillis: env.VOALLE_DB_CONNECTION_TIMEOUT_MS,
      query_timeout: env.VOALLE_DB_QUERY_TIMEOUT_MS,
      statement_timeout: env.VOALLE_DB_QUERY_TIMEOUT_MS,
      options: "-c default_transaction_read_only=on",
      application_name: "viability-mvp-readonly",
    });
    pool.on("error", (err) => {
      logger.error("Erro no pool do Voalle", { message: err.message });
    });
  }
  return pool;
}

export async function closeVoallePool(): Promise<void> {
  if (pool) {
    await pool.end();
    pool = null;
  }
}
