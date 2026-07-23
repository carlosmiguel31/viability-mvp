import { NextFunction, Request, Response } from "express";
import { ZodError } from "zod";
import {
  viabilityCheckAddressSchema,
  viabilityCheckCoordinatesSchema,
} from "../schemas/viability.schema";
import { normalizeAddressInput } from "../services/address.service";
import { checkViabilityByAddress } from "../services/address-viability.service";
import { checkViability } from "../services/viability.service";
import { AppError } from "../utils/errors";

function validationError(err: ZodError): AppError {
  const message = err.errors[0]?.message ?? "Dados inválidos.";
  return new AppError("VALIDATION_ERROR", message, 400);
}

/** Fluxo principal do operador: consulta por endereco. */
export async function checkViabilityByAddressHandler(
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> {
  try {
    const parsed = viabilityCheckAddressSchema.safeParse(req.body);
    if (!parsed.success) {
      next(validationError(parsed.error));
      return;
    }
    const address = normalizeAddressInput(parsed.data.address);
    const result = await checkViabilityByAddress({
      address,
      adjustedLocation: parsed.data.adjustedLocation,
    });
    res.status(200).json(result);
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
