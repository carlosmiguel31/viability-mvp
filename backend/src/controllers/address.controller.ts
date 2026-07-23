import { NextFunction, Request, Response } from "express";
import { postalCodeProvider } from "../services/postal-code/postal-code.provider";
import { AppError } from "../utils/errors";

/**
 * Consulta de CEP para preenchimento automatico do formulario.
 * Desacoplada da logica de viabilidade. CEP inexistente → 404 amigavel;
 * o frontend nunca bloqueia a digitacao manual.
 */
export async function postalCodeLookupHandler(
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> {
  try {
    const digits = String(req.params.cep ?? "").replace(/\D/g, "");
    if (digits.length !== 8) {
      next(new AppError("INVALID_POSTAL_CODE", "CEP inválido: informe 8 dígitos.", 400));
      return;
    }
    const address = await postalCodeProvider.findAddressByPostalCode(digits);
    if (!address) {
      next(new AppError("POSTAL_CODE_NOT_FOUND", "CEP não encontrado.", 404));
      return;
    }
    res.status(200).json(address);
  } catch (err) {
    next(err);
  }
}
