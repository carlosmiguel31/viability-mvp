import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import request from "supertest";
import { createApp } from "../src/app";
import { prisma, disconnectAppDatabase } from "../src/db/prisma";
import { env } from "../src/config/env";
import { createTestUser, loginAs, resetAppDatabase } from "./helpers";

const app = createApp();

let adminToken = "";
let technicianToken = "";
let technician2Token = "";
let operatorToken = "";
let technicianId = "";
let technician2Id = "";
let operatorId = "";

let seq = 0;

async function seedConsultation(userId: string): Promise<string> {
  seq += 1;
  const digits = String(seq).replace(/0/g, "A").replace(/1/g, "B");
  const created = await prisma.viabilityConsultation.create({
    data: {
      protocol: `VIA-20260725-${`W${digits}`.padEnd(8, "Z").slice(0, 8)}`,
      userId,
      status: "PRELIMINARILY_VIABLE",
      resultMessage: "seed",
      street: "Rua Fila",
      number: "10",
      city: "Belo Horizonte",
      state: "MG",
      geocodingProvider: "dev",
      coverageMatches: [] as never,
      coverageMatchCount: 0,
      coverageConfigured: true,
      networkReferenceStatus: "NOT_CHECKED",
      networkAlternatives: [] as never,
      durationMs: 100,
    },
    select: { id: true },
  });
  return created.id;
}

function post(path: string, token: string, body?: Record<string, unknown>) {
  return request(app).post(path).set("Authorization", `Bearer ${token}`).send(body);
}
function patch(path: string, token: string, body: Record<string, unknown>) {
  return request(app).patch(path).set("Authorization", `Bearer ${token}`).send(body);
}
function get(path: string, token: string) {
  return request(app).get(path).set("Authorization", `Bearer ${token}`);
}

beforeAll(async () => {
  await resetAppDatabase();
  const admin = await createTestUser({ role: "ADMIN", email: "rw-admin@teste.local" });
  const technician = await createTestUser({ role: "TECHNICIAN", email: "rw-tec@teste.local" });
  const technician2 = await createTestUser({ role: "TECHNICIAN", email: "rw-tec2@teste.local" });
  const operator = await createTestUser({ role: "OPERATOR", email: "rw-op@teste.local" });
  technicianId = technician.id;
  technician2Id = technician2.id;
  operatorId = operator.id;
  adminToken = (await loginAs(app, admin.email)).accessToken;
  technicianToken = (await loginAs(app, technician.email)).accessToken;
  technician2Token = (await loginAs(app, technician2.email)).accessToken;
  operatorToken = (await loginAs(app, operator.email)).accessToken;
});

afterAll(async () => {
  await resetAppDatabase();
  await disconnectAppDatabase();
});

beforeEach(async () => {
  await prisma.viabilityReviewEvent.deleteMany();
  await prisma.viabilityReview.deleteMany();
});

