import { NextFunction, Request, Response } from "express";
import { ZodSchema } from "zod";
import {
  dashboardBreakdowns,
  dashboardRankings,
  dashboardRecentConsultations,
  dashboardSummary,
  dashboardTimeline,
  dashboardUserOptions,
  DashboardViewer,
} from "../services/dashboard.service";
import { logger } from "../utils/logger";
import {
  dashboardFiltersSchema,
  dashboardLimitSchema,
  dashboardTimelineSchema,
  dashboardUsersSchema,
} from "../schemas/dashboard.schema";
import { recordAudit } from "../services/audit.service";
import { AppError } from "../utils/errors";
import type { UserRole } from "../generated/prisma/client";

function viewer(req: Request): DashboardViewer {
  return { id: req.user!.id, role: req.user!.role as UserRole };
}

/**
 * Falhas INESPERADAS (banco/agregacao) viram DASHBOARD_QUERY_FAILED 500 com
 * mensagem neutra — nunca SQL, stack trace ou mensagem interna do PostgreSQL.
 * AppError de validacao (DASHBOARD_INVALID_DATE_RANGE etc.) passa intacto.
 */
function toDashboardError(err: unknown, endpoint: string): unknown {
  if (err instanceof AppError) return err;
  logger.error("Falha inesperada em consulta do dashboard", { endpoint });
  return new AppError(
    "DASHBOARD_QUERY_FAILED",
    "Não foi possível carregar os indicadores do dashboard.",
    500
  );
}

function parse<T>(schema: ZodSchema<T>, req: Request): T {
  const parsed = schema.safeParse(req.query);
  if (!parsed.success) {
    throw new AppError(
      "DASHBOARD_INVALID_FILTER",
      parsed.error.errors[0]?.message ?? "Filtros inválidos.",
      400
    );
  }
  return parsed.data;
}

/**
 * O summary e a "visualizacao logica" do dashboard, mas o DASHBOARD_VIEWED so
 * e registrado quando o frontend envia recordView=true: primeira abertura e
 * cada clique em Aplicar. Duplicacoes do React.StrictMode, retries, "Tentar
 * novamente" e os demais endpoints usam recordView=false (padrao) e nao geram
 * evento.
 */
export async function dashboardSummaryHandler(
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> {
  try {
    const filters = parse(dashboardFiltersSchema, req);
    const recordView = req.query.recordView === "true";
    const summary = await dashboardSummary(filters, viewer(req)).catch((err) => {
      throw toDashboardError(err, "summary");
    });
    if (!recordView) {
      res.status(200).json(summary);
      return;
    }
    await recordAudit({
      userId: req.user!.id,
      action: "DASHBOARD_VIEWED",
      entity: "dashboard",
      metadata: {
        preset: filters.preset ?? "LAST_30_DAYS",
        dateFrom: summary.period.dateFrom,
        dateTo: summary.period.dateTo,
        status: filters.status ?? null,
        city: filters.city ?? null,
        state: filters.state ?? null,
        partnerCode: filters.partnerCode ?? null,
        userIdFilter: viewer(req).role === "VIEWER" ? null : (filters.userId ?? null),
        scope: viewer(req).role === "VIEWER" ? "SELF" : "ALL",
      },
      ipAddress: req.ip ?? null,
    });
    res.status(200).json(summary);
  } catch (err) {
    next(err);
  }
}

export async function dashboardTimelineHandler(
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> {
  try {
    res.status(200).json(
      await dashboardTimeline(parse(dashboardTimelineSchema, req), viewer(req)).catch((err) => {
        throw toDashboardError(err, "timeline");
      })
    );
  } catch (err) {
    next(err);
  }
}

export async function dashboardBreakdownsHandler(
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> {
  try {
    res.status(200).json(
      await dashboardBreakdowns(parse(dashboardFiltersSchema, req), viewer(req)).catch((err) => {
        throw toDashboardError(err, "breakdowns");
      })
    );
  } catch (err) {
    next(err);
  }
}

export async function dashboardRankingsHandler(
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> {
  try {
    res.status(200).json(
      await dashboardRankings(parse(dashboardLimitSchema, req), viewer(req)).catch((err) => {
        throw toDashboardError(err, "rankings");
      })
    );
  } catch (err) {
    next(err);
  }
}

export async function dashboardRecentConsultationsHandler(
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> {
  try {
    res.status(200).json(
      await dashboardRecentConsultations(parse(dashboardLimitSchema, req), viewer(req)).catch(
        (err) => {
          throw toDashboardError(err, "recent-consultations");
        }
      )
    );
  } catch (err) {
    next(err);
  }
}

export async function dashboardUsersHandler(
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> {
  try {
    const parsed = dashboardUsersSchema.safeParse(req.query);
    if (!parsed.success) {
      throw new AppError(
        "DASHBOARD_INVALID_FILTER",
        parsed.error.errors[0]?.message ?? "Filtros inválidos.",
        400
      );
    }
    res.status(200).json(
      await dashboardUserOptions(parsed.data).catch((err) => {
        throw toDashboardError(err, "users");
      })
    );
  } catch (err) {
    next(err);
  }
}
