import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import request from "supertest";
import { createApp } from "../src/app";
import { prisma, disconnectAppDatabase } from "../src/db/prisma";
import { zonedMidnightUtc } from "../src/utils/timezone";
import { createTestUser, loginAs, resetAppDatabase } from "./helpers";

const app = createApp();
const TZ = "America/Sao_Paulo";

let adminToken = "";
let technicianToken = "";
let operatorToken = "";
let viewerToken = "";
let technicianId = "";
let operatorId = "";
let viewerId = "";

let seq = 0;

async function seedConsultation(
  userId: string,
  overrides: Partial<{
    coverageMatches: unknown;
    coverageMatchCount: number;
    networkReference: unknown;
    networkAlternatives: unknown;
    networkReferenceStatus: string;
    createdAt: Date;
  }> = {}
): Promise<{ id: string; protocol: string }> {
  seq += 1;
  const digits = String(seq).replace(/0/g, "A").replace(/1/g, "B");
  const created = await prisma.viabilityConsultation.create({
    data: {
      protocol: `VIA-20260726-${`R${digits}`.padEnd(8, "Z").slice(0, 8)}`,
      userId,
      status: "PRELIMINARILY_VIABLE",
      resultMessage: "seed",
      street: "Rua Revisão",
      number: "6",
      city: "Belo Horizonte",
      state: "MG",
      geocodingProvider: "dev",
      coverageMatches: (overrides.coverageMatches ?? []) as never,
      coverageMatchCount: overrides.coverageMatchCount ?? 0,
      coverageConfigured: true,
      networkReferenceStatus: overrides.networkReferenceStatus ?? "NOT_CHECKED",
      networkReference: (overrides.networkReference ?? undefined) as never,
      networkAlternatives: (overrides.networkAlternatives ?? []) as never,
      durationMs: 100,
      ...(overrides.createdAt ? { createdAt: overrides.createdAt } : {}),
    },
    select: { id: true, protocol: true },
  });
  return created;
}

function get(path: string, token: string) {
  return request(app).get(path).set("Authorization", `Bearer ${token}`);
}
function post(path: string, token: string, body?: Record<string, unknown>) {
  return request(app).post(path).set("Authorization", `Bearer ${token}`).send(body);
}
function patch(path: string, token: string, body: Record<string, unknown>) {
  return request(app).patch(path).set("Authorization", `Bearer ${token}`).send(body);
}

beforeAll(async () => {
  await resetAppDatabase();
  const admin = await createTestUser({ role: "ADMIN", email: "rv-admin@teste.local" });
  const technician = await createTestUser({ role: "TECHNICIAN", email: "rv-tec@teste.local" });
  const operator = await createTestUser({ role: "OPERATOR", email: "rv-op@teste.local" });
  const viewerUser = await createTestUser({ role: "VIEWER", email: "rv-view@teste.local" });
  technicianId = technician.id;
  operatorId = operator.id;
  viewerId = viewerUser.id;
  adminToken = (await loginAs(app, admin.email)).accessToken;
  technicianToken = (await loginAs(app, technician.email)).accessToken;
  operatorToken = (await loginAs(app, operator.email)).accessToken;
  viewerToken = (await loginAs(app, viewerUser.email)).accessToken;
});

afterAll(async () => {
  await resetAppDatabase();
  await disconnectAppDatabase();
});

beforeEach(async () => {
  await prisma.viabilityReviewEvent.deleteMany();
  await prisma.viabilityReview.deleteMany();
});

describe("GET /api/reviews/by-consultation/:consultationId", () => {
  it("localiza a análise pelo consultationId com o resumo enxuto", async () => {
    const consultation = await seedConsultation(operatorId);
    const created = await post("/api/reviews", operatorToken, {
      consultationId: consultation.id,
    });
    const res = await get(`/api/reviews/by-consultation/${consultation.id}`, technicianToken);
    expect(res.status).toBe(200);
    expect(res.body.review.id).toBe(created.body.review.id);
    expect(res.body.review.consultationId).toBe(consultation.id);
    expect(res.body.review.status).toBe("OPEN");
    expect(res.body.review.version).toBe(1);
    // Sem eventos, notas ou campos internos:
    expect(res.body.review.events).toBeUndefined();
    expect(res.body.review.openedById).toBeUndefined();
    expect(res.body.review.resolutionSummary).toBeUndefined();
  });

  it("VIEWER não localiza análise alheia (404) e consulta sem análise responde REVIEW_NOT_FOUND", async () => {
    const foreign = await seedConsultation(operatorId);
    await post("/api/reviews", operatorToken, { consultationId: foreign.id });
    const denied = await get(`/api/reviews/by-consultation/${foreign.id}`, viewerToken);
    expect(denied.status).toBe(404);
    expect(denied.body.error.code).toBe("REVIEW_NOT_FOUND");

    const withoutReview = await seedConsultation(operatorId);
    const missing = await get(
      `/api/reviews/by-consultation/${withoutReview.id}`,
      adminToken
    );
    expect(missing.status).toBe(404);
    expect(missing.body.error.code).toBe("REVIEW_NOT_FOUND");
  });
});

