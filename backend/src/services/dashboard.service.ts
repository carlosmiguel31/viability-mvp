import { Prisma } from "../generated/prisma/client";
import type { UserRole } from "../generated/prisma/client";
import { prisma } from "../db/prisma";
import { env } from "../config/env";
import { AppError } from "../utils/errors";
import {
  addCalendarDays,
  calendarDateInTimeZone,
  calendarDaysBetween,
  zonedMidnightUtc,
} from "../utils/timezone";

/**
 * Dashboard operacional (v0.5.0): indicadores SOMENTE LEITURA derivados de
 * ViabilityConsultation + projecao relacional dos matches. Todas as
 * agregacoes rodam no PostgreSQL (count/groupBy/aggregate e $queryRaw com
 * template tag parametrizada — NUNCA $queryRawUnsafe ou concatenacao).
 * Escopo aplicado no backend: VIEWER enxerga apenas as proprias consultas.
 */

export type DashboardPreset =
  | "TODAY"
  | "LAST_7_DAYS"
  | "LAST_30_DAYS"
  | "CURRENT_MONTH"
  | "PREVIOUS_MONTH"
  | "CUSTOM";

export interface DashboardFilters {
  preset?: DashboardPreset;
  dateFrom?: string;
  dateTo?: string;
  userId?: string;
  status?: string;
  city?: string;
  state?: string;
  partnerCode?: string;
  layerId?: string;
}

export interface DashboardViewer {
  id: string;
  role: UserRole;
}

export interface ResolvedPeriod {
  dateFrom: string; // AAAA-MM-DD no fuso (inclusivo)
  dateTo: string; // AAAA-MM-DD no fuso (inclusivo)
  timeZone: string;
  fromUtc: Date; // >=
  toUtc: Date; // < (exclusivo)
  days: number;
}

/**
 * Resolve o periodo no fuso CONSULTATION_TIME_ZONE — exatamente a mesma
 * interpretacao do historico: inicio do dia local, fim EXCLUSIVO no dia
 * seguinte local, conversao para UTC somente antes do banco.
 */
export function resolveDashboardPeriod(filters: DashboardFilters): ResolvedPeriod {
  const timeZone = env.CONSULTATION_TIME_ZONE;
  const today = calendarDateInTimeZone(new Date(), timeZone);
  const preset = filters.preset ?? (filters.dateFrom || filters.dateTo ? "CUSTOM" : "LAST_30_DAYS");

  let dateFrom: string;
  let dateTo: string;
  switch (preset) {
    case "TODAY":
      dateFrom = today;
      dateTo = today;
      break;
    case "LAST_7_DAYS":
      dateFrom = addCalendarDays(today, -6);
      dateTo = today;
      break;
    case "LAST_30_DAYS":
      dateFrom = addCalendarDays(today, -29);
      dateTo = today;
      break;
    case "CURRENT_MONTH":
      dateFrom = `${today.slice(0, 7)}-01`;
      dateTo = today;
      break;
    case "PREVIOUS_MONTH": {
      const firstOfCurrent = `${today.slice(0, 7)}-01`;
      dateTo = addCalendarDays(firstOfCurrent, -1); // ultimo dia do mes anterior
      dateFrom = `${dateTo.slice(0, 7)}-01`;
      break;
    }
    case "CUSTOM": {
      if (!filters.dateFrom || !filters.dateTo) {
        throw new AppError(
          "DASHBOARD_INVALID_DATE_RANGE",
          "Período personalizado exige data inicial e final.",
          400
        );
      }
      dateFrom = filters.dateFrom;
      dateTo = filters.dateTo;
      break;
    }
    default:
      throw new AppError("DASHBOARD_INVALID_FILTER", "Período predefinido inválido.", 400);
  }

  let fromUtc: Date;
  let toUtc: Date;
  try {
    fromUtc = zonedMidnightUtc(dateFrom, timeZone);
    toUtc = zonedMidnightUtc(addCalendarDays(dateTo, 1), timeZone);
  } catch {
    throw new AppError("DASHBOARD_INVALID_DATE_RANGE", "Datas do período inválidas.", 400);
  }
  if (fromUtc >= toUtc) {
    throw new AppError(
      "DASHBOARD_INVALID_DATE_RANGE",
      "A data inicial deve ser anterior ou igual à data final.",
      400
    );
  }
  const days = calendarDaysBetween(dateFrom, dateTo) + 1;
  if (days > env.DASHBOARD_MAX_RANGE_DAYS) {
    throw new AppError(
      "DASHBOARD_DATE_RANGE_TOO_LARGE",
      `O período está limitado a ${env.DASHBOARD_MAX_RANGE_DAYS} dias.`,
      400
    );
  }
  return { dateFrom, dateTo, timeZone, fromUtc, toUtc, days };
}

