import { afterAll, beforeAll, describe, expect, it } from "vitest";
import request from "supertest";
import { createApp } from "../src/app";
import { prisma, disconnectAppDatabase } from "../src/db/prisma";
import { env } from "../src/config/env";
import {
  buildDashboardWhere,
  previousPeriod,
  resolveDashboardPeriod,
} from "../src/services/dashboard.service";
import { addCalendarDays, calendarDateInTimeZone, zonedMidnightUtc } from "../src/utils/timezone";
import { createTestUser, loginAs, resetAppDatabase } from "./helpers";

const app = createApp();
const TZ = "America/Sao_Paulo";

let adminToken = "";
let operatorToken = "";
let technicianToken = "";
let viewerToken = "";
let viewerId = "";
let operatorId = "";

let seq = 0;

interface SeedOptions {
  createdAt: Date;
  status?: string;
  userId?: string | null;
  city?: string;
  state?: string;
  durationMs?: number | null;
  manual?: boolean;
  network?: string;
  confidence?: string | null;
  locationType?: string | null;
  matches?: Array<{ partnerCode: string; partnerName: string; layerId: string; layerName: string; version?: string | null }>;
}

async function seedConsultation(options: SeedOptions): Promise<string> {
  seq += 1;
  // Sufixo único e válido no alfabeto do protocolo (sem 0/1):
  const digits = String(seq).replace(/0/g, "A").replace(/1/g, "B");
  const suffix = `Q${digits}`.padEnd(8, "Z").slice(0, 8);
  const created = await prisma.viabilityConsultation.create({
    data: {
      protocol: `VIA-20260723-${suffix}`,
      userId: options.userId === undefined ? operatorId : options.userId,
      status: options.status ?? "PRELIMINARILY_VIABLE",
      resultMessage: "seed",
      createdAt: options.createdAt,
      street: "Rua Painel",
      number: "10",
      city: options.city ?? "Belo Horizonte",
      state: options.state ?? "MG",
      geocodingProvider: "dev",
      geocodingConfidence: options.confidence === undefined ? "HIGH" : options.confidence,
      geocodingLocationType: options.locationType === undefined ? "ROOFTOP" : options.locationType,
      locationConfirmedManually: options.manual ?? false,
      coverageMatches: (options.matches ?? []) as never,
      coverageMatchCount: (options.matches ?? []).length,
      coverageConfigured: true,
      networkReferenceStatus: options.network ?? "NOT_CHECKED",
      networkAlternatives: [] as never,
      durationMs: options.durationMs === undefined ? 100 : options.durationMs,
      coverageMatchProjections: {
        create: (options.matches ?? []).map((match) => ({
          partnerIdSnapshot: `pid-${match.partnerCode}`,
          partnerNameSnapshot: match.partnerName,
          partnerCodeSnapshot: match.partnerCode,
          layerIdSnapshot: match.layerId,
          layerNameSnapshot: match.layerName,
          versionSnapshot: match.version ?? null,
          createdAt: options.createdAt,
        })),
      },
    },
    select: { id: true },
  });
  return created.id;
}

/** Instante dentro do dia local (fuso de Brasília) às hh:mm. */
function localInstant(date: string, hour: number, minute = 0): Date {
  const midnight = zonedMidnightUtc(date, TZ);
  return new Date(midnight.getTime() + (hour * 60 + minute) * 60 * 1000);
}

const TODAY = calendarDateInTimeZone(new Date(), TZ);
const D = (offset: number) => addCalendarDays(TODAY, offset);

