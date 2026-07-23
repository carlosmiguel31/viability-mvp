import { NextFunction, Request, Response } from "express";
import { ZodError } from "zod";
import {
  createLayerFieldsSchema,
  createPartnerSchema,
  listLayersQuerySchema,
  listPartnersQuerySchema,
  statusSchema,
  updateLayerSchema,
  updatePartnerSchema,
} from "../schemas/coverage.schema";
import * as partnerService from "../services/coverage-partner.service";
import * as layerService from "../services/coverage-layer.service";
import { AppError } from "../utils/errors";

function validationError(err: ZodError): AppError {
  return new AppError("VALIDATION_ERROR", err.errors[0]?.message ?? "Dados inválidos.", 400);
}

function actor(req: Request): { id: string } {
  return { id: req.user!.id };
}

function ip(req: Request): string | null {
  return req.ip ?? null;
}

function isAdmin(req: Request): boolean {
  return req.user?.role === "ADMIN";
}

// ── Parceiros ─────────────────────────────────────────────────
export async function createPartnerHandler(req: Request, res: Response, next: NextFunction) {
  try {
    const parsed = createPartnerSchema.safeParse(req.body);
    if (!parsed.success) return next(validationError(parsed.error));
    res.status(201).json({ partner: await partnerService.createPartner(parsed.data, actor(req), ip(req)) });
  } catch (err) {
    next(err);
  }
}

export async function listPartnersHandler(req: Request, res: Response, next: NextFunction) {
  try {
    const parsed = listPartnersQuerySchema.safeParse(req.query);
    if (!parsed.success) return next(validationError(parsed.error));
    // Leitura basica para perfis nao administrativos: somente ativos.
    const filters = isAdmin(req) ? parsed.data : { ...parsed.data, active: true };
    const result = await partnerService.listPartners(filters);
    res.status(200).json(result);
  } catch (err) {
    next(err);
  }
}

export async function getPartnerHandler(req: Request, res: Response, next: NextFunction) {
  try {
    res.status(200).json({ partner: await partnerService.getPartner(String(req.params.id)) });
  } catch (err) {
    next(err);
  }
}

export async function updatePartnerHandler(req: Request, res: Response, next: NextFunction) {
  try {
    const parsed = updatePartnerSchema.safeParse(req.body);
    if (!parsed.success) return next(validationError(parsed.error));
    res
      .status(200)
      .json({ partner: await partnerService.updatePartner(String(req.params.id), parsed.data, actor(req), ip(req)) });
  } catch (err) {
    next(err);
  }
}

export async function setPartnerStatusHandler(req: Request, res: Response, next: NextFunction) {
  try {
    const parsed = statusSchema.safeParse(req.body);
    if (!parsed.success) return next(validationError(parsed.error));
    res
      .status(200)
      .json({
        partner: await partnerService.setPartnerStatus(
          String(req.params.id),
          parsed.data.active,
          actor(req),
          ip(req)
        ),
      });
  } catch (err) {
    next(err);
  }
}

// ── Camadas ───────────────────────────────────────────────────
export async function createLayerHandler(req: Request, res: Response, next: NextFunction) {
  try {
    const parsed = createLayerFieldsSchema.safeParse(req.body);
    if (!parsed.success) return next(validationError(parsed.error));
    const file = req.file;
    if (!file || !file.buffer) {
      return next(new AppError("COVERAGE_FILE_INVALID", "Envie o arquivo no campo 'file'.", 400));
    }
    const layer = await layerService.createLayer(
      {
        partnerId: parsed.data.partnerId,
        name: parsed.data.name,
        description: parsed.data.description,
        version: parsed.data.version,
        active: parsed.data.active,
        fileBuffer: file.buffer,
        originalFileName: file.originalname,
      },
      actor(req),
      ip(req)
    );
    res.status(201).json({ layer });
  } catch (err) {
    next(err);
  }
}

export async function listLayersHandler(req: Request, res: Response, next: NextFunction) {
  try {
    const parsed = listLayersQuerySchema.safeParse(req.query);
    if (!parsed.success) return next(validationError(parsed.error));
    if (isAdmin(req)) {
      const result = await layerService.listLayers(parsed.data);
      res.status(200).json({
        layers: result.layers.map(layerService.toPublicLayer),
        total: result.total,
        page: result.page,
        limit: result.limit,
      });
      return;
    }
    // Perfis nao administrativos: lista BASICA das camadas ativas e prontas.
    const result = await layerService.listLayers({
      ...parsed.data,
      active: true,
      processingStatus: "READY",
    });
    res.status(200).json({
      layers: result.layers.map(layerService.toBasicLayer),
      total: result.total,
      page: result.page,
      limit: result.limit,
    });
  } catch (err) {
    next(err);
  }
}

export async function getLayerHandler(req: Request, res: Response, next: NextFunction) {
  try {
    res.status(200).json({ layer: await layerService.getLayer(String(req.params.id)) });
  } catch (err) {
    next(err);
  }
}

export async function updateLayerHandler(req: Request, res: Response, next: NextFunction) {
  try {
    const parsed = updateLayerSchema.safeParse(req.body);
    if (!parsed.success) return next(validationError(parsed.error));
    res
      .status(200)
      .json({ layer: await layerService.updateLayer(String(req.params.id), parsed.data, actor(req), ip(req)) });
  } catch (err) {
    next(err);
  }
}

export async function setLayerStatusHandler(req: Request, res: Response, next: NextFunction) {
  try {
    const parsed = statusSchema.safeParse(req.body);
    if (!parsed.success) return next(validationError(parsed.error));
    res
      .status(200)
      .json({
        layer: await layerService.setLayerStatus(
          String(req.params.id),
          parsed.data.active,
          actor(req),
          ip(req)
        ),
      });
  } catch (err) {
    next(err);
  }
}

export async function deleteLayerHandler(req: Request, res: Response, next: NextFunction) {
  try {
    await layerService.deleteLayer(String(req.params.id), actor(req), ip(req));
    res.status(204).send();
  } catch (err) {
    next(err);
  }
}