/** Periodo anterior: mesma quantidade de dias, terminando antes do atual. */
export function previousPeriod(period: ResolvedPeriod): ResolvedPeriod {
  const dateTo = addCalendarDays(period.dateFrom, -1);
  const dateFrom = addCalendarDays(dateTo, -(period.days - 1));
  return {
    dateFrom,
    dateTo,
    timeZone: period.timeZone,
    fromUtc: zonedMidnightUtc(dateFrom, period.timeZone),
    toUtc: zonedMidnightUtc(addCalendarDays(dateTo, 1), period.timeZone),
    days: period.days,
  };
}

/**
 * Filtros CENTRALIZADOS (mesma construcao em todos os endpoints).
 * Escopo: VIEWER somente as proprias consultas; userId de filtro so vale
 * para perfis com visao geral.
 */
export function buildDashboardWhere(
  filters: DashboardFilters,
  period: Pick<ResolvedPeriod, "fromUtc" | "toUtc">,
  viewer: DashboardViewer
): Prisma.ViabilityConsultationWhereInput {
  const scopeUserId = viewer.role === "VIEWER" ? viewer.id : filters.userId;
  return {
    AND: [
      { createdAt: { gte: period.fromUtc, lt: period.toUtc } },
      scopeUserId ? { userId: scopeUserId } : {},
      filters.status ? { status: filters.status } : {},
      filters.city ? { city: { contains: filters.city, mode: "insensitive" } } : {},
      filters.state ? { state: filters.state.toUpperCase() } : {},
      filters.partnerCode
        ? {
            coverageMatchProjections: {
              some: { partnerCodeSnapshot: filters.partnerCode.toUpperCase() },
            },
          }
        : {},
      filters.layerId
        ? { coverageMatchProjections: { some: { layerIdSnapshot: filters.layerId } } }
        : {},
    ],
  };
}

/** As mesmas condicoes, como SQL parametrizado (Prisma.sql) p/ percentis etc. */
function buildDashboardSqlConditions(
  filters: DashboardFilters,
  period: Pick<ResolvedPeriod, "fromUtc" | "toUtc">,
  viewer: DashboardViewer
): Prisma.Sql[] {
  const conditions: Prisma.Sql[] = [
    Prisma.sql`c."createdAt" >= ${period.fromUtc}`,
    Prisma.sql`c."createdAt" < ${period.toUtc}`,
  ];
  const scopeUserId = viewer.role === "VIEWER" ? viewer.id : filters.userId;
  if (scopeUserId) conditions.push(Prisma.sql`c."userId" = ${scopeUserId}::uuid`);
  if (filters.status) conditions.push(Prisma.sql`c."status" = ${filters.status}`);
  if (filters.city) conditions.push(Prisma.sql`c."city" ILIKE ${"%" + filters.city + "%"}`);
  if (filters.state) conditions.push(Prisma.sql`c."state" = ${filters.state.toUpperCase()}`);
  if (filters.partnerCode) {
    conditions.push(
      Prisma.sql`EXISTS (SELECT 1 FROM "viability_consultation_coverage_matches" f
        WHERE f."consultationId" = c."id" AND f."partnerCodeSnapshot" = ${filters.partnerCode.toUpperCase()})`
    );
  }
  if (filters.layerId) {
    conditions.push(
      Prisma.sql`EXISTS (SELECT 1 FROM "viability_consultation_coverage_matches" f
        WHERE f."consultationId" = c."id" AND f."layerIdSnapshot" = ${filters.layerId})`
    );
  }
  return conditions;
}

