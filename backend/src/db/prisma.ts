import { PrismaClient } from "../generated/prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";
import { env } from "../config/env";

/**
 * BANCO DA APLICACAO (leitura e ESCRITA): usuarios, sessoes (refresh tokens)
 * e auditoria — conexao APP_DATABASE_URL via Prisma.
 *
 * NAO confundir com o banco do Voalle: aquele e acessado EXCLUSIVAMENTE para
 * leitura (erp.authentication_splitters) via pg parametrizado em
 * src/repositories/voalle.repository.ts, e nunca pelo Prisma.
 */
const adapter = new PrismaPg({ connectionString: env.APP_DATABASE_URL });

export const prisma = new PrismaClient({ adapter });

export async function disconnectAppDatabase(): Promise<void> {
  await prisma.$disconnect();
}