beforeAll(async () => {
  await resetAppDatabase();
  const admin = await createTestUser({ role: "ADMIN", email: "dash-admin@teste.local" });
  const operator = await createTestUser({ role: "OPERATOR", email: "dash-op@teste.local" });
  const technician = await createTestUser({ role: "TECHNICIAN", email: "dash-tec@teste.local" });
  const viewerUser = await createTestUser({ role: "VIEWER", email: "dash-view@teste.local" });
  operatorId = operator.id;
  viewerId = viewerUser.id;
  adminToken = (await loginAs(app, admin.email)).accessToken;
  operatorToken = (await loginAs(app, operator.email)).accessToken;
  technicianToken = (await loginAs(app, technician.email)).accessToken;
  viewerToken = (await loginAs(app, viewerUser.email)).accessToken;

  // ── Semeadura determinística (todos os protocolos distintos) ──
  await prisma.viabilityConsultation.deleteMany();
  // Período recente (dentro dos últimos 7 dias):
  await seedConsultation({
    createdAt: localInstant(D(-1), 10),
    status: "PRELIMINARILY_VIABLE",
    durationMs: 100,
    network: "FOUND",
    manual: true,
    matches: [
      { partnerCode: "REDE_NEUTRA", partnerName: "Rede Neutra", layerId: "layer-1", layerName: "Cobertura Barreiro", version: "2026-07" },
      { partnerCode: "PARCEIRO_B", partnerName: "Parceiro B", layerId: "layer-2", layerName: "Sobreposta B" },
    ],
  });
  await seedConsultation({
    createdAt: localInstant(D(-1), 11),
    status: "PRELIMINARILY_VIABLE",
    durationMs: 200,
    network: "NOT_FOUND",
    confidence: "MEDIUM",
    locationType: "RANGE_INTERPOLATED",
    matches: [
      { partnerCode: "REDE_NEUTRA", partnerName: "Rede Neutra", layerId: "layer-1", layerName: "Cobertura Barreiro", version: "2026-07" },
    ],
  });
  await seedConsultation({
    createdAt: localInstant(D(-2), 9),
    status: "OUTSIDE_COVERAGE",
    durationMs: 300,
    city: "Contagem",
    confidence: "LOW",
    locationType: "APPROXIMATE",
  });
  await seedConsultation({
    createdAt: localInstant(D(-2), 15),
    status: "ADDRESS_AMBIGUOUS",
    durationMs: 400,
    confidence: "LOW",
    locationType: null,
  });
  // Consulta do VIEWER (própria):
  await seedConsultation({
    createdAt: localInstant(D(-1), 12),
    status: "OUTSIDE_COVERAGE",
    userId: viewerId,
    durationMs: 500,
    confidence: null,
    locationType: null,
  });
  // Bordas do dia local D(-1): 00:30 e 23:30 de Brasília.
  await seedConsultation({ createdAt: localInstant(D(-1), 0, 30), status: "PRELIMINARILY_VIABLE", durationMs: null, matches: [{ partnerCode: "REDE_NEUTRA", partnerName: "Rede Neutra", layerId: "layer-1", layerName: "Cobertura Barreiro", version: "2026-07" }] });
  await seedConsultation({ createdAt: localInstant(D(-1), 23, 30), status: "COVERAGE_NOT_CONFIGURED", durationMs: 600 });
  // Período ANTERIOR (para comparação; 10-12 dias atrás, fora dos últimos 7):
  await seedConsultation({ createdAt: localInstant(D(-10), 10), status: "PRELIMINARILY_VIABLE", durationMs: 100 });
  await seedConsultation({ createdAt: localInstant(D(-11), 10), status: "OUTSIDE_COVERAGE", durationMs: 300 });
  // Antiga (fora de qualquer janela de teste ≤ 30 dias):
  await seedConsultation({ createdAt: localInstant(D(-60), 10), status: "PRELIMINARILY_VIABLE", durationMs: 999 });
});

afterAll(async () => {
  await resetAppDatabase();
  await disconnectAppDatabase();
});

function get(path: string, token: string) {
  return request(app).get(path).set("Authorization", `Bearer ${token}`);
}