function andJoin(conditions: Prisma.Sql[]): Prisma.Sql {
  return Prisma.join(conditions, " AND ");
}

// ── Summary ───────────────────────────────────────────────────

interface StatusCounts {
  total: number;
  byStatus: Map<string, number>;
}

async function countByStatus(
  where: Prisma.ViabilityConsultationWhereInput
): Promise<StatusCounts> {
  const groups = await prisma.viabilityConsultation.groupBy({
    by: ["status"],
    where,
    _count: { _all: true },
  });
  const byStatus = new Map(groups.map((group) => [group.status, group._count._all]));
  const total = groups.reduce((sum, group) => sum + group._count._all, 0);
  return { total, byStatus };
}

function coverageRateOf(counts: StatusCounts): number {
  const viable = counts.byStatus.get("PRELIMINARILY_VIABLE") ?? 0;
  const outside = counts.byStatus.get("OUTSIDE_COVERAGE") ?? 0;
  const denominator = viable + outside; // conclusao geografica confiavel apenas
  return denominator === 0 ? 0 : viable / denominator;
}

interface DurationStats {
  averageDurationMs: number;
  medianDurationMs: number;
  p95DurationMs: number;
}

async function durationStats(
  filters: DashboardFilters,
  period: Pick<ResolvedPeriod, "fromUtc" | "toUtc">,
  viewer: DashboardViewer
): Promise<DurationStats> {
  const conditions = buildDashboardSqlConditions(filters, period, viewer);
  conditions.push(Prisma.sql`c."durationMs" IS NOT NULL`);
  const rows = await prisma.$queryRaw<
    Array<{ avg: number | null; median: number | null; p95: number | null }>
  >(Prisma.sql`
    SELECT
      AVG(c."durationMs")::float AS avg,
      PERCENTILE_CONT(0.5) WITHIN GROUP (ORDER BY c."durationMs")::float AS median,
      PERCENTILE_CONT(0.95) WITHIN GROUP (ORDER BY c."durationMs")::float AS p95
    FROM "viability_consultations" c
    WHERE ${andJoin(conditions)}
  `);
  const row = rows[0] ?? { avg: null, median: null, p95: null };
  return {
    averageDurationMs: row.avg ?? 0,
    medianDurationMs: row.median ?? 0,
    p95DurationMs: row.p95 ?? 0,
  };
}

