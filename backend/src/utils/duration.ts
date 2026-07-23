/**
 * Fonte ÚNICA da duração do refresh token, usada por:
 * - assinatura do JWT (expiresIn);
 * - coluna expiresAt em refresh_tokens;
 * - maxAge do cookie HttpOnly.
 * Evita divergência entre token de 7 dias e cookie apenas de sessão.
 */
const UNIT_MS = { s: 1000, m: 60_000, h: 3_600_000, d: 86_400_000 } as const;

export function parseDurationMs(value: string, fallbackMs: number): number {
  const match = /^(\d+)([smhd])$/.exec(value.trim());
  if (!match) return fallbackMs;
  return Number(match[1]) * UNIT_MS[match[2] as keyof typeof UNIT_MS];
}
