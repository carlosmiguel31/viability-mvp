import { NextFunction, Request, Response } from "express";
import { listConsultationsQuerySchema } from "../schemas/consultation.schema";
import {
  exportConsultationsCsv,
  getConsultation,
  listConsultations,
} from "../services/consultation.service";
import { recordAudit } from "../services/audit.service";
import { AppError } from "../utils/errors";
import type { UserRole } from "../generated/prisma/client";

function viewer(req: Request): { id: string; role: UserRole } {
  return { id: req.user!.id, role: req.user!.role as UserRole };
}

function parseQuery(req: Request) {
  const parsed = listConsultationsQuerySchema.safeParse(req.query);
  if (!parsed.success) {
    throw new AppError(
      "CONSULTATION_INVALID_FILTER",
      parsed.error.errors[0]?.message ?? "Filtros inválidos.",
      400
    );
  }
  return parsed.data;
}

export async function listConsultationsHandler(
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> {
  try {
    res.status(200).json(await listConsultations(parseQuery(req), viewer(req)));
  } catch (err) {
    next(err);
  }
}

export async function getConsultationHandler(
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> {
  try {
    res
      .status(200)
      .json({ consultation: await getConsultation({ id: String(req.params.id) }, viewer(req)) });
  } catch (err) {
    next(err);
  }
}

export async function getConsultationByProtocolHandler(
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> {
  try {
    res.status(200).json({
      consultation: await getConsultation(
        { protocol: String(req.params.protocol) },
        viewer(req)
      ),
    });
  } catch (err) {
    next(err);
  }
}

/** Exportação CSV — somente ADMIN (garantido na rota). */
export async function exportConsultationsHandler(
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> {
  try {
    const query = parseQuery(req);
    const { csv, rowCount } = await exportConsultationsCsv(query, viewer(req));
    await recordAudit({
      userId: req.user!.id,
      action: "VIABILITY_CONSULTATION_EXPORT_REQUESTED",
      entity: "viability_consultation",
      metadata: {
        rowCount,
        filters: {
          status: query.status ?? null,
          city: query.city ?? null,
          state: query.state ?? null,
          dateFrom: query.dateFrom ?? null,
          dateTo: query.dateTo ?? null,
          hasCoverage: query.hasCoverage ?? null,
        },
      },
      ipAddress: req.ip ?? null,
    });
    const today = new Date().toISOString().slice(0, 10);
    res
      .status(200)
      .setHeader("Content-Type", "text/csv; charset=utf-8")
      .setHeader(
        "Content-Disposition",
        `attachment; filename="consultas-viabilidade-${today}.csv"`
      )
      .send(csv);
  } catch (err) {
    next(err);
  }
}