export async function dashboardSummary(filters: DashboardFilters, viewer: DashboardViewer) {
  const period = resolveDashboardPeriod(filters);
  const previous = previousPeriod(period);
  const where = buildDashboardWhere(filters, period, viewer);
  const previousWhere = buildDashboardWhere(filters, previous, viewer);

  const [counts, previousCounts, manualCount, networkGroups, confidenceGroups, durations, previousDurations] =
    await Promise.all([
      countByStatus(where),
      countByStatus(previousWhere),
      prisma.viabilityConsultation.count({
        where: { AND: [where, { locationConfirmedManually: true }] },
      }),
      prisma.viabilityConsultation.groupBy({
        by: ["networkReferenceStatus"],
        where,
        _count: { _all: true },
      }),
      prisma.viabilityConsultation.groupBy({
        by: ["geocodingConfidence"],
        where: { AND: [where, { geocodingConfidence: { not: null } }] },
        _count: { _all: true },
      }),
      durationStats(filters, period, viewer),
      durationStats(filters, previous, viewer),
    ]);

  const statusOf = (status: string) => counts.byStatus.get(status) ?? 0;
  const knownStatuses = [
    "PRELIMINARILY_VIABLE",
    "OUTSIDE_COVERAGE",
    "ADDRESS_AMBIGUOUS",
    "COVERAGE_NOT_CONFIGURED",
    "ADDRESS_NOT_FOUND",
    "GEOCODING_UNAVAILABLE",
  ];
  const otherStatuses = [...counts.byStatus.entries()]
    .filter(([status]) => !knownStatuses.includes(status))
    .reduce((sum, [, count]) => sum + count, 0);

  // Referencia de rede: NOT_CHECKED fica FORA do denominador (nao houve
  // tentativa real de busca).
  const networkByStatus = new Map(
    networkGroups.map((group) => [group.networkReferenceStatus, group._count._all])
  );
  const networkAttempts = [...networkByStatus.entries()]
    .filter(([status]) => status !== "NOT_CHECKED")
    .reduce((sum, [, count]) => sum + count, 0);
  const networkFound = networkByStatus.get("FOUND") ?? 0;

  const confidenceTotal = confidenceGroups.reduce((sum, group) => sum + group._count._all, 0);
  const confidenceHigh =
    confidenceGroups.find((group) => group.geocodingConfidence === "HIGH")?._count._all ?? 0;

  const coverageRate = coverageRateOf(counts);
  const previousCoverageRate = coverageRateOf(previousCounts);
  const previousViableOutside =
    (previousCounts.byStatus.get("PRELIMINARILY_VIABLE") ?? 0) +
    (previousCounts.byStatus.get("OUTSIDE_COVERAGE") ?? 0);

  return {
    period: { dateFrom: period.dateFrom, dateTo: period.dateTo, timeZone: period.timeZone },
    totals: {
      consultations: counts.total,
      preliminarilyViable: statusOf("PRELIMINARILY_VIABLE"),
      outsideCoverage: statusOf("OUTSIDE_COVERAGE"),
      addressAmbiguous: statusOf("ADDRESS_AMBIGUOUS"),
      coverageNotConfigured: statusOf("COVERAGE_NOT_CONFIGURED"),
      geocodingFailed: statusOf("ADDRESS_NOT_FOUND") + statusOf("GEOCODING_UNAVAILABLE"),
      otherStatuses,
    },
    rates: {
      coverageRate,
      networkReferenceFoundRate: networkAttempts === 0 ? 0 : networkFound / networkAttempts,
      manualConfirmationRate: counts.total === 0 ? 0 : manualCount / counts.total,
      geocodingHighConfidenceRate: confidenceTotal === 0 ? 0 : confidenceHigh / confidenceTotal,
    },
    performance: durations,
    comparison: {
      previousPeriod: { dateFrom: previous.dateFrom, dateTo: previous.dateTo },
      // Valor anterior zero => null (nunca Infinity/NaN).
      consultationsChangePercent:
        previousCounts.total === 0
          ? null
          : ((counts.total - previousCounts.total) / previousCounts.total) * 100,
      // Cobertura comparada em PONTOS percentuais.
      coverageRateChangePercentagePoints:
        previousViableOutside === 0 ? null : (coverageRate - previousCoverageRate) * 100,
      averageDurationChangePercent:
        previousDurations.averageDurationMs === 0
          ? null
          : ((durations.averageDurationMs - previousDurations.averageDurationMs) /
              previousDurations.averageDurationMs) *
            100,
    },
  };
}

// ── Timeline ──────────────────────────────────────────────────

export type DashboardGranularity = "DAY" | "WEEK" | "MONTH";

function pickGranularity(days: number): DashboardGranularity {
  if (days <= 45) return "DAY";
  if (days <= 180) return "WEEK";
  return "MONTH";
}

/** Rotulo estavel do bucket no FUSO configurado (nunca UTC puro). */
function bucketLabel(date: string, granularity: DashboardGranularity): string {
  return granularity === "MONTH" ? date.slice(0, 7) : date;
}

function bucketStart(date: string, granularity: DashboardGranularity): string {
  if (granularity === "DAY") return date;
  if (granularity === "MONTH") return `${date.slice(0, 7)}-01`;
  // WEEK: segunda-feira ISO da semana da data.
  const value = new Date(`${date}T12:00:00Z`);
  const weekday = (value.getUTCDay() + 6) % 7; // 0 = segunda
  return addCalendarDays(date, -weekday);
}

function nextBucket(date: string, granularity: DashboardGranularity): string {
  if (granularity === "DAY") return addCalendarDays(date, 1);
  if (granularity === "WEEK") return addCalendarDays(date, 7);
  const value = new Date(`${date.slice(0, 7)}-01T12:00:00Z`);
  value.setUTCMonth(value.getUTCMonth() + 1);
  return value.toISOString().slice(0, 10);
}

