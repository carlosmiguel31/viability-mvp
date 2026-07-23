import { randomBytes } from "crypto";

/** Alfabeto sem caracteres ambiguos (0/O, 1/I/L). */
const ALPHABET = "ABCDEFGHJKMNPQRSTUVWXYZ23456789";

/**
 * Protocolo publico legivel: VIA-AAAAMMDD-XXXXXXXX.
 * O sufixo de 8 caracteres vem de randomBytes (geracao segura) — nunca da
 * contagem de registros. Colisoes sao tratadas pelo chamador (unique no
 * banco + nova tentativa com novo sufixo).
 */
export function generateProtocol(now: Date = new Date()): string {
  const date = [
    String(now.getUTCFullYear()),
    String(now.getUTCMonth() + 1).padStart(2, "0"),
    String(now.getUTCDate()).padStart(2, "0"),
  ].join("");
  const bytes = randomBytes(8);
  let suffix = "";
  for (let index = 0; index < 8; index += 1) {
    suffix += ALPHABET[bytes[index] % ALPHABET.length];
  }
  return `VIA-${date}-${suffix}`;
}

export const PROTOCOL_PATTERN = /^VIA-\d{8}-[A-Z2-9]{8}$/;
