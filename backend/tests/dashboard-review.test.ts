import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import request from "supertest";
import { createApp } from "../src/app";
import { prisma, disconnectAppDatabase } from "../src/db/prisma";
import { zonedMidnightUtc } from "../src/utils/timezone";
import { createTestUser, loginAs, resetAppDatabase } from "./helpers";

const app = createApp();

let adminToken = "";
let operatorToken = "";
let technicianToken = "";
let viewerToken = "";
let operatorId = "";

let seq = 0;

/** Consulta com matches SOBREPOSTOS controlados, inserida direto no banco. */
async function seedWithMatches(
  matches: Array<{ partnerCode: string; partnerName: string; layerId: string; layerName: string }>,
  status = "PRELIMINARILY_VIABLE"
): Promise<void> {
  seq += 1;
  const digits = String(seq).replace(/0/g, "A").replace(/1/g, "B");
  const createdAt = new Date(zonedMidnightUtc("2026-07-22", "America/Sao_Paulo").getTime() + 10 * 3600 * 1000);
  await prisma.viabilityConsultation.create({
    data: {
      protocol: `VIA-20260722-${`R${digits}`.padEnd(8, "Z").slice(0, 8)}`,
      userId: operatorId,
      status,
      resultMessage: "seed",
      createdAt,
      street: "Rua Sobreposição",
      number: "1",
      city: "Belo Horizonte",
      state: "MG",
      geocodingProvider: "dev",
      coverageMatches: matches as never,
      coverageMatchCount: matches.length,
      coverageConfigured: true,
      networkReferenceStatus: "NOT_CHECKED",
      networkAlternatives: [] as never,
      durationMs: 100,
      coverageMatchProjections: {
        create: matches.map((match) => ({
          partnerIdSnapshot: `pid-${match.partnerCode}`,
          partnerNameSnapshot: match.partnerName,
          partnerCodeSnapshot: match.partnerCode,
          layerIdSnapshot: match.layerId,
          layerNameSnapshot: match.layerName,
          versionSnapshot: null,
          createdAt,
        })),
      },
    },
  });
}

beforeAll(async () => {
  await resetAppDatabase();
  const admin = await createTestUser({ role: "ADMIN", email: "rev-admin@teste.local" });
  const operator = await createTestUser({ role: "OPERATOR", email: "rev-op@teste.local" });
  const technician = await createTestUser({ role: "TECHNICIAN", email: "rev-tec@teste.local" });
  const viewerUser = await createTestUser({ role: "VIEWER", email: "rev-view@teste.local" });
  operatorId = operator.id;
  adminToken = (await loginAs(app, admin.email)).accessToken;
  operatorToken = (await loginAs(app, operator.email)).accessToken;
  technicianToken = (await loginAs(app, technician.email)).accessToken;
  viewerToken = (await loginAs(app, viewerUser.email)).accessToken;

  // Usuário INATIVO não pode aparecer nas opções:
  const inactive = await createTestUser({ role: "VIEWER", email: "rev-inativo@teste.local" });
  await prisma.user.update({ where: { id: inactive.id }, data: { active: false } });

  // Consulta com matches sobrepostos: Parceiro A/Camada A + Parceiro B/Camada B.
  await seedWithMatches([
    { partnerCode: "PARC_A", partnerName: "Parceiro A", layerId: "layer-a", layerName: "Camada A" },
    { partnerCode: "PARC_B", partnerName: "Parceiro B", layerId: "layer-b", layerName: "Camada B" },
  ]);
  // Consulta apenas com o Parceiro B (controle):
  await seedWithMatches([
    { partnerCode: "PARC_B", partnerName: "Parceiro B", layerId: "layer-b", layerName: "Camada B" },
  ]);
});

afterAll(async () => {
  await resetAppDatabase();
  await disconnectAppDatabase();
});

afterEach(() => {
  vi.restoreAllMocks();
});

const PERIOD = "preset=CUSTOM&dateFrom=2026-07-20&dateTo=2026-07-23";