export async function dashboardTimeline(
  filters: DashboardFilters & { granularity?: DashboardGranularity },
  viewer: DashboardViewer
) {
  const period = resolveDashboardPeriod(filters);
  const granularity = filters.granularity ?? pickGranularity(period.days);
  const conditions = buildDashboardSqlConditions(filters, period, viewer);
  const unit = granularity.toLowerCase(); // valores internos, nao entrada do usuario

  // Agrupamento pelo DIA LOCAL: converte createdAt para o fuso configurado
  // antes do date_trunc (nunca UTC puro). O fuso e parametrizado.
  const rows = await prisma.$queryRaw<
    Array<{ bucket: string; total: bigint; viable: bigint; outside: bigint; ambiguous: bigint }>
  >(Prisma.sql`
    SELECT
      to_char(
        date_trunc(${unit}, (c."createdAt" AT TIME ZONE 'UTC') AT TIME ZONE ${period.timeZone}),
        'YYYY-MM-DD'
      ) AS bucket,
      COUNT(*) AS total,
      COUNT(*) FILTER (WHERE c."status" = 'PRELIMINARILY_VIABLE') AS viable,
      COUNT(*) FILTER (WHERE c."status" = 'OUTSIDE_COVERAGE') AS outside,
      COUNT(*) FILTER (WHERE c."status" = 'ADDRESS_AMBIGUOUS') AS ambiguous
    FROM "viability_consultations" c
    WHERE ${andJoin(conditions)}
    GROUP BY 1
    ORDER BY 1
  `);
  const byBucket = new Map(
    rows.map((row) => [
      bucketLabel(row.bucket, granularity),
      {
        total: Number(row.total),
        preliminarilyViable: Number(row.viable),
        outsideCoverage: Number(row.outside),
        addressAmbiguous: Number(row.ambiguous),
      },
    ])
  );

  // Preenche buracos com zero, em ordem cronologica.
  const points: Array<{
    period: string;
    total: number;
    preliminarilyViable: number;
    outsideCoverage: number;
    addressAmbiguous: number;
  }> = [];
  let cursor = bucketStart(period.dateFrom, granularity);
  const endExclusive = addCalendarDays(period.dateTo, 1);
  while (cursor < endExclusive) {
    const label = bucketLabel(cursor, granularity);
    points.push({
      period: label,
      total: 0,
      preliminarilyViable: 0,
      outsideCoverage: 0,
      addressAmbiguous: 0,
      ...byBucket.get(label),
    });
    cursor = nextBucket(cursor, granularity);
  }
  return { granularity, points };
}

// ── Breakdowns ────────────────────────────────────────────────

function withPercentages<T extends { count: number }>(items: T[]): Array<T & { percentage: number }> {
  const total = items.reduce((sum, item) => sum + item.count, 0);
  return items
    .sort((a, b) => b.count - a.count)
    .map((item) => ({
      ...item,
      percentage: total === 0 ? 0 : (item.count / total) * 100,
    }));
}

export async function dashboardBreakdowns(filters: DashboardFilters, viewer: DashboardViewer) {
  const period = resolveDashboardPeriod(filters);
  const where = buildDashboardWhere(filters, period, viewer);

  const [byStatus, byNetwork, byConfidence, byLocationType] = await Promise.all([
    prisma.viabilityConsultation.groupBy({ by: ["status"], where, _count: { _all: true } }),
    prisma.viabilityConsultation.groupBy({
      by: ["networkReferenceStatus"],
      where,
      _count: { _all: true },
    }),
    prisma.viabilityConsultation.groupBy({
      by: ["geocodingConfidence"],
      where: { AND: [where, { geocodingConfidence: { not: null } }] },
      _count: { _all: true },
    }),
    prisma.viabilityConsultation.groupBy({
      by: ["geocodingLocationType"],
      where: { AND: [where, { geocodingLocationType: { not: null } }] },
      _count: { _all: true },
    }),
  ]);

  return {
    byStatus: withPercentages(
      byStatus.map((group) => ({ status: group.status, count: group._count._all }))
    ),
    byNetworkReferenceStatus: withPercentages(
      byNetwork.map((group) => ({
        status: group.networkReferenceStatus,
        count: group._count._all,
      }))
    ),
    byGeocodingConfidence: withPercentages(
      byConfidence.map((group) => ({
        confidence: group.geocodingConfidence!,
        count: group._count._all,
      }))
    ),
    byGeocodingLocationType: withPercentages(
      byLocationType.map((group) => ({
        locationType: group.geocodingLocationType!,
        count: group._count._all,
      }))
    ),
  };
}