describe("criação da análise", () => {
  it("cria com padrões (OPEN, NORMAL, dueAt = SLA), evento CREATED e observação inicial", async () => {
    const consultationId = await seedConsultation(operatorId);
    const before = Date.now();
    const res = await post("/api/reviews", operatorToken, {
      consultationId,
      note: "Verificar poste em frente",
    });
    expect(res.status).toBe(201);
    const review = res.body.review;
    expect(review.status).toBe("OPEN");
    expect(review.priority).toBe("NORMAL");
    expect(review.openedById).toBe(operatorId);
    expect(review.version).toBe(1);
    // dueAt = createdAt + REVIEW_DEFAULT_SLA_HOURS (24h nos testes):
    const expectedDue = before + env.REVIEW_DEFAULT_SLA_HOURS * 3600 * 1000;
    expect(Math.abs(new Date(review.dueAt).getTime() - expectedDue)).toBeLessThan(60_000);

    const events = await prisma.viabilityReviewEvent.findMany({
      where: { reviewId: review.id },
      orderBy: { createdAt: "asc" },
    });
    expect(events.map((event) => event.type)).toEqual(["CREATED", "NOTE_ADDED"]);
    expect(events[1].note).toBe("Verificar poste em frente");
  });

  it("impede duplicidade (REVIEW_ALREADY_EXISTS) e rejeita consulta inexistente", async () => {
    const consultationId = await seedConsultation(operatorId);
    await post("/api/reviews", adminToken, { consultationId });
    const duplicate = await post("/api/reviews", adminToken, { consultationId });
    expect(duplicate.status).toBe(409);
    expect(duplicate.body.error.code).toBe("REVIEW_ALREADY_EXISTS");

    const missing = await post("/api/reviews", adminToken, {
      consultationId: "00000000-0000-4000-8000-000000000000",
    });
    expect(missing.status).toBe(404);
  });

  it("ADMIN cria já atribuída (evento ASSIGNED); atribuição rejeita inativo e perfil não técnico", async () => {
    const consultationId = await seedConsultation(operatorId);
    const res = await post("/api/reviews", adminToken, {
      consultationId,
      assignedToId: technicianId,
      priority: "HIGH",
    });
    expect(res.status).toBe(201);
    expect(res.body.review.assignedToId).toBe(technicianId);
    const events = await prisma.viabilityReviewEvent.findMany({
      where: { reviewId: res.body.review.id },
    });
    expect(events.map((event) => event.type).sort()).toEqual(["ASSIGNED", "CREATED"]);

    // Perfil não técnico:
    const badRole = await post("/api/reviews", adminToken, {
      consultationId: await seedConsultation(operatorId),
      assignedToId: operatorId,
    });
    expect(badRole.status).toBe(400);
    expect(badRole.body.error.code).toBe("REVIEW_INVALID_ASSIGNEE");

    // Usuário inativo:
    const inactive = await createTestUser({ role: "TECHNICIAN", email: `rw-inat${seq}@teste.local` });
    await prisma.user.update({ where: { id: inactive.id }, data: { active: false } });
    const badActive = await post("/api/reviews", adminToken, {
      consultationId: await seedConsultation(operatorId),
      assignedToId: inactive.id,
    });
    expect(badActive.status).toBe(400);
    expect(badActive.body.error.code).toBe("REVIEW_INVALID_ASSIGNEE");
  });
});

describe("claim e atribuição", () => {
  it("TECHNICIAN assume análise sem responsável; a corrida entre dois claims tem um só vencedor", async () => {
    const consultationId = await seedConsultation(operatorId);
    const created = await post("/api/reviews", operatorToken, { consultationId });
    const id = created.body.review.id;

    const [first, second] = await Promise.all([
      post(`/api/reviews/${id}/claim`, technicianToken, { version: 1 }),
      post(`/api/reviews/${id}/claim`, technician2Token, { version: 1 }),
    ]);
    const statuses = [first.status, second.status].sort();
    expect(statuses).toEqual([200, 409]);
    const loser = first.status === 409 ? first : second;
    expect(loser.body.error.code).toBe("REVIEW_ALREADY_ASSIGNED");

    const review = await prisma.viabilityReview.findUniqueOrThrow({ where: { id } });
    expect([technicianId, technician2Id]).toContain(review.assignedToId);
    // Exatamente UM evento ASSIGNED (o vencedor):
    const assigned = await prisma.viabilityReviewEvent.count({
      where: { reviewId: id, type: "ASSIGNED" },
    });
    expect(assigned).toBe(1);
  });

  it("ADMIN atribui e remove responsável (eventos ASSIGNED/UNASSIGNED); TECHNICIAN não atribui a terceiros", async () => {
    const consultationId = await seedConsultation(operatorId);
    const created = await post("/api/reviews", adminToken, { consultationId });
    const id = created.body.review.id;

    const assigned = await patch(`/api/reviews/${id}/assignment`, adminToken, {
      assignedToId: technicianId,
      version: 1,
    });
    expect(assigned.status).toBe(200);
    expect(assigned.body.review.assignedToId).toBe(technicianId);
    expect(assigned.body.review.version).toBe(2);

    const denied = await patch(`/api/reviews/${id}/assignment`, technicianToken, {
      assignedToId: technician2Id,
      version: 2,
    });
    expect(denied.status).toBe(403);

    const removed = await patch(`/api/reviews/${id}/assignment`, adminToken, {
      assignedToId: null,
      version: 2,
    });
    expect(removed.status).toBe(200);
    expect(removed.body.review.assignedToId).toBeNull();
    const types = (
      await prisma.viabilityReviewEvent.findMany({ where: { reviewId: id } })
    ).map((event) => event.type);
    expect(types).toContain("UNASSIGNED");
  });
});