describe("detalhes históricos completos", () => {
  it("retorna parceiros, camadas, versões e a referência pública do Voalle — sem dados privados", async () => {
    const consultation = await seedConsultation(operatorId, {
      coverageMatches: [
        {
          partnerId: "p1",
          partnerName: "Rede Neutra",
          partnerCode: "REDE_NEUTRA",
          layerId: "layer-1",
          layerName: "Cobertura Barreiro",
          version: "2026-07",
        },
      ],
      coverageMatchCount: 1,
      networkReferenceStatus: "FOUND",
      networkReference: {
        latitude: -19.98,
        longitude: -44.02,
        distanceMeters: 83,
        identificationStatus: "IDENTIFIED",
        identifiers: [{ id: "n1", code: "BHZ-C0016-RT10-CT03_2780" }],
      },
      networkAlternatives: [
        {
          latitude: -19.981,
          longitude: -44.021,
          distanceMeters: 120,
          identificationStatus: "IDENTIFIED",
          identifiers: [{ id: "n2", code: "BHZ-C0016-RT10-CT04_2781" }],
        },
      ],
    });
    const created = await post("/api/reviews", adminToken, {
      consultationId: consultation.id,
    });
    const res = await get(`/api/reviews/${created.body.review.id}`, adminToken);
    expect(res.status).toBe(200);
    const detail = res.body.review.consultation;
    expect(detail.coverage.matches).toEqual([
      {
        partnerName: "Rede Neutra",
        partnerCode: "REDE_NEUTRA",
        layerName: "Cobertura Barreiro",
        version: "2026-07",
      },
    ]);
    expect(detail.coverage.matchCount).toBe(1);
    expect(detail.network.status).toBe("FOUND");
    expect(detail.network.reference.identifiers[0].code).toBe("BHZ-C0016-RT10-CT03_2780");
    expect(detail.network.reference.distanceMeters).toBe(83);
    expect(detail.network.alternatives).toHaveLength(1);

    const serialized = JSON.stringify(res.body);
    for (const forbidden of [
      "SPLITTER",
      "ROTA",
      "COLETOR",
      "storedFileName",
      "layerId",
      "partnerId",
      "latitude",
      "polygon",
    ]) {
      expect(serialized).not.toContain(forbidden);
    }
  });
});

describe("GET /api/reviews/assignees", () => {
  it("lista somente ADMIN e TECHNICIAN ativos; inativos não aparecem; VIEWER é proibido", async () => {
    const inactive = await createTestUser({
      role: "TECHNICIAN",
      email: `rv-inativo${seq}@teste.local`,
    });
    await prisma.user.update({ where: { id: inactive.id }, data: { active: false } });

    const res = await get("/api/reviews/assignees", operatorToken);
    expect(res.status).toBe(200);
    const roles = new Set(res.body.users.map((user: { role: string }) => user.role));
    expect([...roles].sort()).toEqual(["ADMIN", "TECHNICIAN"]);
    const ids = res.body.users.map((user: { id: string }) => user.id);
    expect(ids).not.toContain(inactive.id);
    expect(ids).not.toContain(operatorId);
    expect(ids).not.toContain(viewerId);

    const search = await get("/api/reviews/assignees?search=rv-tec", technicianToken);
    expect(search.body.users).toHaveLength(1);
    expect(search.body.users[0].id).toBe(technicianId);

    const denied = await get("/api/reviews/assignees", viewerToken);
    expect(denied.status).toBe(403);
  });
});