describe("GET /api/dashboard/users (opções para o filtro)", () => {
  it("ADMIN, OPERATOR e TECHNICIAN listam usuários ativos, ordenados por nome e sem campos internos", async () => {
    for (const token of [adminToken, operatorToken, technicianToken]) {
      const res = await request(app)
        .get("/api/dashboard/users")
        .set("Authorization", `Bearer ${token}`);
      expect(res.status).toBe(200);
      expect(res.body.limit).toBe(50);
      expect(res.body.page).toBe(1);
      expect(res.body.total).toBe(4); // inativo fora
      const emails = res.body.users.map((user: { email: string }) => user.email);
      expect(emails).not.toContain("rev-inativo@teste.local");
      const names = res.body.users.map((user: { name: string }) => user.name);
      expect([...names].sort((a, b) => a.localeCompare(b))).toEqual(names);
      // Somente id/name/email — nada interno:
      const serialized = JSON.stringify(res.body);
      for (const forbidden of ["password", "Hash", "familyId", "refresh", "role", "active"]) {
        expect(serialized).not.toContain(forbidden);
      }
      expect(Object.keys(res.body.users[0]).sort()).toEqual(["email", "id", "name"]);
    }
  });

  it("VIEWER recebe 403", async () => {
    const res = await request(app)
      .get("/api/dashboard/users")
      .set("Authorization", `Bearer ${viewerToken}`);
    expect(res.status).toBe(403);
  });

  it("search e paginação funcionam com limit máximo 100", async () => {
    const res = await request(app)
      .get("/api/dashboard/users?search=rev-op&limit=100")
      .set("Authorization", `Bearer ${adminToken}`);
    expect(res.body.total).toBe(1);
    expect(res.body.users[0].email).toBe("rev-op@teste.local");
    const invalid = await request(app)
      .get("/api/dashboard/users?limit=101")
      .set("Authorization", `Bearer ${adminToken}`);
    expect(invalid.status).toBe(400);
    expect(invalid.body.error.code).toBe("DASHBOARD_INVALID_FILTER");
  });
});

describe("filtros de parceiro/camada nos rankings (matches sobrepostos)", () => {
  it("partnerCode=PARC_A: consulta conta 1 e SOMENTE A (e camadas de A) aparecem nos rankings", async () => {
    const summary = await request(app)
      .get(`/api/dashboard/summary?${PERIOD}&partnerCode=PARC_A`)
      .set("Authorization", `Bearer ${adminToken}`);
    expect(summary.body.totals.consultations).toBe(1);

    const res = await request(app)
      .get(`/api/dashboard/rankings?${PERIOD}&partnerCode=PARC_A`)
      .set("Authorization", `Bearer ${adminToken}`);
    expect(res.status).toBe(200);
    expect(res.body.partners).toHaveLength(1);
    expect(res.body.partners[0].partnerCode).toBe("PARC_A");
    expect(res.body.layers).toHaveLength(1);
    expect(res.body.layers[0].layerName).toBe("Camada A");
    const serialized = JSON.stringify(res.body.partners) + JSON.stringify(res.body.layers);
    expect(serialized).not.toContain("PARC_B");
    expect(serialized).not.toContain("Camada B");
  });

  it("layerId=layer-b: somente a Camada B e seu parceiro aparecem nos rankings relacionados", async () => {
    const res = await request(app)
      .get(`/api/dashboard/rankings?${PERIOD}&layerId=layer-b`)
      .set("Authorization", `Bearer ${adminToken}`);
    expect(res.body.layers).toHaveLength(1);
    expect(res.body.layers[0].layerName).toBe("Camada B");
    expect(res.body.layers[0].consultationCount).toBe(2);
    expect(res.body.partners).toHaveLength(1);
    expect(res.body.partners[0].partnerCode).toBe("PARC_B");
    expect(JSON.stringify(res.body.layers)).not.toContain("Camada A");
  });

  it("summary/timeline/breakdowns/recentes mantêm a seleção POR CONSULTA (que possua o parceiro)", async () => {
    // partnerCode=PARC_B seleciona as 2 consultas (a sobreposta possui B):
    const summary = await request(app)
      .get(`/api/dashboard/summary?${PERIOD}&partnerCode=PARC_B`)
      .set("Authorization", `Bearer ${adminToken}`);
    expect(summary.body.totals.consultations).toBe(2);
    const recent = await request(app)
      .get(`/api/dashboard/recent-consultations?${PERIOD}&partnerCode=PARC_B`)
      .set("Authorization", `Bearer ${adminToken}`);
    expect(recent.body.consultations).toHaveLength(2);
  });
});