describe("transições de status", () => {
  async function createAssigned(): Promise<{ id: string; version: number }> {
    const consultationId = await seedConsultation(operatorId);
    const created = await post("/api/reviews", adminToken, {
      consultationId,
      assignedToId: technicianId,
    });
    return { id: created.body.review.id, version: created.body.review.version };
  }

  it("OPEN → IN_PROGRESS preenche startedAt na primeira vez; WAITING e retomada funcionam", async () => {
    const { id, version } = await createAssigned();
    const started = await patch(`/api/reviews/${id}`, technicianToken, {
      status: "IN_PROGRESS",
      version,
    });
    expect(started.status).toBe(200);
    expect(started.body.review.startedAt).toBeTruthy();
    const startedAt = started.body.review.startedAt;

    const waiting = await patch(`/api/reviews/${id}`, technicianToken, {
      status: "WAITING_INFORMATION",
      version: started.body.review.version,
    });
    expect(waiting.status).toBe(200);

    const resumed = await patch(`/api/reviews/${id}`, technicianToken, {
      status: "IN_PROGRESS",
      version: waiting.body.review.version,
    });
    expect(resumed.status).toBe(200);
    // startedAt NÃO muda na retomada:
    expect(resumed.body.review.startedAt).toBe(startedAt);
    const events = await prisma.viabilityReviewEvent.findMany({
      where: { reviewId: id, type: "STATUS_CHANGED" },
      orderBy: { createdAt: "asc" },
    });
    expect(events).toHaveLength(3);
    expect(events[0].fromStatus).toBe("OPEN");
    expect(events[0].toStatus).toBe("IN_PROGRESS");
  });

  it("transição arbitrária é rejeitada e APPROVED via PATCH exige resolução", async () => {
    const { id, version } = await createAssigned();
    const invalid = await patch(`/api/reviews/${id}`, adminToken, {
      status: "REJECTED",
      version,
    });
    expect(invalid.status).toBe(400);
    expect(invalid.body.error.code).toBe("REVIEW_RESOLUTION_REQUIRED");

    // OPEN → APPROVED nem via resolve (transição inválida):
    const resolve = await post(`/api/reviews/${id}/resolve`, adminToken, {
      decision: "APPROVED",
      resolutionCode: "MANUAL_APPROVAL",
      resolutionSummary: "ok",
      version,
    });
    expect(resolve.status).toBe(400);
    expect(resolve.body.error.code).toBe("REVIEW_INVALID_STATUS_TRANSITION");
  });
});