describe("períodos e presets", () => {
  it("período padrão é LAST_30_DAYS no fuso configurado", () => {
    const period = resolveDashboardPeriod({});
    expect(period.timeZone).toBe(env.CONSULTATION_TIME_ZONE);
    expect(period.days).toBe(30);
    expect(period.dateTo).toBe(TODAY);
    expect(period.dateFrom).toBe(D(-29));
  });

  it("presets TODAY, LAST_7_DAYS, CURRENT_MONTH e PREVIOUS_MONTH", () => {
    expect(resolveDashboardPeriod({ preset: "TODAY" }).dateFrom).toBe(TODAY);
    expect(resolveDashboardPeriod({ preset: "TODAY" }).days).toBe(1);
    expect(resolveDashboardPeriod({ preset: "LAST_7_DAYS" }).dateFrom).toBe(D(-6));
    const currentMonth = resolveDashboardPeriod({ preset: "CURRENT_MONTH" });
    expect(currentMonth.dateFrom).toBe(`${TODAY.slice(0, 7)}-01`);
    expect(currentMonth.dateTo).toBe(TODAY);
    const previousMonth = resolveDashboardPeriod({ preset: "PREVIOUS_MONTH" });
    expect(previousMonth.dateTo < currentMonth.dateFrom).toBe(true);
    expect(previousMonth.dateFrom.endsWith("-01")).toBe(true);
    expect(previousMonth.dateTo.slice(0, 7)).toBe(previousMonth.dateFrom.slice(0, 7));
  });

  it("CUSTOM exige as duas datas; intervalo invertido e acima do máximo são rejeitados", async () => {
    expect(() => resolveDashboardPeriod({ preset: "CUSTOM", dateFrom: "2026-07-01" })).toThrow();
    const missing = await get("/api/dashboard/summary?preset=CUSTOM&dateFrom=2026-07-01", adminToken);
    expect(missing.status).toBe(400);
    expect(missing.body.error.code).toBe("DASHBOARD_INVALID_DATE_RANGE");

    const inverted = await get(
      "/api/dashboard/summary?preset=CUSTOM&dateFrom=2026-07-20&dateTo=2026-07-01",
      adminToken
    );
    expect(inverted.status).toBe(400);
    expect(inverted.body.error.code).toBe("DASHBOARD_INVALID_DATE_RANGE");

    const tooLarge = await get(
      "/api/dashboard/summary?preset=CUSTOM&dateFrom=2020-01-01&dateTo=2026-07-23",
      adminToken
    );
    expect(tooLarge.status).toBe(400);
    expect(tooLarge.body.error.code).toBe("DASHBOARD_DATE_RANGE_TOO_LARGE");
  });

  it("período anterior tem os mesmos dias e termina imediatamente antes do atual", () => {
    const period = resolveDashboardPeriod({
      preset: "CUSTOM",
      dateFrom: "2026-07-11",
      dateTo: "2026-07-20",
    });
    const previous = previousPeriod(period);
    expect(previous.days).toBe(10);
    expect(previous.dateTo).toBe("2026-07-10");
    expect(previous.dateFrom).toBe("2026-07-01");
  });
});

describe("summary: totais, taxas, desempenho e comparação", () => {
  it("totais e taxa de cobertura com o denominador correto (últimos 7 dias, fuso local)", async () => {
    const res = await get("/api/dashboard/summary?preset=LAST_7_DAYS", adminToken);
    expect(res.status).toBe(200);
    expect(res.body.period.timeZone).toBe(TZ);
    // 7 consultas no período (5 do operador + 1 do viewer + bordas):
    expect(res.body.totals.consultations).toBe(7);
    expect(res.body.totals.preliminarilyViable).toBe(3);
    expect(res.body.totals.outsideCoverage).toBe(2);
    expect(res.body.totals.addressAmbiguous).toBe(1);
    expect(res.body.totals.coverageNotConfigured).toBe(1);
    // coverageRate = 3 / (3 + 2): AMBIGUOUS e NOT_CONFIGURED fora do denominador.
    expect(res.body.rates.coverageRate).toBeCloseTo(3 / 5, 10);
    // networkReferenceFoundRate: NOT_CHECKED fora; FOUND=1, NOT_FOUND=1 => 1/2.
    expect(res.body.rates.networkReferenceFoundRate).toBeCloseTo(0.5, 10);
    // manualConfirmationRate = 1/7.
    expect(res.body.rates.manualConfirmationRate).toBeCloseTo(1 / 7, 10);
    // geocodingHighConfidenceRate: HIGH=3 de 6 preenchidas (1 null fora).
    expect(res.body.rates.geocodingHighConfidenceRate).toBeCloseTo(3 / 6, 10);
  });

  it("média, mediana e p95 usam apenas durationMs não nulos", async () => {
    const res = await get("/api/dashboard/summary?preset=LAST_7_DAYS", adminToken);
    // Durations não nulas: 100, 200, 300, 400, 500, 600 (null excluído).
    expect(res.body.performance.averageDurationMs).toBeCloseTo(350, 6);
    expect(res.body.performance.medianDurationMs).toBeCloseTo(350, 6);
    expect(res.body.performance.p95DurationMs).toBeCloseTo(575, 6);
  });

  it("taxa de cobertura com denominador zero retorna 0 (nunca NaN)", async () => {
    const res = await get(
      "/api/dashboard/summary?status=ADDRESS_AMBIGUOUS&preset=LAST_7_DAYS",
      adminToken
    );
    expect(res.body.rates.coverageRate).toBe(0);
    expect(Number.isFinite(res.body.rates.coverageRate)).toBe(true);
  });

  it("comparação com o período anterior: percentuais e pontos percentuais", async () => {
    const res = await get("/api/dashboard/summary?preset=LAST_7_DAYS", adminToken);
    const comparison = res.body.comparison;
    expect(comparison.previousPeriod.dateTo).toBe(D(-7));
    expect(comparison.previousPeriod.dateFrom).toBe(D(-13));
    // Anterior: 2 consultas → atual 7 => +250%.
    expect(comparison.consultationsChangePercent).toBeCloseTo(250, 6);
    // Cobertura anterior: 1/(1+1)=50%; atual 60% => +10 pontos percentuais.
    expect(comparison.coverageRateChangePercentagePoints).toBeCloseTo(10, 6);
    // Duração anterior média 200 → atual 350 => +75%.
    expect(comparison.averageDurationChangePercent).toBeCloseTo(75, 6);
  });

  it("comparação retorna null quando o valor anterior é zero (nunca Infinity)", async () => {
    const res = await get(
      `/api/dashboard/summary?preset=CUSTOM&dateFrom=${D(-2)}&dateTo=${TODAY}&city=Contagem`,
      adminToken
    );
    expect(res.body.totals.consultations).toBe(1);
    expect(res.body.comparison.consultationsChangePercent).toBeNull();
    expect(res.body.comparison.averageDurationChangePercent).toBeNull();
    expect(res.body.comparison.coverageRateChangePercentagePoints).toBeNull();
  });
});