// ── Rankings ──────────────────────────────────────────────────

export async function dashboardRankings(
  filters: DashboardFilters & { limit?: number },
  viewer: DashboardViewer
) {
  const period = resolveDashboardPeriod(filters);
  const limit = Math.min(Math.max(filters.limit ?? 10, 1), 25);
  const conditions = buildDashboardSqlConditions(filters, period, viewer);
  const where = buildDashboardWhere(filters, period, viewer);

  // Nos rankings de PARCEIROS e CAMADAS, partnerCode/layerId restringem
  // tambem as LINHAS de match (m) — nao apenas a selecao das consultas (c).
  // Sem isso, uma consulta com matches sobrepostos (Parceiro A + Parceiro B)
  // filtrada por A ainda contaria B no ranking.
  const matchConditions = [...conditions];
  if (filters.partnerCode) {
    matchConditions.push(
      Prisma.sql`m."partnerCodeSnapshot" = ${filters.partnerCode.toUpperCase()}`
    );
  }
  if (filters.layerId) {
    matchConditions.push(Prisma.sql`m."layerIdSnapshot" = ${filters.layerId}`);
  }

  const [partners, layers, cities] = await Promise.all([
    prisma.$queryRaw<
      Array<{
        partnerCode: string | null;
        partnerName: string;
        matchCount: bigint;
        consultationCount: bigint;
      }>
    >(Prisma.sql`
      SELECT
        m."partnerCodeSnapshot" AS "partnerCode",
        m."partnerNameSnapshot" AS "partnerName",
        COUNT(*) AS "matchCount",
        COUNT(DISTINCT m."consultationId") AS "consultationCount"
      FROM "viability_consultation_coverage_matches" m
      JOIN "viability_consultations" c ON c."id" = m."consultationId"
      WHERE ${andJoin(matchConditions)}
      GROUP BY 1, 2
      ORDER BY "matchCount" DESC, "partnerName" ASC
      LIMIT ${limit}
    `),
    prisma.$queryRaw<
      Array<{
        layerId: string | null;
        layerName: string;
        partnerName: string;
        version: string | null;
        matchCount: bigint;
        consultationCount: bigint;
      }>
    >(Prisma.sql`
      SELECT
        m."layerIdSnapshot" AS "layerId",
        m."layerNameSnapshot" AS "layerName",
        m."partnerNameSnapshot" AS "partnerName",
        m."versionSnapshot" AS "version",
        COUNT(*) AS "matchCount",
        COUNT(DISTINCT m."consultationId") AS "consultationCount"
      FROM "viability_consultation_coverage_matches" m
      JOIN "viability_consultations" c ON c."id" = m."consultationId"
      WHERE ${andJoin(matchConditions)}
      GROUP BY 1, 2, 3, 4
      ORDER BY "matchCount" DESC, "layerName" ASC
      LIMIT ${limit}
    `),
    prisma.$queryRaw<
      Array<{
        city: string;
        state: string;
        consultationCount: bigint;
        preliminarilyViableCount: bigint;
        outsideCount: bigint;
      }>
    >(Prisma.sql`
      SELECT
        c."city" AS city,
        c."state" AS state,
        COUNT(*) AS "consultationCount",
        COUNT(*) FILTER (WHERE c."status" = 'PRELIMINARILY_VIABLE') AS "preliminarilyViableCount",
        COUNT(*) FILTER (WHERE c."status" = 'OUTSIDE_COVERAGE') AS "outsideCount"
      FROM "viability_consultations" c
      WHERE ${andJoin(conditions)}
      GROUP BY 1, 2
      ORDER BY "consultationCount" DESC, city ASC
      LIMIT ${limit}
    `),
  ]);

  // Ranking de usuarios: NUNCA para VIEWER (nenhum dado de outros usuarios).
  let users: Array<{ userId: string; name: string; email: string; consultationCount: number }> =
    [];
  if (viewer.role !== "VIEWER") {
    const groups = await prisma.viabilityConsultation.groupBy({
      by: ["userId"],
      where: { AND: [where, { userId: { not: null } }] },
      _count: { _all: true },
      orderBy: { _count: { userId: "desc" } },
      take: limit,
    });
    const userRows = await prisma.user.findMany({
      where: { id: { in: groups.map((group) => group.userId!).filter(Boolean) } },
      select: { id: true, name: true, email: true },
    });
    const usersById = new Map(userRows.map((user) => [user.id, user]));
    users = groups
      .filter((group) => group.userId)
      .map((group) => ({
        userId: group.userId!,
        name: usersById.get(group.userId!)?.name ?? "—",
        email: usersById.get(group.userId!)?.email ?? "—",
        consultationCount: group._count._all,
      }));
  }

  return {
    partners: partners.map((row) => ({
      partnerCode: row.partnerCode,
      partnerName: row.partnerName,
      matchCount: Number(row.matchCount),
      consultationCount: Number(row.consultationCount),
    })),
    layers: layers.map((row) => ({
      layerId: row.layerId,
      layerName: row.layerName,
      partnerName: row.partnerName,
      version: row.version,
      matchCount: Number(row.matchCount),
      consultationCount: Number(row.consultationCount),
    })),
    users,
    cities: cities.map((row) => {
      const viable = Number(row.preliminarilyViableCount);
      const outside = Number(row.outsideCount);
      const denominator = viable + outside;
      return {
        city: row.city,
        state: row.state,
        consultationCount: Number(row.consultationCount),
        preliminarilyViableCount: viable,
        coverageRate: denominator === 0 ? 0 : viable / denominator,
      };
    }),
  };
}