describe("resolução e reabertura", () => {
  async function inProgressReview(): Promise<{ id: string; version: number }> {
    const consultationId = await seedConsultation(operatorId);
    const created = await post("/api/reviews", adminToken, {
      consultationId,
      assignedToId: technicianId,
    });
    const started = await patch(`/api/reviews/${created.body.review.id}`, technicianToken, {
      status: "IN_PROGRESS",
      version: created.body.review.version,
    });
    return { id: started.body.review.id, version: started.body.review.version };
  }

  it("aprova com code + summary, preenche resolvedAt, incrementa version e cria evento RESOLVED", async () => {
    const { id, version } = await inProgressReview();
    const res = await post(`/api/reviews/${id}/resolve`, technicianToken, {
      decision: "APPROVED",
      resolutionCode: "COVERAGE_CONFIRMED",
      resolutionSummary: "Análise técnica confirmou disponibilidade.",
      version,
    });
    expect(res.status).toBe(200);
    expect(res.body.review.status).toBe("APPROVED");
    expect(res.body.review.resolvedAt).toBeTruthy();
    expect(res.body.review.resolutionCode).toBe("COVERAGE_CONFIRMED");
    expect(res.body.review.version).toBe(version + 1);
    const event = await prisma.viabilityReviewEvent.findFirstOrThrow({
      where: { reviewId: id, type: "RESOLVED" },
    });
    expect(event.toStatus).toBe("APPROVED");

    // A consulta histórica permanece IMUTÁVEL (status original intacto):
    const review = await prisma.viabilityReview.findUniqueOrThrow({
      where: { id },
      include: { consultation: true },
    });
    expect(review.consultation.status).toBe("PRELIMINARILY_VIABLE");
  });

  it("rejeita exige resolutionCode válido e resolutionSummary não vazio", async () => {
    const { id, version } = await inProgressReview();
    const noCode = await post(`/api/reviews/${id}/resolve`, technicianToken, {
      decision: "REJECTED",
      resolutionCode: "código inválido",
      resolutionSummary: "resumo",
      version,
    });
    expect(noCode.status).toBe(400);

    const noSummary = await post(`/api/reviews/${id}/resolve`, technicianToken, {
      decision: "REJECTED",
      resolutionCode: "TECHNICAL_RESTRICTION",
      resolutionSummary: "   ",
      version,
    });
    expect(noSummary.status).toBe(400);

    const rejected = await post(`/api/reviews/${id}/resolve`, technicianToken, {
      decision: "REJECTED",
      resolutionCode: "TECHNICAL_RESTRICTION",
      resolutionSummary: "Sem viabilidade técnica no poste.",
      version,
    });
    expect(rejected.status).toBe(200);
    expect(rejected.body.review.status).toBe("REJECTED");
  });

  it("cancela (via PATCH) e reabre (ADMIN): resolvedAt limpo, eventos preservados", async () => {
    const { id, version } = await inProgressReview();
    const cancelled = await patch(`/api/reviews/${id}`, adminToken, {
      status: "CANCELLED",
      version,
    });
    expect(cancelled.status).toBe(200);

    const eventsBefore = await prisma.viabilityReviewEvent.count({ where: { reviewId: id } });
    const reopened = await post(`/api/reviews/${id}/reopen`, adminToken, {
      version: cancelled.body.review.version,
      note: "Reavaliar após nova vistoria",
    });
    expect(reopened.status).toBe(200);
    expect(reopened.body.review.status).toBe("OPEN");
    expect(reopened.body.review.resolvedAt).toBeNull();
    const eventsAfter = await prisma.viabilityReviewEvent.findMany({
      where: { reviewId: id },
      orderBy: { createdAt: "asc" },
    });
    expect(eventsAfter.length).toBe(eventsBefore + 1); // nada apagado
    expect(eventsAfter[eventsAfter.length - 1].type).toBe("REOPENED");
  });
});

