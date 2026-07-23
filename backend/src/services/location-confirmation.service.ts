import { createHash } from "crypto";
import jwt from "jsonwebtoken";
import { env } from "../config/env";
import { AppError } from "../utils/errors";
import { NormalizedAddress, GeocodingLocationType } from "../types/address.types";

/**
 * Token OPACO de confirmacao de localizacao (v0.4.0 revisao):
 * preserva o snapshot ORIGINAL da geocodificacao entre a consulta inicial e a
 * confirmacao/ajuste do marcador, sem confiar em campos soltos enviados pelo
 * frontend. Assinado com segredo proprio (LOCATION_CONFIRMATION_SECRET —
 * nunca o refresh token), curta duracao, vinculado ao usuario autenticado e
 * ao hash do endereco normalizado. O token NUNCA e gravado em banco,
 * auditoria, historico, logs ou mensagens de erro.
 */

const TOKEN_TTL_SECONDS = 10 * 60; // 10 minutos
const TOKEN_PURPOSE = "location-confirmation";

export interface OriginalGeocodingSnapshot {
  provider: string;
  formattedAddress: string;
  confidence: "HIGH" | "MEDIUM" | "LOW";
  partialMatch: boolean;
  locationType: GeocodingLocationType;
  latitude: number;
  longitude: number;
}

interface TokenPayload extends OriginalGeocodingSnapshot {
  purpose: typeof TOKEN_PURPOSE;
  sub: string; // usuario autenticado
  addressHash: string; // hash do endereco normalizado
}

/** Hash estavel do endereco normalizado (ordem de campos fixa). */
export function hashNormalizedAddress(address: NormalizedAddress): string {
  const canonical = JSON.stringify([
    address.postalCode ?? null,
    address.street,
    address.number,
    address.complement ?? null,
    address.neighborhood ?? null,
    address.city,
    address.state,
    address.country ?? null,
  ]);
  return createHash("sha256").update(canonical).digest("hex");
}

export function issueLocationConfirmationToken(input: {
  userId: string;
  address: NormalizedAddress;
  geocoding: OriginalGeocodingSnapshot;
}): string {
  const payload: TokenPayload = {
    purpose: TOKEN_PURPOSE,
    sub: input.userId,
    addressHash: hashNormalizedAddress(input.address),
    ...input.geocoding,
  };
  return jwt.sign(payload, env.LOCATION_CONFIRMATION_SECRET, {
    expiresIn: TOKEN_TTL_SECONDS,
  });
}

function invalidToken(): AppError {
  // Mensagem generica: nao ecoa o token nem detalha o motivo exato.
  return new AppError(
    "LOCATION_CONFIRMATION_INVALID",
    "A confirmação da localização expirou ou é inválida. Refaça a consulta do endereço.",
    400
  );
}

/**
 * Valida assinatura, expiracao, usuario e vinculo com o endereco enviado.
 * Retorna o snapshot ORIGINAL da geocodificacao para o registro historico.
 */
export function verifyLocationConfirmationToken(input: {
  token: string | undefined;
  userId: string;
  address: NormalizedAddress;
}): OriginalGeocodingSnapshot {
  if (!input.token) throw invalidToken();
  let payload: TokenPayload;
  try {
    payload = jwt.verify(input.token, env.LOCATION_CONFIRMATION_SECRET) as TokenPayload;
  } catch {
    throw invalidToken();
  }
  if (
    payload.purpose !== TOKEN_PURPOSE ||
    payload.sub !== input.userId ||
    payload.addressHash !== hashNormalizedAddress(input.address)
  ) {
    throw invalidToken();
  }
  return {
    provider: payload.provider,
    formattedAddress: payload.formattedAddress,
    confidence: payload.confidence,
    partialMatch: payload.partialMatch,
    locationType: payload.locationType,
    latitude: payload.latitude,
    longitude: payload.longitude,
  };
}
