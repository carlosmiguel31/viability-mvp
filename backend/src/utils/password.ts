import bcrypt from "bcryptjs";
import { env } from "../config/env";

/**
 * Politica minima de senha: 8+ caracteres com letra maiuscula, minuscula e
 * numero. Hash com bcrypt (BCRYPT_ROUNDS, padrao 12). Senhas nunca sao
 * armazenadas em texto puro nem registradas em logs.
 */
export const PASSWORD_POLICY_MESSAGE =
  "A senha deve ter no mínimo 8 caracteres, com letra maiúscula, minúscula e número.";

export function isPasswordStrongEnough(password: string): boolean {
  return (
    password.length >= 8 &&
    /[a-z]/.test(password) &&
    /[A-Z]/.test(password) &&
    /[0-9]/.test(password)
  );
}

export function hashPassword(password: string): Promise<string> {
  return bcrypt.hash(password, env.BCRYPT_ROUNDS);
}

export function verifyPassword(password: string, passwordHash: string): Promise<boolean> {
  return bcrypt.compare(password, passwordHash);
}