describe("observações, prioridade, prazo e concorrência", () => {
  async function openReview(): Promise<{ id: string; version: number }> {
    const consultationId = await seedConsultation(operatorId);
    const created = await post("/api/reviews", adminToken, {
      consultationId,
      assignedToId: technicianId,
    });
    return { id: created.body.review.id, version: created.body.review.version };
  }

  it("adiciona observação (evento NOTE_ADDED), rejeita vazia/apenas espaços e acima do limite", async () => {
    const { id, version } = await openReview();
    const ok = await post(`/api/reviews/${id}/notes`, operatorToken, {
      note: "Cliente informou fachada nova",
      version,
    });
    expect(ok.status).toBe(200);
    expect(ok.body.review.version).toBe(version + 1);

    const blank = await post(`/api/reviews/${id}/notes`, operatorToken, {
      note: "    ",
      version: ok.body.review.version,
    });
    expect(blank.status).toBe(400);

    const tooLong = await post(`/api/reviews/${id}/notes`, operatorToken, {
      note: "x".repeat(3001),
      version: ok.body.review.version,
    });
    expect(tooLong.status).toBe(400);
  });

  it("altera prioridade e prazo (ADMIN) com eventos; TECHNICIAN não eleva para URGENT nem altera prazo", async () => {
    const { id, version } = await openReview();
    const highPriority = await patch(`/api/reviews/${id}`, adminToken, {
      priority: "HIGH",
      version,
    });
    expect(highPriority.status).toBe(200);

    const technicianUrgent = await patch(`/api/reviews/${id}`, technicianToken, {
      priority: "URGENT",
      version: highPriority.body.review.version,
    });
    expect(technicianUrgent.status).toBe(403);

    const technicianDue = await patch(`/api/reviews/${id}`, technicianToken, {
      dueAt: "2026-07-28T18:00:00.000Z",
      version: highPriority.body.review.version,
    });
    expect(technicianDue.status).toBe(403);

    const adminDue = await patch(`/api/reviews/${id}`, adminToken, {
      dueAt: "2026-07-28T18:00:00.000Z",
      version: highPriority.body.review.version,
    });
    expect(adminDue.status).toBe(200);
    const types = (
      await prisma.viabilityReviewEvent.findMany({ where: { reviewId: id } })
    ).map((event) => event.type);
    expect(types).toContain("PRIORITY_CHANGED");
    expect(types).toContain("DUE_DATE_CHANGED");
  });

  it("versão desatualizada responde 409 REVIEW_CONFLICT sem aplicar nada", async () => {
    const { id, version } = await openReview();
    await patch(`/api/reviews/${id}`, adminToken, { priority: "LOW", version });
    const stale = await patch(`/api/reviews/${id}`, adminToken, {
      priority: "URGENT",
      version, // desatualizada
    });
    expect(stale.status).toBe(409);
    expect(stale.body.error.code).toBe("REVIEW_CONFLICT");
    const review = await prisma.viabilityReview.findUniqueOrThrow({ where: { id } });
    expect(review.priority).toBe("LOW");
    expect(review.version).toBe(version + 1);
  });

  it("mutação e evento na MESMA transação: falha do evento não aplica a mutação", async () => {
    const { id, version } = await openReview();
    await prisma.$executeRawUnsafe('ALTER TABLE "viability_review_events" RENAME TO "vre_off"');
    try {
      const res = await post(`/api/reviews/${id}/notes`, operatorToken, {
        note: "não deve persistir",
        version,
      });
      expect(res.status).toBe(500);
      expect(res.body.error.code).toBe("REVIEW_QUERY_FAILED");
      const review = await prisma.viabilityReview.findUniqueOrThrow({ where: { id } });
      expect(review.version).toBe(version); // rollback completo
    } finally {
      await prisma.$executeRawUnsafe('ALTER TABLE "vre_off" RENAME TO "viability_review_events"');
    }
  });

  it("overdue é calculado (não persistido): prazo vencido em análise ativa e histórico após conclusão", async () => {
    const { id, version } = await openReview();
    await prisma.viabilityReview.update({
      where: { id },
      data: { dueAt: new Date(Date.now() - 3600 * 1000) },
    });
    const detail = await get(`/api/reviews/${id}`, adminToken);
    expect(detail.body.review.sla.overdue).toBe(true);
    expect(detail.body.review.sla.remainingMinutes).toBeLessThan(0);

    const started = await patch(`/api/reviews/${id}`, adminToken, {
      status: "IN_PROGRESS",
      version,
    });
    await post(`/api/reviews/${id}/resolve`, adminToken, {
      decision: "APPROVED",
      resolutionCode: "MANUAL_APPROVAL",
      resolutionSummary: "Aprovado fora do prazo.",
      version: started.body.review.version,
    });
    const resolved = await get(`/api/reviews/${id}`, adminToken);
    // Concluída FORA do prazo: historicamente calculável.
    expect(resolved.body.review.sla.resolvedWithinSla).toBe(false);
    expect(resolved.body.review.sla.remainingMinutes).toBeNull();
  });
});
