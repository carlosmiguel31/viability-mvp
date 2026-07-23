import { NextFunction, Request, Response } from "express";
import { ZodError } from "zod";
import {
  viabilityCheckAddressSchema,
  viabilityCheckCoordinatesSchema,
} from "../schemas/viability.schema";
import { normalizeAddressInput } from "../services/address.service";
import { checkViabilityByAddress } from "../services/address-viability.service";
import { checkViability } from "../services/viability.service";
import { persistConsultation } from "../services/consultation.service";
import {
  issueLocationConfirmationToken,
  verifyLocationConfirmationToken,
  OriginalGeocodingSnapshot,
} from "../services/location-confirmation.service";
import { AppError } from "../utils/errors";
import { env } from "../config/env";

function validationError(err: ZodError): AppError {
  const message = err.errors[0]?.message ?? "Dados inválidos.";
  return new AppError("VALIDATION_ERROR", message, 400);
}

/**
 * Fluxo principal do operador: consulta por endereco.
 * v0.4.0: toda analise finalizada e persistida no historico IMUTAVEL com um
 * protocolo unico ANTES da resposta ser enviada — a resposta e o registro
 * representam o MESMO resultado. Se a gravacao falhar, a API responde
 * CONSULTATION_HISTORY_SAVE_FAILED (nunca sucesso sem protocolo) e nenhuma
 * repeticao automatica cria um segundo registro.
 */
export async function checkViabilityByAddressHandler(
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> {
  try {
    const startedAt = Date.now();
    const parsed = viabilityCheckAddressSchema.safeParse(req.body);
    if (!parsed.success) {
      next(validationError(parsed.error));
      return;
    }
    const address = normalizeAddressInput(parsed.data.address);

    // Confirmacao/ajuste do marcador: o snapshot ORIGINAL da geocodificacao
    // vem exclusivamente do token assinado (nunca de campos soltos do
    // frontend), validado ANTES da analise: assinatura, expiracao, usuario e
    // vinculo com o endereco enviado.
    let originalGeocoding: OriginalGeocodingSnapshot | null = null;
    if (parsed.data.adjustedLocation) {
      originalGeocoding = verifyLocationConfirmationToken({
        token: parsed.data.locationConfirmationToken,
        userId: req.user!.id,
        address,
      });
    }

    const result = await checkViabilityByAddress({
      address,
      adjustedLocation: parsed.data.adjustedLocation,
    });

    const consultation = await persistConsultation({
      result,
      userId: req.user!.id,
      source: parsed.data.adjustedLocation ? "LOCATION_CONFIRMED" : "ADDRESS_CHECK",
      startedAt,
      requestId: req.header("x-request-id") ?? null,
      ipAddress: req.ip ?? null,
      originalGeocoding,
    });

    // Sempre que ESTA requisicao geocodificou (inclusive sem ambiguidade,
    // para ajuste voluntario do marcador), devolve um token de confirmacao.
    const locationConfirmationToken = result.geocoding
      ? issueLocationConfirmationToken({
          userId: req.user!.id,
          address,
          geocoding: {
            provider: env.GEOCODING_PROVIDER,
            formattedAddress: result.geocoding.formattedAddress,
            confidence: result.geocoding.confidence,
            partialMatch: result.geocoding.partialMatch,
            locationType: result.geocoding.locationType,
            latitude: result.searchedAddress.latitude!,
            longitude: result.searchedAddress.longitude!,
          },
        })
      : undefined;

    res.status(200).json({
      ...result,
      ...(locationConfirmationToken ? { locationConfirmationToken } : {}),
      consultation: {
        id: consultation.id,
        protocol: consultation.protocol,
        createdAt: consultation.createdAt,
      },
    });
  } catch (err) {
    next(err);
  }
}

/** Ferramenta de desenvolvimento/administrativa: consulta direta por coordenadas. */
export async function checkViabilityByCoordinatesHandler(
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> {
  try {
    const parsed = viabilityCheckCoordinatesSchema.safeParse(req.body);
    if (!parsed.success) {
      next(validationError(parsed.error));
      return;
    }
    const result = await checkViability(parsed.data);
    res.status(200).json(result);
  } catch (err) {
    next(err);
  }
}
