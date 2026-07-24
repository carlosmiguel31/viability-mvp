import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import request from "supertest";
import { createApp } from "../src/app";
import { prisma, disconnectAppDatabase } from "../src/db/prisma";
import { env } from "../src/config/env";
import { maybeAutoCreateReview } from "../src/services/review.service";
import { createTestUser, loginAs, resetAppDatabase } from "./helpers";

const app = createApp();

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
  overrides: { city?: string; state?: string; status?: string } = {}
): Promise<{ id: string; protocol: string }> {
  seq += 1;
  const digits = String(seq).replace(/0/g, "A").replace(/1/g, "B");
  const protocol = `VIA-20260725-${`P${digits}`.padEnd(8, "Z").slice(0, 8)}`;
  const created = await prisma.viabilityConsultation.create({
    data: {
      protocol,
      userId,
      status: overrides.status ?? "PRELIMINARILY_VIABLE",
      resultMessage: "seed",
      street: "Rua Permissões",
      number: "5",
      city: overrides.city ?? "Belo Horizonte",
      state: overrides.state ?? "MG",
      geocodingProvider: "dev",
      coverageMatches: [] as never,
      coverageMatchCount: 0,
      coverageConfigured: true,
      networkReferenceStatus: "NOT_CHECKED",
      networkAlternatives: [] as never,
      durationMs: 100,
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

let viewerReviewId = "";
let overdueReviewId = "";

beforeAll(async () => {
  await resetAppDatabase();
  const admin = await createTestUser({ role: "ADMIN", email: "pm-admin@teste.local" });
  const technician = await createTestUser({ role: "TECHNICIAN", email: "pm-tec@teste.local" });
  const operator = await createTestUser({ role: "OPERATOR", email: "pm-op@teste.local" });
  const viewerUser = await createTestUser({ role: "VIEWER", email: "pm-view@teste.local" });
  technicianId = technician.id;
  operatorId = operator.id;
  viewerId = viewerUser.id;
  adminToken = (await loginAs(app, admin.email)).accessToken;
  technicianToken = (await loginAs(app, technician.email)).accessToken;
  operatorToken = (await loginAs(app, operator.email)).accessToken;
  viewerToken = (await loginAs(app, viewerUser.email)).accessToken;

  // Fila determinística:
  // 1) análise do OPERATOR, HIGH, atrasada, sem responsável.
  const late = await seedConsultation(operatorId, { city: "Contagem" });
  const lateReview = await post("/api/reviews", operatorToken, {
    consultationId: late.id,
    priority: "HIGH",
  });
  overdueReviewId = lateReview.body.review.id;
  await prisma.viabilityReview.update({
    where: { id: overdueReviewId },
    data: { dueAt: new Date(Date.now() - 3600 * 1000) },
  });
  // 2) análise atribuída ao TECHNICIAN, URGENT.
  const assigned = await seedConsultation(operatorId);
  await post("/api/reviews", adminToken, {
    consultationId: assigned.id,
    assignedToId: technicianId,
    priority: "URGENT",
  });
  // 3) análise de consulta do VIEWER (aberta por ADMIN).
  const own = await seedConsultation(viewerId);
  const viewerReview = await post("/api/reviews", adminToken, { consultationId: own.id });
  viewerReviewId = viewerReview.body.review.id;
});

afterAll(async () => {
  await resetAppDatabase();
  await disconnectAppDatabase();
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("permissões de visualização e criação", () => {
  it("ADMIN, TECHNICIAN e OPERATOR veem todas; VIEWER vê apenas as das próprias consultas", async () => {
    for (const token of [adminToken, technicianToken, operatorToken]) {
      const res = await get("/api/reviews", token);
      expect(res.status).toBe(200);
      expect(res.body.total).toBe(3);
    }
    const viewer = await get("/api/reviews", viewerToken);
    expect(viewer.body.total).toBe(1);
    expect(viewer.body.reviews[0].id).toBe(viewerReviewId);
  });

  it("VIEWER não abre análise alheia (404 anti-enumeração) e não cria/comenta", async () => {
    const foreign = await get(`/api/reviews/${overdueReviewId}`, viewerToken);
    expect(foreign.status).toBe(404);
    expect(foreign.body.error.code).toBe("REVIEW_NOT_FOUND");

    const consultation = await seedConsultation(viewerId);
    const create = await post("/api/reviews", viewerToken, { consultationId: consultation.id });
    expect(create.status).toBe(403);

    const note = await post(`/api/reviews/${viewerReviewId}/notes`, viewerToken, {
      note: "tentativa",
      version: 1,
    });
    expect(note.status).toBe(403);
  });

  it("OPERATOR cria análise mas não resolve, não cancela e não reabre", async () => {
    const consultation = await seedConsultation(operatorId);
    const created = await post("/api/reviews", operatorToken, {
      consultationId: consultation.id,
    });
    expect(created.status).toBe(201);
    const id = created.body.review.id;

    const resolve = await post(`/api/reviews/${id}/resolve`, operatorToken, {
      decision: "APPROVED",
      resolutionCode: "MANUAL_APPROVAL",
      resolutionSummary: "não permitido",
      version: 1,
    });
    expect(resolve.status).toBe(403);

    const cancel = await request(app)
      .patch(`/api/reviews/${id}`)
      .set("Authorization", `Bearer ${operatorToken}`)
      .send({ status: "CANCELLED", version: 1 });
    expect(cancel.status).toBe(403);

    const reopen = await post(`/api/reviews/${id}/reopen`, operatorToken, { version: 1 });
    expect(reopen.status).toBe(403);

    await prisma.viabilityReviewEvent.deleteMany({ where: { reviewId: id } });
    await prisma.viabilityReview.delete({ where: { id } });
  });
});

describe("listagem: filtros, paginação e ordenação", () => {
  it("filtra por status, prioridade, responsável, atraso, sem responsável e datas", async () => {
    const byStatus = await get("/api/reviews?status=OPEN", adminToken);
    expect(byStatus.body.total).toBe(3);

    const byPriority = await get("/api/reviews?priority=URGENT", adminToken);
    expect(byPriority.body.total).toBe(1);

    const byAssignee = await get(`/api/reviews?assignedToId=${technicianId}`, adminToken);
    expect(byAssignee.body.total).toBe(1);

    const overdue = await get("/api/reviews?overdue=true", adminToken);
    expect(overdue.body.total).toBe(1);
    expect(overdue.body.reviews[0].id).toBe(overdueReviewId);
    expect(overdue.body.reviews[0].sla.overdue).toBe(true);

    const unassigned = await get("/api/reviews?unassigned=true", adminToken);
    expect(unassigned.body.total).toBe(2);

    const tomorrow = new Date(Date.now() + 24 * 3600 * 1000).toISOString().slice(0, 10);
    const byDate = await get(`/api/reviews?dateTo=${tomorrow}`, adminToken);
    expect(byDate.body.total).toBe(3);

    const byCity = await get("/api/reviews?city=contagem", adminToken);
    expect(byCity.body.total).toBe(1);

    const search = await get("/api/reviews?search=Permiss", adminToken);
    expect(search.body.total).toBe(3);
  });

  it("pagina (padrão 20, máx 100) e ordena por campos permitidos; inválidos → REVIEW_INVALID_FILTER", async () => {
    const page = await get("/api/reviews?limit=2&page=2&sortBy=createdAt&sortOrder=asc", adminToken);
    expect(page.body.reviews).toHaveLength(1);
    expect(page.body.limit).toBe(2);

    const badSort = await get("/api/reviews?sortBy=resolutionSummary", adminToken);
    expect(badSort.status).toBe(400);
    expect(badSort.body.error.code).toBe("REVIEW_INVALID_FILTER");

    const badLimit = await get("/api/reviews?limit=101", adminToken);
    expect(badLimit.status).toBe(400);
  });
});

describe("resumo da fila", () => {
  it("retorna contagens por status/prioridade, atrasadas, sem responsável e atribuídas a mim", async () => {
    const res = await get("/api/reviews/summary", technicianToken);
    expect(res.status).toBe(200);
    expect(res.body.total).toBe(3);
    expect(res.body.open).toBe(3);
    expect(res.body.overdue).toBe(1);
    expect(res.body.unassigned).toBe(2);
    expect(res.body.assignedToMe).toBe(1); // atribuída ao TECHNICIAN
    expect(res.body.byPriority).toMatchObject({ high: 1, urgent: 1, normal: 1, low: 0 });
  });

  it("VIEWER recebe o resumo apenas das próprias consultas", async () => {
    const res = await get("/api/reviews/summary", viewerToken);
    expect(res.body.total).toBe(1);
    expect(res.body.unassigned).toBe(1);
    expect(res.body.assignedToMe).toBe(0);
  });
});

describe("criação automática", () => {
  it("desativada por padrão: nada é criado", async () => {
    const consultation = await seedConsultation(operatorId, { status: "ADDRESS_AMBIGUOUS" });
    await maybeAutoCreateReview({
      id: consultation.id,
      protocol: consultation.protocol,
      status: "ADDRESS_AMBIGUOUS",
      userId: operatorId,
    });
    expect(
      await prisma.viabilityReview.count({ where: { consultationId: consultation.id } })
    ).toBe(0);
  });

  it("ativada: cria para status configurado, com SLA, sem responsável, evento CREATED com metadata auto — e é idempotente", async () => {
    const consultation = await seedConsultation(operatorId, { status: "ADDRESS_AMBIGUOUS" });
    const enabledSpy = vi
      .spyOn(env, "REVIEW_AUTO_CREATE_ENABLED", "get")
      .mockReturnValue(true);
    try {
      const input = {
        id: consultation.id,
        protocol: consultation.protocol,
        status: "ADDRESS_AMBIGUOUS",
        userId: operatorId,
      };
      await maybeAutoCreateReview(input);
      await maybeAutoCreateReview(input); // idempotente
      const reviews = await prisma.viabilityReview.findMany({
        where: { consultationId: consultation.id },
        include: { events: true },
      });
      expect(reviews).toHaveLength(1);
      expect(reviews[0].assignedToId).toBeNull();
      expect(reviews[0].priority).toBe("NORMAL");
      expect(reviews[0].dueAt).toBeTruthy();
      expect(reviews[0].events).toHaveLength(1);
      expect(reviews[0].events[0].type).toBe("CREATED");
      expect(reviews[0].events[0].metadata).toMatchObject({ auto: true });

      // Status fora da lista: nada.
      const other = await seedConsultation(operatorId);
      await maybeAutoCreateReview({
        id: other.id,
        protocol: other.protocol,
        status: "PRELIMINARILY_VIABLE",
        userId: operatorId,
      });
      expect(await prisma.viabilityReview.count({ where: { consultationId: other.id } })).toBe(0);
    } finally {
      enabledSpy.mockRestore();
    }
  });

  it("uma falha na criação automática não apaga a consulta histórica", async () => {
    const enabledSpy = vi.spyOn(env, "REVIEW_AUTO_CREATE_ENABLED", "get").mockReturnValue(true);
    await prisma.$executeRawUnsafe('ALTER TABLE "viability_reviews" RENAME TO "vr_off"');
    try {
      // Fluxo HTTP real: a consulta persiste e responde 200 mesmo com a
      // criação automática quebrada.
      const res = await request(app)
        .post("/api/viabilities/check")
        .set("Authorization", `Bearer ${operatorToken}`)
        .send({
          address: { street: "Rua Auto", number: "1", city: "Belo Horizonte", state: "MG" },
        });
      expect(res.status).toBe(200);
      expect(res.body.consultation.protocol).toMatch(/^VIA-/);
      const consultation = await prisma.viabilityConsultation.findFirst({
        where: { street: "Rua Auto" },
      });
      expect(consultation).toBeTruthy(); // histórica intacta
      expect(JSON.stringify(res.body)).not.toContain("stack");
    } finally {
      await prisma.$executeRawUnsafe('ALTER TABLE "vr_off" RENAME TO "viability_reviews"');
      enabledSpy.mockRestore();
    }
  });
});

describe("auditoria e privacidade", () => {
  it("ações geram eventos de auditoria com metadados seguros; o texto da observação NÃO vai ao AuditLog", async () => {
    await prisma.auditLog.deleteMany();
    const consultation = await seedConsultation(operatorId);
    const created = await post("/api/reviews", adminToken, {
      consultationId: consultation.id,
      assignedToId: technicianId,
    });
    const id = created.body.review.id;
    const secret = "Observação sigilosa do cliente XPTO";
    await post(`/api/reviews/${id}/notes`, adminToken, { note: secret, version: 1 });

    const audits = await prisma.auditLog.findMany({ orderBy: { createdAt: "asc" } });
    const actions = audits.map((audit) => audit.action);
    expect(actions).toContain("REVIEW_CREATED");
    expect(actions).toContain("REVIEW_ASSIGNED");
    expect(actions).toContain("REVIEW_NOTE_ADDED");
    const serialized = JSON.stringify(audits);
    expect(serialized).toContain(consultation.protocol);
    expect(serialized).not.toContain(secret);
    expect(serialized).not.toContain("XPTO");
  });

  it("detalhes não expõem dados sensíveis e a linha do tempo vem em ordem cronológica", async () => {
    const detail = await get(`/api/reviews/${overdueReviewId}`, adminToken);
    expect(detail.status).toBe(200);
    const serialized = JSON.stringify(detail.body);
    for (const forbidden of [
      "passwordHash",
      "storedFileName",
      "latitude",
      "longitude",
      "polygon",
      "stack",
    ]) {
      expect(serialized).not.toContain(forbidden);
    }
    const events = detail.body.review.events as Array<{ createdAt: string }>;
    const sorted = [...events].sort(
      (a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime()
    );
    expect(events).toEqual(sorted);
  });

  it("falha inesperada do Prisma responde REVIEW_QUERY_FAILED sem detalhes internos", async () => {
    vi.spyOn(prisma.viabilityReview, "findMany").mockRejectedValue(
      new Error('relation "secreta" does not exist')
    );
    const res = await get("/api/reviews", adminToken);
    expect(res.status).toBe(500);
    expect(res.body.error.code).toBe("REVIEW_QUERY_FAILED");
    expect(JSON.stringify(res.body)).not.toContain("relation");
  });
});