describe("auditoria condicionada ao recordView", () => {
  it("DASHBOARD_VIEWED só é registrado quando recordView=true é solicitado", async () => {
    await prisma.auditLog.deleteMany({ where: { action: "DASHBOARD_VIEWED" } });
    await request(app)
      .get("/api/dashboard/summary?preset=LAST_7_DAYS")
      .set("Authorization", `Bearer ${adminToken}`);
    await request(app)
      .get("/api/dashboard/summary?preset=LAST_7_DAYS&recordView=false")
      .set("Authorization", `Bearer ${adminToken}`);
    expect(
      await prisma.auditLog.count({ where: { action: "DASHBOARD_VIEWED" } })
    ).toBe(0);
    await request(app)
      .get("/api/dashboard/summary?preset=LAST_7_DAYS&recordView=true")
      .set("Authorization", `Bearer ${adminToken}`);
    expect(
      await prisma.auditLog.count({ where: { action: "DASHBOARD_VIEWED" } })
    ).toBe(1);
  });
});

describe("DASHBOARD_QUERY_FAILED em falhas inesperadas", () => {
  it("falha do Prisma vira DASHBOARD_QUERY_FAILED 500 com mensagem neutra (sem SQL/stack)", async () => {
    vi.spyOn(prisma.viabilityConsultation, "groupBy").mockRejectedValue(
      new Error('relation "x" does not exist — SELECT * FROM secreta')
    );
    const endpoints = ["summary", "breakdowns"];
    for (const endpoint of endpoints) {
      const res = await request(app)
        .get(`/api/dashboard/${endpoint}?preset=LAST_7_DAYS`)
        .set("Authorization", `Bearer ${adminToken}`);
      expect(res.status).toBe(500);
      expect(res.body.error.code).toBe("DASHBOARD_QUERY_FAILED");
      expect(res.body.error.message).toBe(
        "Não foi possível carregar os indicadores do dashboard."
      );
      const serialized = JSON.stringify(res.body);
      expect(serialized).not.toContain("SELECT");
      expect(serialized).not.toContain("relation");
      expect(serialized).not.toContain("stack");
    }
  });

  it("falha do Prisma nos demais endpoints também vira DASHBOARD_QUERY_FAILED", async () => {
    vi.spyOn(prisma, "$queryRaw").mockRejectedValue(new Error("boom sql"));
    for (const endpoint of ["timeline", "rankings"]) {
      const res = await request(app)
        .get(`/api/dashboard/${endpoint}?preset=LAST_7_DAYS`)
        .set("Authorization", `Bearer ${adminToken}`);
      expect(res.status).toBe(500);
      expect(res.body.error.code).toBe("DASHBOARD_QUERY_FAILED");
    }
    vi.restoreAllMocks();
    vi.spyOn(prisma.viabilityConsultation, "findMany").mockRejectedValue(new Error("boom"));
    const recent = await request(app)
      .get("/api/dashboard/recent-consultations?preset=LAST_7_DAYS")
      .set("Authorization", `Bearer ${adminToken}`);
    expect(recent.body.error.code).toBe("DASHBOARD_QUERY_FAILED");
    vi.restoreAllMocks();
    vi.spyOn(prisma.user, "findMany").mockRejectedValue(new Error("boom"));
    const users = await request(app)
      .get("/api/dashboard/users")
      .set("Authorization", `Bearer ${adminToken}`);
    expect(users.body.error.code).toBe("DASHBOARD_QUERY_FAILED");
  });

  it("erros de validação mantêm seus códigos específicos (não viram genérico)", async () => {
    const invalidRange = await request(app)
      .get("/api/dashboard/summary?preset=CUSTOM&dateFrom=2026-07-01")
      .set("Authorization", `Bearer ${adminToken}`);
    expect(invalidRange.status).toBe(400);
    expect(invalidRange.body.error.code).toBe("DASHBOARD_INVALID_DATE_RANGE");

    const tooLarge = await request(app)
      .get("/api/dashboard/summary?preset=CUSTOM&dateFrom=2018-01-01&dateTo=2026-07-23")
      .set("Authorization", `Bearer ${adminToken}`);
    expect(tooLarge.body.error.code).toBe("DASHBOARD_DATE_RANGE_TOO_LARGE");

    const badFilter = await request(app)
      .get("/api/dashboard/rankings?limit=999")
      .set("Authorization", `Bearer ${adminToken}`);
    expect(badFilter.body.error.code).toBe("DASHBOARD_INVALID_FILTER");
  });

});
