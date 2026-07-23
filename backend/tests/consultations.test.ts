import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import request from "supertest";
import { promises as fs } from "fs";
import { createApp } from "../src/app";
import { prisma, disconnectAppDatabase } from "../src/db/prisma";
import { coverageSnapshotStore } from "../src/stores/coverage-snapshot.store";
import { storageRoot } from "../src/services/coverage-storage.service";
import { generateProtocol, PROTOCOL_PATTERN } from "../src/utils/protocol";
import {
  createTestUser,
  loginAs,
  POINT_INSIDE_BARREIRO,
  POINT_OUTSIDE,
  readFixtureKml,
  resetAppDatabase,
} from "./helpers";
import { issueLocationConfirmationToken } from "../src/services/location-confirmation.service";
import { normalizeAddressInput } from "../src/services/address.service";

const app = createApp();

const ADDRESS = {
  postalCode: "30640-000",
  street: "Rua Exemplo",
  number: "100",
  neighborhood: "Barreiro",
  city: "Belo Horizonte",
  state: "MG",
};

async function resetCoverage(): Promise<void> {
  await prisma.coverageLayer.deleteMany();
  await prisma.coveragePartner.deleteMany();
  coverageSnapshotStore.clear();
  await fs.rm(storageRoot(), { recursive: true, force: true });
}

let adminToken = "";
let operatorToken = "";
let technicianToken = "";
let viewerToken = "";
let viewerId = "";
let operatorId = "";

/** Token de confirmacao valido para o ADDRESS padrao (emitido pelo backend). */
function tokenFor(userId: string) {
  return issueLocationConfirmationToken({
    userId,
    address: normalizeAddressInput({ ...ADDRESS, country: "Brasil" }),
    geocoding: {
      provider: "dev",
      formattedAddress: "Rua Exemplo, 100 - Belo Horizonte/MG (dev)",
      confidence: "LOW",
      partialMatch: true,
      locationType: "UNKNOWN",
      latitude: -19.988,
      longitude: -44.018,
    },
  });
}

async function seedUsers(): Promise<void> {
  const admin = await createTestUser({ role: "ADMIN", email: "hist-admin@teste.local" });
  const operator = await createTestUser({ role: "OPERATOR", email: "hist-op@teste.local" });
  operatorId = operator.id;
  const technician = await createTestUser({
    role: "TECHNICIAN",
    email: "hist-tec@teste.local",
  });
  const viewer = await createTestUser({ role: "VIEWER", email: "hist-view@teste.local" });
  viewerId = viewer.id;
  adminToken = (await loginAs(app, admin.email)).accessToken;
  operatorToken = (await loginAs(app, operator.email)).accessToken;
  technicianToken = (await loginAs(app, technician.email)).accessToken;
  viewerToken = (await loginAs(app, viewer.email)).accessToken;
}

async function uploadLayerViaApi(options: {
  name: string;
  code: string;
  version?: string;
}): Promise<{ partnerId: string; layerId: string }> {
  const partnerRes = await request(app)
    .post("/api/coverage/partners")
    .set("Authorization", `Bearer ${adminToken}`)
    .send({ name: `Parceiro ${options.code}`, code: options.code });
  const partnerId = partnerRes.body.partner.id as string;
  const req = request(app)
    .post("/api/coverage/layers")
    .set("Authorization", `Bearer ${adminToken}`)
    .field("partnerId", partnerId)
    .field("name", options.name);
  if (options.version) req.field("version", options.version);
  const layerRes = await req.attach("file", Buffer.from(readFixtureKml()), "cobertura.kml");
  return { partnerId, layerId: layerRes.body.layer.id as string };
}

function checkAs(
  token: string,
  adjusted?: { latitude: number; longitude: number },
  confirmationUserId?: string
) {
  return request(app)
    .post(adjusted ? "/api/viabilities/confirm-location" : "/api/viabilities/check")
    .set("Authorization", `Bearer ${token}`)
    .send({
      address: ADDRESS,
      ...(adjusted
        ? {
            adjustedLocation: adjusted,
            locationConfirmationToken: tokenFor(confirmationUserId ?? operatorId),
          }
        : {}),
    });
}