describe("filtros de data no fuso America/Sao_Paulo", () => {
  it("00:30 e 23:30 de Brasília caem no mesmo dia local; um dia, múltiplos dias, prazo, intervalo invertido e data inválida", async () => {
    // 2026-07-10 00:30 em Brasília = 03:30Z; 23:30 = 2026-07-11 02:30Z.
    const early = new Date("2026-07-10T03:30:00.000Z");
    const late = new Date("2026-07-11T02:30:00.000Z");
    const c1 = await seedConsultation(operatorId);
    const c2 = await seedConsultation(operatorId);
    const r1 = await post("/api/reviews", adminToken, { consultationId: c1.id });
    const r2 = await post("/api/reviews", adminToken, { consultationId: c2.id });
    await prisma.viabilityReview.update({
      where: { id: r1.body.review.id },
      data: { createdAt: early, dueAt: new Date("2026-07-11T02:59:00.000Z") }, // prazo 23:59 local
    });
    await prisma.viabilityReview.update({
      where: { id: r2.body.review.id },
      data: { createdAt: late, dueAt: new Date("2026-07-13T12:00:00.000Z") },
    });

    // Filtro de UM único dia local (2026-07-10) captura as duas:
    const singleDay = await get(
      "/api/reviews?dateFrom=2026-07-10&dateTo=2026-07-10",
      adminToken
    );
    expect(singleDay.body.total).toBe(2);

    // O limite é exclusivo: o dia seguinte não captura nenhuma.
    const nextDay = await get(
      "/api/reviews?dateFrom=2026-07-11&dateTo=2026-07-11",
      adminToken
    );
    expect(nextDay.body.total).toBe(0);

    // Intervalo de múltiplos dias:
    const multi = await get(
      "/api/reviews?dateFrom=2026-07-09&dateTo=2026-07-12",
      adminToken
    );
    expect(multi.body.total).toBe(2);

    // Prazo no FINAL do dia local 2026-07-10 (23:59 local) entra em dueTo=2026-07-10:
    const dueSingle = await get("/api/reviews?dueTo=2026-07-10", adminToken);
    expect(dueSingle.body.total).toBe(1);
    expect(dueSingle.body.reviews[0].id).toBe(r1.body.review.id);

    // A fronteira coincide com a meia-noite local calculada pelo utilitário:
    expect(zonedMidnightUtc("2026-07-11", TZ).getTime()).toBe(
      Date.parse("2026-07-11T03:00:00.000Z")
    );

    // Intervalo invertido: HTTP 400 com mensagem específica (nunca 200 vazio).
    const inverted = await get(
      "/api/reviews?dateFrom=2026-07-12&dateTo=2026-07-09",
      adminToken
    );
    expect(inverted.status).toBe(400);
    expect(inverted.body.error.code).toBe("REVIEW_INVALID_FILTER");
    expect(inverted.body.error.message).toBe(
      "O período inicial não pode ser posterior ao período final."
    );

    // dueFrom posterior a dueTo também é rejeitado:
    const invertedDue = await get(
      "/api/reviews?dueFrom=2026-07-12&dueTo=2026-07-09",
      adminToken
    );
    expect(invertedDue.status).toBe(400);
    expect(invertedDue.body.error.code).toBe("REVIEW_INVALID_FILTER");

    // Um único dia continua válido (mesma data nos dois limites):
    const singleValid = await get(
      "/api/reviews?dateFrom=2026-07-10&dateTo=2026-07-10",
      adminToken
    );
    expect(singleValid.status).toBe(200);

    // Datas de calendário impossíveis são rejeitadas (sem normalização):
    for (const bad of ["2026-02-31", "2026-04-31", "2026-13-01", "2027-02-29"]) {
      const res = await get(`/api/reviews?dateFrom=${bad}`, adminToken);
      expect(res.status).toBe(400);
      expect(res.body.error.code).toBe("REVIEW_INVALID_FILTER");
    }
    // Ano bissexto: 29/02 existe em 2028.
    const leap = await get("/api/reviews?dateFrom=2028-02-29&dateTo=2028-02-29", adminToken);
    expect(leap.status).toBe(200);

    // Data inválida → REVIEW_INVALID_FILTER.
    const invalid = await get("/api/reviews?dateFrom=10/07/2026", adminToken);
    expect(invalid.status).toBe(400);
    expect(invalid.body.error.code).toBe("REVIEW_INVALID_FILTER");
  });
});