// ── Consultas recentes ────────────────────────────────────────

export async function dashboardRecentConsultations(
  filters: DashboardFilters & { limit?: number },
  viewer: DashboardViewer
) {
  const period = resolveDashboardPeriod(filters);
  const limit = Math.min(Math.max(filters.limit ?? 10, 1), 20);
  const where = buildDashboardWhere(filters, period, viewer);
  const rows = await prisma.viabilityConsultation.findMany({
    where,
    select: {
      id: true,
      protocol: true,
      status: true,
      street: true,
      number: true,
      neighborhood: true,
      city: true,
      state: true,
      coverageMatchCount: true,
      networkReferenceStatus: true,
      createdAt: true,
      durationMs: true,
      user: { select: { id: true, name: true } },
    },
    orderBy: { createdAt: "desc" },
    take: limit,
  });
  return {
    consultations: rows.map((row) => ({
      id: row.id,
      protocol: row.protocol,
      status: row.status,
      address: {
        street: row.street,
        number: row.number,
        neighborhood: row.neighborhood,
        city: row.city,
        state: row.state,
      },
      user: row.user,
      coverageMatchCount: row.coverageMatchCount,
      networkReferenceStatus: row.networkReferenceStatus,
      createdAt: row.createdAt,
      durationMs: row.durationMs,
    })),
  };
}

// ── Opções de usuários p/ o filtro do dashboard ───────────────

/**
 * Lista MINIMA de usuarios ATIVOS para o filtro do dashboard, disponivel a
 * ADMIN, OPERATOR e TECHNICIAN (o /api/users administrativo segue exclusivo
 * de ADMIN). Nunca expoe hash, sessoes, familyId ou dados internos.
 */
export async function dashboardUserOptions(params: {
  search?: string;
  page?: number;
  limit?: number;
}) {
  const limit = Math.min(Math.max(params.limit ?? 50, 1), 100);
  const page = Math.max(params.page ?? 1, 1);
  const where = {
    active: true,
    ...(params.search
      ? {
          OR: [
            { name: { contains: params.search, mode: "insensitive" as const } },
            { email: { contains: params.search, mode: "insensitive" as const } },
          ],
        }
      : {}),
  };
  const [users, total] = await Promise.all([
    prisma.user.findMany({
      where,
      select: { id: true, name: true, email: true },
      orderBy: { name: "asc" },
      skip: (page - 1) * limit,
      take: limit,
    }),
    prisma.user.count({ where }),
  ]);
  return { users, total, page, limit };
}