describe("permissões e escopo", () => {
  it("ADMIN, OPERATOR e TECHNICIAN veem dados de todos (com filtro por usuário)", async () => {
    for (const token of [adminToken, operatorToken, technicianToken]) {
      const res = await get("/api/dashboard/summary?preset=LAST_7_DAYS", token);
      expect(res.status).toBe(200);
      expect(res.body.totals.consultations).toBe(7);
      const filtered = await get(
        `/api/dashboard/summary?preset=LAST_7_DAYS&userId=${viewerId}`,
        token
      );
      expect(filtered.body.totals.consultations).toBe(1);
    }
  });

  it("VIEWER recebe somente indicadores das próprias consultas (filtro por usuário é ignorado)", async () => {
    const res = await get("/api/dashboard/summary?preset=LAST_7_DAYS", viewerToken);
    expect(res.body.totals.consultations).toBe(1);
    expect(res.body.totals.outsideCoverage).toBe(1);
    // Tentar filtrar por outro usuário não vaza dados: escopo prevalece.
    const forced = await get(
      `/api/dashboard/summary?preset=LAST_7_DAYS&userId=${operatorId}`,
      viewerToken
    );
    expect(forced.body.totals.consultations).toBe(1);
  });

  it("buildDashboardWhere aplica o escopo do VIEWER na própria construção", () => {
    const period = resolveDashboardPeriod({ preset: "LAST_7_DAYS" });
    const where = buildDashboardWhere({ userId: operatorId }, period, {
      id: viewerId,
      role: "VIEWER",
    });
    expect(JSON.stringify(where)).toContain(viewerId);
    expect(JSON.stringify(where)).not.toContain(operatorId);
  });
});

describe("filtros", () => {
  it("status, cidade, UF, usuário e parceiro", async () => {
    const byStatus = await get(
      "/api/dashboard/summary?preset=LAST_7_DAYS&status=OUTSIDE_COVERAGE",
      adminToken
    );
    expect(byStatus.body.totals.consultations).toBe(2);

    const byCity = await get(
      "/api/dashboard/summary?preset=LAST_7_DAYS&city=contagem",
      adminToken
    );
    expect(byCity.body.totals.consultations).toBe(1);

    const byState = await get("/api/dashboard/summary?preset=LAST_7_DAYS&state=mg", adminToken);
    expect(byState.body.totals.consultations).toBe(7);

    const byUser = await get(
      `/api/dashboard/summary?preset=LAST_7_DAYS&userId=${viewerId}`,
      adminToken
    );
    expect(byUser.body.totals.consultations).toBe(1);

    const byPartner = await get(
      "/api/dashboard/summary?preset=LAST_7_DAYS&partnerCode=rede_neutra",
      adminToken
    );
    expect(byPartner.body.totals.consultations).toBe(3); // consultas com match da Rede Neutra
  });
});