describe("cancelamento e SLA histórico", () => {
  it("cancelar preenche resolvedAt e calcula o SLA (dentro e fora do prazo); a consulta segue intacta", async () => {
    // Dentro do prazo:
    const c1 = await seedConsultation(operatorId);
    const r1 = await post("/api/reviews", adminToken, { consultationId: c1.id });
    const cancelled1 = await patch(`/api/reviews/${r1.body.review.id}`, adminToken, {
      status: "CANCELLED",
      version: 1,
    });
    expect(cancelled1.status).toBe(200);
    expect(cancelled1.body.review.resolvedAt).toBeTruthy();
    const detail1 = await get(`/api/reviews/${r1.body.review.id}`, adminToken);
    expect(detail1.body.review.sla.resolvedWithinSla).toBe(true);

    // Fora do prazo (dueAt no passado):
    const c2 = await seedConsultation(operatorId);
    const r2 = await post("/api/reviews", adminToken, { consultationId: c2.id });
    await prisma.viabilityReview.update({
      where: { id: r2.body.review.id },
      data: { dueAt: new Date(Date.now() - 3600 * 1000) },
    });
    await patch(`/api/reviews/${r2.body.review.id}`, adminToken, {
      status: "CANCELLED",
      version: 1,
    });
    const detail2 = await get(`/api/reviews/${r2.body.review.id}`, adminToken);
    expect(detail2.body.review.sla.resolvedWithinSla).toBe(false);
    expect(detail2.body.review.sla.overdue).toBe(true);

    const events = await prisma.viabilityReviewEvent.findMany({
      where: { reviewId: r2.body.review.id, type: "STATUS_CHANGED" },
    });
    expect(events).toHaveLength(1);
    const consultation = await prisma.viabilityConsultation.findUniqueOrThrow({
      where: { id: c2.id },
    });
    expect(consultation.status).toBe("PRELIMINARILY_VIABLE"); // intacta
  });
});

describe("reabertura limpa a resolução atual", () => {
  it("aprovar → reabrir: status OPEN, resolução atual vazia, evento RESOLVED antigo preservado", async () => {
    const consultation = await seedConsultation(operatorId);
    const created = await post("/api/reviews", adminToken, {
      consultationId: consultation.id,
      assignedToId: technicianId,
    });
    const id = created.body.review.id;
    const started = await patch(`/api/reviews/${id}`, technicianToken, {
      status: "IN_PROGRESS",
      version: 1,
    });
    await post(`/api/reviews/${id}/resolve`, technicianToken, {
      decision: "APPROVED",
      resolutionCode: "COVERAGE_CONFIRMED",
      resolutionSummary: "Aprovada em campo.",
      version: started.body.review.version,
    });

    const reopened = await post(`/api/reviews/${id}/reopen`, adminToken, { version: 3 });
    expect(reopened.status).toBe(200);
    expect(reopened.body.review.status).toBe("OPEN");
    expect(reopened.body.review.resolvedAt).toBeNull();
    expect(reopened.body.review.resolutionCode).toBeNull();
    expect(reopened.body.review.resolutionSummary).toBeNull();

    const events = await prisma.viabilityReviewEvent.findMany({
      where: { reviewId: id },
      orderBy: { createdAt: "asc" },
    });
    const resolved = events.filter((event) => event.type === "RESOLVED");
    expect(resolved).toHaveLength(1); // antigo preservado
    expect(resolved[0].metadata).toMatchObject({ resolutionCode: "COVERAGE_CONFIRMED" });
    const reopenedEvent = events[events.length - 1];
    expect(reopenedEvent.type).toBe("REOPENED");
    expect(reopenedEvent.metadata).toMatchObject({
      previousResolutionCode: "COVERAGE_CONFIRMED",
    });
  });
});

describe("proteções de atribuição e claim", () => {
  async function cancelledReview(): Promise<string> {
    const consultation = await seedConsultation(operatorId);
    const created = await post("/api/reviews", adminToken, {
      consultationId: consultation.id,
    });
    await patch(`/api/reviews/${created.body.review.id}`, adminToken, {
      status: "CANCELLED",
      version: 1,
    });
    return created.body.review.id as string;
  }

  it("análise encerrada não aceita atribuição nem claim (REVIEW_NOT_ACTIVE)", async () => {
    const id = await cancelledReview();
    const assign = await patch(`/api/reviews/${id}/assignment`, adminToken, {
      assignedToId: technicianId,
      version: 2,
    });
    expect(assign.status).toBe(409);
    expect(assign.body.error.code).toBe("REVIEW_NOT_ACTIVE");

    const claim = await post(`/api/reviews/${id}/claim`, technicianToken, { version: 2 });
    expect(claim.status).toBe(409);
    expect(claim.body.error.code).toBe("REVIEW_NOT_ACTIVE");
  });

  it("claim exige version; desatualizada responde REVIEW_CONFLICT; responsável preenchido responde REVIEW_ALREADY_ASSIGNED", async () => {
    const consultation = await seedConsultation(operatorId);
    const created = await post("/api/reviews", adminToken, {
      consultationId: consultation.id,
    });
    const id = created.body.review.id;

    const noVersion = await post(`/api/reviews/${id}/claim`, technicianToken, {});
    expect(noVersion.status).toBe(400);
    expect(noVersion.body.error.code).toBe("REVIEW_INVALID_FILTER");

    const stale = await post(`/api/reviews/${id}/claim`, technicianToken, { version: 99 });
    expect(stale.status).toBe(409);
    expect(stale.body.error.code).toBe("REVIEW_CONFLICT");

    const ok = await post(`/api/reviews/${id}/claim`, technicianToken, { version: 1 });
    expect(ok.status).toBe(200);
    const taken = await post(`/api/reviews/${id}/claim`, adminToken, { version: 2 });
    expect(taken.status).toBe(409);
    expect(taken.body.error.code).toBe("REVIEW_ALREADY_ASSIGNED");
  });
});

