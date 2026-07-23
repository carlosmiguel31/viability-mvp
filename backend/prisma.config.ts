// Configuração do Prisma (v7): conexão do MIGRATE/SEED com o BANCO DA
// APLICAÇÃO (APP_DATABASE_URL). O banco do Voalle não passa pelo Prisma.
import "dotenv/config";
import { defineConfig, env } from "prisma/config";

export default defineConfig({
  schema: "prisma/schema.prisma",
  migrations: {
    path: "prisma/migrations",
    seed: "tsx prisma/seed.ts",
  },
  datasource: {
    url: env("APP_DATABASE_URL"),
  },
});