describe("timeline", () => {
  it("diária: agrupa pelo dia LOCAL (23:30 de Brasília fica no dia local) e preenche zeros", async () => {
    const res = await get(
      `/api/dashboard/timeline?preset=CUSTOM&dateFrom=${D(-3)}&dateTo=${TODAY}`,
      adminToken
    );
    expect(res.status).toBe(200);
    expect(res.body.granularity).toBe("DAY");
    expect(res.body.points).toHaveLength(4); // todos os dias presentes, mesmo vazios
    const labels = res.body.points.map((point: { period: string }) => point.period);
    expect(labels).toEqual([D(-3), D(-2), D(-1), TODAY]);
    const dMinus1 = res.body.points.find((point: { period: string }) => point.period === D(-1))!;
    // D(-1) local: 10h, 11h, 12h(viewer), 00:30 e 23:30 => 5 consultas.
    expect(dMinus1.total).toBe(5);
    expect(dMinus1.preliminarilyViable).toBe(3);
    expect(dMinus1.outsideCoverage).toBe(1);
    const dMinus3 = res.body.points.find((point: { period: string }) => point.period === D(-3))!;
    expect(dMinus3.total).toBe(0); // período vazio preenchido com zero
  });

  it("granularidade automática: WEEK para 46-180 dias e MONTH acima de 180", async () => {
    const week = await get(
      `/api/dashboard/timeline?preset=CUSTOM&dateFrom=${D(-89)}&dateTo=${TODAY}`,
      adminToken
    );
    expect(week.body.granularity).toBe("WEEK");
    // Pontos ordenados cronologicamente:
    const weekLabels = week.body.points.map((point: { period: string }) => point.period);
    expect([...weekLabels].sort()).toEqual(weekLabels);

    const month = await get(
      `/api/dashboard/timeline?preset=CUSTOM&dateFrom=${D(-300)}&dateTo=${TODAY}`,
      adminToken
    );
    expect(month.body.granularity).toBe("MONTH");
    expect(month.body.points[0].period).toMatch(/^\d{4}-\d{2}$/); // rótulo estável
    const total = month.body.points.reduce(
      (sum: number, point: { total: number }) => sum + point.total,
      0
    );
    expect(total).toBe(10); // inclui a consulta de 60 dias atrás
  });

  it("granularidade explícita é aceita", async () => {
    const res = await get(
      `/api/dashboard/timeline?preset=LAST_7_DAYS&granularity=WEEK`,
      adminToken
    );
    expect(res.body.granularity).toBe("WEEK");
  });
});

describe("breakdowns", () => {
  it("por status, referência, confiança e locationType — com percentuais finitos", async () => {
    const res = await get("/api/dashboard/breakdowns?preset=LAST_7_DAYS", adminToken);
    expect(res.status).toBe(200);

    const status = res.body.byStatus.find(
      (item: { status: string }) => item.status === "PRELIMINARILY_VIABLE"
    )!;
    expect(status.count).toBe(3);
    expect(status.percentage).toBeCloseTo((3 / 7) * 100, 6);

    const network = res.body.byNetworkReferenceStatus.find(
      (item: { status: string }) => item.status === "FOUND"
    )!;
    expect(network.count).toBe(1);

    const confidence = res.body.byGeocodingConfidence.find(
      (item: { confidence: string }) => item.confidence === "HIGH"
    )!;
    expect(confidence.count).toBe(3);
    expect(confidence.percentage).toBeCloseTo(50, 6); // 3 de 6 preenchidas

    const locationType = res.body.byGeocodingLocationType.find(
      (item: { locationType: string }) => item.locationType === "ROOFTOP"
    )!;
    expect(locationType.count).toBe(3);

    for (const list of [
      res.body.byStatus,
      res.body.byNetworkReferenceStatus,
      res.body.byGeocodingConfidence,
      res.body.byGeocodingLocationType,
    ]) {
      for (const item of list) {
        expect(Number.isFinite(item.percentage)).toBe(true);
      }
    }
  });
});
