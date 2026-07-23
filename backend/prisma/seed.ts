/**
 * Seed do PRIMEIRO administrador (SEED_ADMIN_NAME/EMAIL/PASSWORD).
 * - Cria o ADMIN apenas quando nenhum usuário existe com o e-mail informado;
 * - NUNCA sobrescreve a senha de um usuário existente;
 * - Falha quando a senha inicial não respeita a política mínima;
 * - Não registra a senha no terminal.
 * A senha inicial deve ser alterada após o primeiro acesso.
 */
import "dotenv/config";
import { env } from "../src/config/env";
import { prisma, disconnectAppDatabase } from "../src/db/prisma";
import {
  hashPassword,
  isPasswordStrongEnough,
  PASSWORD_POLICY_MESSAGE,
} from "../src/utils/password";
import { normalizeEmail } from "../src/services/user.service";

export async function seedFirstAdmin(): Promise<"created" | "exists"> {
  const name = env.SEED_ADMIN_NAME.trim();
  const email = normalizeEmail(env.SEED_ADMIN_EMAIL);
  const password = env.SEED_ADMIN_PASSWORD;

  if (!name || !email || !password) {
    throw new Error(
      "Defina SEED_ADMIN_NAME, SEED_ADMIN_EMAIL e SEED_ADMIN_PASSWORD no ambiente."
    );
  }
  if (!isPasswordStrongEnough(password)) {
    throw new Error(`Senha inicial rejeitada: ${PASSWORD_POLICY_MESSAGE}`);
  }

  const existing = await prisma.user.findUnique({ where: { email } });
  if (existing) {
    // Nunca sobrescreve a senha automaticamente.
    console.log(`Administrador já existe (${email}); nada foi alterado.`);
    return "exists";
  }

  await prisma.user.create({
    data: {
      name,
      email,
      passwordHash: await hashPassword(password),
      role: "ADMIN",
      active: true,
    },
  });
  console.log(
    `Administrador criado (${email}). Altere a senha inicial após o primeiro acesso.`
  );
  return "created";
}

// Execução direta: npm run seed
if (process.argv[1]?.endsWith("seed.ts")) {
  seedFirstAdmin()
    .catch((err) => {
      console.error(err instanceof Error ? err.message : err);
      process.exitCode = 1;
    })
    .finally(() => disconnectAppDatabase());
}