describe("PATCH sem alteração", () => {
  it("somente version é rejeitado; valores iguais aos atuais não incrementam a versão; nada gera evento ou auditoria", async () => {
    const consultation = await seedConsultation(operatorId);
    const created = await post("/api/reviews", adminToken, {
      consultationId: consultation.id,
      priority: "HIGH",
    });
    const id = created.body.review.id;
    await prisma.auditLog.deleteMany();
    const eventsBefore = await prisma.viabilityReviewEvent.count({ where: { reviewId: id } });

    const onlyVersion = await patch(`/api/reviews/${id}`, adminToken, { version: 1 });
    expect(onlyVersion.status).toBe(400);
    expect(onlyVersion.body.error.code).toBe("REVIEW_INVALID_FILTER");
    expect(onlyVersion.body.error.message).toBe("Nenhuma alteração foi informada.");

    // Mesmo valor atual: nada aplicado, versão intacta.
    const samePriority = await patch(`/api/reviews/${id}`, adminToken, {
      priority: "HIGH",
      version: 1,
    });
    expect(samePriority.status).toBe(400);
    expect(samePriority.body.error.code).toBe("REVIEW_INVALID_FILTER");

    const review = await prisma.viabilityReview.findUniqueOrThrow({ where: { id } });
    expect(review.version).toBe(1);
    expect(await prisma.viabilityReviewEvent.count({ where: { reviewId: id } })).toBe(
      eventsBefore
    );
    expect(await prisma.auditLog.count()).toBe(0);
  });
});

describe("prazo sem mudança real", () => {
  it("mesmo dueAt (ou null→null) não incrementa version nem cria evento/auditoria; mudança real cria exatamente um de cada", async () => {
    const consultation = await seedConsultation(operatorId);
    const created = await post("/api/reviews", adminToken, { consultationId: consultation.id });
    const id = created.body.review.id;
    const dueAtIso = new Date(created.body.review.dueAt).toISOString();
    await prisma.auditLog.deleteMany();

    // 1) Mesmo instante: REVIEW_INVALID_FILTER, version intacta.
    const same = await patch(`/api/reviews/${id}`, adminToken, {
      dueAt: dueAtIso,
      version: 1,
    });
    expect(same.status).toBe(400);
    expect(same.body.error.code).toBe("REVIEW_INVALID_FILTER");
    expect(same.body.error.message).toBe("Nenhuma alteração foi informada.");

    // 2) null → null: idem.
    await prisma.viabilityReview.update({ where: { id }, data: { dueAt: null } });
    const nullSame = await patch(`/api/reviews/${id}`, adminToken, {
      dueAt: null,
      version: 1,
    });
    expect(nullSame.status).toBe(400);

    const untouched = await prisma.viabilityReview.findUniqueOrThrow({ where: { id } });
    expect(untouched.version).toBe(1); // nunca incrementada
    // 3-4) Nenhum evento DUE_DATE_CHANGED nem auditoria criados:
    expect(
      await prisma.viabilityReviewEvent.count({ where: { reviewId: id, type: "DUE_DATE_CHANGED" } })
    ).toBe(0);
    expect(await prisma.auditLog.count()).toBe(0);

    // 5-6) Mudança REAL: version +1, exatamente 1 evento e 1 auditoria.
    const changed = await patch(`/api/reviews/${id}`, adminToken, {
      dueAt: "2026-07-28T18:00:00.000Z",
      version: 1,
    });
    expect(changed.status).toBe(200);
    expect(changed.body.review.version).toBe(2);
    expect(
      await prisma.viabilityReviewEvent.count({ where: { reviewId: id, type: "DUE_DATE_CHANGED" } })
    ).toBe(1);
    expect(
      await prisma.auditLog.count({ where: { action: "REVIEW_DUE_DATE_CHANGED" } })
    ).toBe(1);
  });
});