describe("protocolo", () => {
  it("respeita o formato VIA-AAAAMMDD-XXXXXXXX e não repete em série", () => {
    const seen = new Set<string>();
    for (let index = 0; index < 200; index += 1) {
      const protocol = generateProtocol(new Date("2026-07-23T12:00:00Z"));
      expect(protocol).toMatch(PROTOCOL_PATTERN);
      expect(protocol.startsWith("VIA-20260723-")).toBe(true);
      seen.add(protocol);
    }
    expect(seen.size).toBe(200); // sufixo aleatório seguro, não contagem
  });
});

describe("persistência das consultas", () => {
  beforeAll(async () => {
    await resetAppDatabase();
    await resetCoverage();
    await seedUsers();
    await uploadLayerViaApi({ name: "Cobertura Barreiro", code: "REDE_NEUTRA", version: "2026-07" });
  });
  afterAll(async () => {
    await resetCoverage();
    await resetAppDatabase();
  });
  beforeEach(async () => {
    await prisma.viabilityConsultation.deleteMany();
    await prisma.auditLog.deleteMany();
  });

  it("consulta viável é persistida com protocolo, snapshot e auditoria — 1 requisição = 1 registro", async () => {
    const res = await checkAs(operatorToken, POINT_INSIDE_BARREIRO);
    expect(res.status).toBe(200);
    expect(res.body.status).toBe("PRELIMINARILY_VIABLE");
    expect(res.body.consultation.protocol).toMatch(PROTOCOL_PATTERN);
    expect(res.body.consultation.id).toBeTruthy();

    const rows = await prisma.viabilityConsultation.findMany();
    expect(rows).toHaveLength(1); // exatamente um registro por requisição
    const row = rows[0];
    expect(row.protocol).toBe(res.body.consultation.protocol);
    expect(row.status).toBe("PRELIMINARILY_VIABLE");
    expect(row.city).toBe("Belo Horizonte");
    expect(row.locationConfirmedManually).toBe(true);
    expect(row.coverageMatchCount).toBe(1);
    const matches = row.coverageMatches as Array<Record<string, unknown>>;
    expect(matches[0]).toMatchObject({
      partnerName: "Parceiro REDE_NEUTRA",
      partnerCode: "REDE_NEUTRA",
      layerName: "Cobertura Barreiro",
      version: "2026-07",
    });
    // Nenhum dado sensível no snapshot.
    const serialized = JSON.stringify(row);
    expect(serialized).not.toContain("storedFileName");
    expect(serialized).not.toContain("polygons");

    const audit = await prisma.auditLog.findMany({
      where: { action: "VIABILITY_CONSULTATION_CREATED" },
    });
    expect(audit).toHaveLength(1);
    expect(audit[0].metadata).toMatchObject({ protocol: row.protocol, coverageMatchCount: 1 });
  });

  it("consulta fora da cobertura é persistida", async () => {
    const res = await checkAs(viewerToken, POINT_OUTSIDE, viewerId);
    expect(res.body.status).toBe("OUTSIDE_COVERAGE");
    expect(res.body.consultation.protocol).toMatch(PROTOCOL_PATTERN);
    const row = await prisma.viabilityConsultation.findFirstOrThrow();
    expect(row.status).toBe("OUTSIDE_COVERAGE");
    expect(row.coverageMatchCount).toBe(0);
    expect(row.userId).toBe(viewerId);
  });

  it("ADDRESS_AMBIGUOUS (geocoder dev LOW) é persistido com confirmationRequired", async () => {
    const res = await checkAs(operatorToken); // sem adjustedLocation
    expect(res.status).toBe(200);
    expect(res.body.status).toBe("ADDRESS_AMBIGUOUS");
    expect(res.body.consultation.protocol).toMatch(PROTOCOL_PATTERN);
    const row = await prisma.viabilityConsultation.findFirstOrThrow();
    expect(row.status).toBe("ADDRESS_AMBIGUOUS");
    expect(row.confirmationRequired).toBe(true);
    expect(row.locationConfirmedManually).toBe(false);
  });

  it("snapshot histórico sobrevive a renomear, inativar e excluir a camada", async () => {
    const res = await checkAs(operatorToken, POINT_INSIDE_BARREIRO);
    const consultationId = res.body.consultation.id as string;

    const layer = await prisma.coverageLayer.findFirstOrThrow();
    // Renomeia camada e parceiro:
    await request(app)
      .patch(`/api/coverage/layers/${layer.id}`)
      .set("Authorization", `Bearer ${adminToken}`)
      .send({ name: "Nome novo qualquer" });
    // Inativa:
    await request(app)
      .patch(`/api/coverage/layers/${layer.id}/status`)
      .set("Authorization", `Bearer ${adminToken}`)
      .send({ active: false });
    // Exclui:
    await request(app)
      .delete(`/api/coverage/layers/${layer.id}`)
      .set("Authorization", `Bearer ${adminToken}`);

    const detail = await request(app)
      .get(`/api/consultations/${consultationId}`)
      .set("Authorization", `Bearer ${adminToken}`);
    expect(detail.status).toBe(200);
    const matches = detail.body.consultation.coverage.matches as Array<Record<string, unknown>>;
    expect(matches[0].layerName).toBe("Cobertura Barreiro"); // nome da ÉPOCA
    expect(matches[0].partnerName).toBe("Parceiro REDE_NEUTRA");
    // recria a camada para os demais testes
    await uploadLayerViaApi({ name: "Cobertura Barreiro", code: "REDE_2", version: "2026-07" });
  });

  it("COVERAGE_NOT_CONFIGURED é persistido quando não há camadas", async () => {
    const saved = coverageSnapshotStore.getLayers().slice();
    coverageSnapshotStore.clear();
    try {
      const res = await checkAs(operatorToken, POINT_INSIDE_BARREIRO);
      expect(res.body.status).toBe("COVERAGE_NOT_CONFIGURED");
      expect(res.body.consultation.protocol).toMatch(PROTOCOL_PATTERN);
      const row = await prisma.viabilityConsultation.findFirstOrThrow();
      expect(row.status).toBe("COVERAGE_NOT_CONFIGURED");
      expect(row.coverageConfigured).toBe(false);
    } finally {
      coverageSnapshotStore.replaceAll(saved);
    }
  });

  it("referência do Voalle indisponível é registrada sem dados privados", async () => {
    const res = await checkAs(operatorToken, POINT_INSIDE_BARREIRO);
    expect(res.body.networkReferenceStatus).toBe("VOALLE_UNAVAILABLE");
    const row = await prisma.viabilityConsultation.findFirstOrThrow();
    expect(row.networkReferenceStatus).toBe("VOALLE_UNAVAILABLE");
    expect(row.networkReference).toBeNull();
    const serialized = JSON.stringify(row);
    for (const banned of ["SPLITTER", "ROTA", "COLETOR", "password", "postgresql://"]) {
      expect(serialized).not.toContain(banned);
    }
  });

  it("falha na persistência responde CONSULTATION_HISTORY_SAVE_FAILED sem protocolo", async () => {
    // Sabotagem determinística: um registro pré-existente conflita com TODOS
    // os protocolos? Não é possível prever o sufixo — em vez disso, quebramos
    // a gravação removendo a tabela em uma transação de rename temporário.
    await prisma.$executeRawUnsafe(
      'ALTER TABLE "viability_consultations" RENAME TO "viability_consultations_off"'
    );
    try {
      const res = await checkAs(operatorToken, POINT_INSIDE_BARREIRO);
      expect(res.status).toBe(500);
      expect(res.body.error.code).toBe("CONSULTATION_HISTORY_SAVE_FAILED");
      expect(JSON.stringify(res.body)).not.toContain("protocol");
      expect(JSON.stringify(res.body)).not.toMatch(/\sat\s.+\.ts/); // sem stack
    } finally {
      await prisma.$executeRawUnsafe(
        'ALTER TABLE "viability_consultations_off" RENAME TO "viability_consultations"'
      );
    }
  });
});

