import { AddressInput, NormalizedAddress } from "../types/address.types";
import { AppError } from "../utils/errors";

/**
 * Normalizacao do endereco antes da geocodificacao:
 * - CEP: somente digitos, exatamente 8 (quando informado);
 * - trim + colapso de espacos duplicados em todos os campos;
 * - UF em maiusculas (2 letras);
 * - acentos preservados;
 * - rua, numero, cidade e UF obrigatorios; bairro/complemento opcionais;
 * - pais padrao: Brasil.
 */

export function normalizePostalCode(raw: string | undefined | null): string | null {
  if (!raw) return null;
  const digits = raw.replace(/\D/g, "");
  if (digits === "") return null;
  if (digits.length !== 8) {
    throw new AppError("INVALID_ADDRESS", "CEP inválido: informe 8 dígitos.", 400);
  }
  return digits;
}

function cleanText(value: string | undefined | null): string {
  return (value ?? "").replace(/\s+/g, " ").trim();
}

export function normalizeAddressInput(input: AddressInput): NormalizedAddress {
  const street = cleanText(input.street);
  const number = cleanText(input.number);
  const city = cleanText(input.city);
  const state = cleanText(input.state).toUpperCase();

  const missing: string[] = [];
  if (!street) missing.push("rua");
  if (!number) missing.push("número");
  if (!city) missing.push("cidade");
  if (!state) missing.push("UF");
  if (missing.length > 0) {
    throw new AppError(
      "INVALID_ADDRESS",
      `Endereço incompleto: informe ${missing.join(", ")}.`,
      400
    );
  }
  if (!/^[A-Z]{2}$/.test(state)) {
    throw new AppError("INVALID_ADDRESS", "UF inválida: use a sigla com 2 letras.", 400);
  }

  const complement = cleanText(input.complement);
  const neighborhood = cleanText(input.neighborhood);
  const country = cleanText(input.country) || "Brasil";

  return {
    postalCode: normalizePostalCode(input.postalCode),
    street,
    number,
    complement: complement || null,
    neighborhood: neighborhood || null,
    city,
    state,
    country,
  };
}

export function formatAddressFromInput(address: NormalizedAddress): string {
  const parts = [
    `${address.street}, ${address.number}`,
    address.neighborhood,
    `${address.city} - ${address.state}`,
  ].filter(Boolean);
  return parts.join(", ");
}