describe("listagem, permissões e filtros", () => {
  let operatorConsultationId = "";
  let viewerConsultationId = "";
  let viewerProtocol = "";

  beforeAll(async () => {
    await resetAppDatabase();
    await resetCoverage();
    await seedUsers();
    await uploadLayerViaApi({ name: "Cobertura Barreiro", code: "REDE_NEUTRA" });

    const first = await checkAs(operatorToken, POINT_INSIDE_BARREIRO);
    operatorConsultationId = first.body.consultation.id;
    await checkAs(operatorToken, POINT_OUTSIDE);
    const third = await checkAs(viewerToken, POINT_INSIDE_BARREIRO, viewerId);
    viewerConsultationId = third.body.consultation.id;
    viewerProtocol = third.body.consultation.protocol;
  });
  afterAll(async () => {
    await resetCoverage();
    await resetAppDatabase();
    await disconnectAppDatabase();
  });

  it("ADMIN, OPERATOR e TECHNICIAN listam todas; resumo sem JSONs detalhados", async () => {
    for (const token of [adminToken, operatorToken, technicianToken]) {
      const res = await request(app)
        .get("/api/consultations")
        .set("Authorization", `Bearer ${token}`);
      expect(res.status).toBe(200);
      expect(res.body.total).toBe(3);
      expect(res.body.consultations).toHaveLength(3);
      const item = res.body.consultations[0];
      expect(item.protocol).toMatch(PROTOCOL_PATTERN);
      expect(item.coverageMatchCount).toBeDefined();
      expect(item.address.city).toBe("Belo Horizonte");
      expect(item.user.name).toBeTruthy();
      expect(item.coverageMatches).toBeUndefined(); // detalhes só no endpoint individual
      expect(item.networkAlternatives).toBeUndefined();
    }
  });

  it("VIEWER lista somente as próprias consultas", async () => {
    const res = await request(app)
      .get("/api/consultations")
      .set("Authorization", `Bearer ${viewerToken}`);
    expect(res.body.total).toBe(1);
    expect(res.body.consultations[0].id).toBe(viewerConsultationId);
  });

  it("VIEWER não abre consulta alheia (resposta segura de inexistente)", async () => {
    const res = await request(app)
      .get(`/api/consultations/${operatorConsultationId}`)
      .set("Authorization", `Bearer ${viewerToken}`);
    expect(res.status).toBe(404);
    expect(res.body.error.code).toBe("CONSULTATION_NOT_FOUND");
    // A própria consulta abre normalmente (também por protocolo):
    const own = await request(app)
      .get(`/api/consultations/protocol/${viewerProtocol}`)
      .set("Authorization", `Bearer ${viewerToken}`);
    expect(own.status).toBe(200);
    expect(own.body.consultation.id).toBe(viewerConsultationId);
  });

  it("consulta inexistente retorna CONSULTATION_NOT_FOUND", async () => {
    const res = await request(app)
      .get("/api/consultations/00000000-0000-4000-8000-000000000000")
      .set("Authorization", `Bearer ${adminToken}`);
    expect(res.status).toBe(404);
    expect(res.body.error.code).toBe("CONSULTATION_NOT_FOUND");
  });

  it("filtros: protocolo, status, usuário, CEP, cidade, cobertura e referência de rede", async () => {
    const byProtocol = await request(app)
      .get(`/api/consultations?protocol=${viewerProtocol.toLowerCase()}`)
      .set("Authorization", `Bearer ${adminToken}`);
    expect(byProtocol.body.total).toBe(1);
    expect(byProtocol.body.consultations[0].protocol).toBe(viewerProtocol);

    const byStatus = await request(app)
      .get("/api/consultations?status=OUTSIDE_COVERAGE")
      .set("Authorization", `Bearer ${adminToken}`);
    expect(byStatus.body.total).toBe(1);

    const byUser = await request(app)
      .get(`/api/consultations?userId=${viewerId}`)
      .set("Authorization", `Bearer ${adminToken}`);
    expect(byUser.body.total).toBe(1);

    const byPostal = await request(app)
      .get("/api/consultations?postalCode=30640-000")
      .set("Authorization", `Bearer ${adminToken}`);
    expect(byPostal.body.total).toBe(3);

    const byCity = await request(app)
      .get("/api/consultations?city=belo")
      .set("Authorization", `Bearer ${adminToken}`);
    expect(byCity.body.total).toBe(3);

    const withCoverage = await request(app)
      .get("/api/consultations?hasCoverage=true")
      .set("Authorization", `Bearer ${adminToken}`);
    expect(withCoverage.body.total).toBe(2);
    const withoutCoverage = await request(app)
      .get("/api/consultations?hasCoverage=false")
      .set("Authorization", `Bearer ${adminToken}`);
    expect(withoutCoverage.body.total).toBe(1);

    const byReference = await request(app)
      .get("/api/consultations?networkReferenceStatus=VOALLE_UNAVAILABLE")
      .set("Authorization", `Bearer ${adminToken}`);
    expect(byReference.body.total).toBe(2); // OUTSIDE não consulta o Voalle
  });

  it("busca geral encontra por rua e por nome do responsável", async () => {
    const byStreet = await request(app)
      .get("/api/consultations?search=exemplo")
      .set("Authorization", `Bearer ${adminToken}`);
    expect(byStreet.body.total).toBe(3);
    const byUserName = await request(app)
      .get("/api/consultations?search=hist-view")
      .set("Authorization", `Bearer ${adminToken}`);
    expect(byUserName.body.total).toBe(0); // e-mail não entra na busca
    const byName = await request(app)
      .get("/api/consultations?search=Usuário")
      .set("Authorization", `Bearer ${adminToken}`);
    expect(byName.body.total).toBe(3); // nome padrão dos usuários de teste
  });

  it("filtro por data inclui o dia inteiro e valida intervalo invertido", async () => {
    const today = new Date().toISOString().slice(0, 10);
    const res = await request(app)
      .get(`/api/consultations?dateFrom=${today}&dateTo=${today}`)
      .set("Authorization", `Bearer ${adminToken}`);
    expect(res.body.total).toBe(3);

    const inverted = await request(app)
      .get("/api/consultations?dateFrom=2026-07-24&dateTo=2026-07-01")
      .set("Authorization", `Bearer ${adminToken}`);
    expect(inverted.status).toBe(400);
    expect(inverted.body.error.code).toBe("CONSULTATION_INVALID_DATE_RANGE");
  });

  it("paginação e ordenação asc/desc", async () => {
    const pageOne = await request(app)
      .get("/api/consultations?page=1&limit=2")
      .set("Authorization", `Bearer ${adminToken}`);
    expect(pageOne.body.consultations).toHaveLength(2);
    const pageTwo = await request(app)
      .get("/api/consultations?page=2&limit=2")
      .set("Authorization", `Bearer ${adminToken}`);
    expect(pageTwo.body.consultations).toHaveLength(1);

    const asc = await request(app)
      .get("/api/consultations?sortOrder=asc")
      .set("Authorization", `Bearer ${adminToken}`);
    const desc = await request(app)
      .get("/api/consultations?sortOrder=desc")
      .set("Authorization", `Bearer ${adminToken}`);
    expect(asc.body.consultations[0].id).toBe(
      desc.body.consultations[desc.body.consultations.length - 1].id
    );
  });

  it("detalhes completos vêm no endpoint individual, sem campos sensíveis", async () => {
    const res = await request(app)
      .get(`/api/consultations/${operatorConsultationId}`)
      .set("Authorization", `Bearer ${operatorToken}`);
    expect(res.status).toBe(200);
    const detail = res.body.consultation;
    expect(detail.protocol).toMatch(PROTOCOL_PATTERN);
    expect(detail.address.street).toBe("Rua Exemplo");
    expect(detail.coverage.matches).toHaveLength(1);
    expect(detail.confirmation.confirmedManually).toBe(true);
    expect(detail.network.status).toBe("VOALLE_UNAVAILABLE");
    const serialized = JSON.stringify(res.body);
    for (const banned of ["storedFileName", "passwordHash", "tokenHash", "polygons"]) {
      expect(serialized).not.toContain(banned);
    }
  });
});
