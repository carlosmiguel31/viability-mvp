import { afterAll, beforeAll, describe, expect, it } from "vitest";
import request from "supertest";
import { promises as fs } from "fs";
import { createApp } from "../src/app";
import { prisma, disconnectAppDatabase } from "../src/db/prisma";
import { env } from "../src/config/env";
import { coverageSnapshotStore } from "../src/stores/coverage-snapshot.store";
import { storageRoot } from "../src/services/coverage-storage.service";
import { cleanupConsultations, csvCell } from "../src/services/consultation.service";
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

let adminToken = "";
let operatorToken = "";

const ADDRESS = {
  postalCode: "30640-000",
  street: 'Rua "das Aspas"', // exercita o escape de aspas no CSV
  number: "=100", // exercita a proteção contra formula injection
  neighborhood: "Barreiro",
  city: "Belo Horizonte",
  state: "MG",
};

let operatorId = "";

async function check(adjusted: { latitude: number; longitude: number }) {
  const locationConfirmationToken = issueLocationConfirmationToken({
    userId: operatorId,
    address: normalizeAddressInput({ ...ADDRESS, country: "Brasil" }),
    geocoding: {
      provider: "dev",
      formattedAddress: "Rua Exemplo (dev)",
      confidence: "LOW",
      partialMatch: true,
      locationType: "UNKNOWN",
      latitude: -19.988,
      longitude: -44.018,
    },
  });
  return request(app)
    .post("/api/viabilities/confirm-location")
    .set("Authorization", `Bearer ${operatorToken}`)
    .send({ address: ADDRESS, adjustedLocation: adjusted, locationConfirmationToken });
}

beforeAll(async () => {
  await resetAppDatabase();
  await prisma.coverageLayer.deleteMany();
  await prisma.coveragePartner.deleteMany();
  coverageSnapshotStore.clear();
  await fs.rm(storageRoot(), { recursive: true, force: true });

  const admin = await createTestUser({ role: "ADMIN", email: "csv-admin@teste.local" });
  const operator = await createTestUser({ role: "OPERATOR", email: "csv-op@teste.local" });
  operatorId = operator.id;
  adminToken = (await loginAs(app, admin.email)).accessToken;
  operatorToken = (await loginAs(app, operator.email)).accessToken;

  const partner = await request(app)
    .post("/api/coverage/partners")
    .set("Authorization", `Bearer ${adminToken}`)
    .send({ name: "Rede Neutra", code: "REDE_NEUTRA" });
  await request(app)
    .post("/api/coverage/layers")
    .set("Authorization", `Bearer ${adminToken}`)
    .field("partnerId", partner.body.partner.id)
    .field("name", "Cobertura Barreiro")
    .field("version", "2026-07")
    .attach("file", Buffer.from(readFixtureKml()), "cobertura.kml");

  await check(POINT_INSIDE_BARREIRO);
  await check(POINT_OUTSIDE);
});

afterAll(async () => {
  await prisma.coverageLayer.deleteMany();
  await prisma.coveragePartner.deleteMany();
  coverageSnapshotStore.clear();
  await resetAppDatabase();
  await disconnectAppDatabase();
});

describe("exportação CSV", () => {
  it("é exclusiva de ADMIN (403 para OPERATOR)", async () => {
    const res = await request(app)
      .get("/api/consultations/export")
      .set("Authorization", `Bearer ${operatorToken}`);
    expect(res.status).toBe(403);
  });

  it("gera CSV com BOM, ponto e vírgula, aspas escapadas e proteção de fórmulas", async () => {
    const res = await request(app)
      .get("/api/consultations/export")
      .set("Authorization", `Bearer ${adminToken}`);
    expect(res.status).toBe(200);
    expect(res.headers["content-type"]).toContain("text/csv");
    expect(res.headers["content-disposition"]).toContain("consultas-viabilidade-");

    const body = res.text;
    expect(body.startsWith("\uFEFF")).toBe(true); // BOM UTF-8
    const [header, ...lines] = body.slice(1).split("\r\n");
    expect(header).toBe(
      "Protocolo;Data;Usuário;E-mail;Status;CEP;Logradouro;Número;Bairro;Cidade;UF;" +
        "Endereço localizado;Confiança;Confirmação manual;Latitude;Longitude;Parceiros;" +
        "Camadas;Referência de rede;Status da referência;Duração em ms"
    );
    expect(lines).toHaveLength(2);
    // Aspas duplicadas dentro de célula entre aspas:
    expect(body).toContain('"Rua ""das Aspas"""');
    // Formula injection neutralizada com apóstrofo:
    expect(body).toContain("'=100");
    // Conteúdo do snapshot presente e nada sensível:
    expect(body).toContain("Rede Neutra");
    expect(body).toContain("Cobertura Barreiro (2026-07)");
    for (const banned of ["storedFileName", "passwordHash", "polygons", "postgresql://"]) {
      expect(body).not.toContain(banned);
    }
    // Auditoria da exportação:
    const audit = await prisma.auditLog.findMany({
      where: { action: "VIABILITY_CONSULTATION_EXPORT_REQUESTED" },
    });
    expect(audit.length).toBeGreaterThanOrEqual(1);
    expect(audit[0].metadata).toMatchObject({ rowCount: 2 });
  });

  it("respeita os mesmos filtros da listagem", async () => {
    const res = await request(app)
      .get("/api/consultations/export?status=OUTSIDE_COVERAGE")
      .set("Authorization", `Bearer ${adminToken}`);
    const lines = res.text.slice(1).split("\r\n");
    expect(lines).toHaveLength(2); // cabeçalho + 1 linha
    expect(res.text).toContain("OUTSIDE_COVERAGE");
    expect(res.text).not.toContain("PRELIMINARILY_VIABLE");
  });

  it("respeita CONSULTATION_EXPORT_MAX_ROWS", async () => {
    const original = env.CONSULTATION_EXPORT_MAX_ROWS;
    (env as { CONSULTATION_EXPORT_MAX_ROWS: number }).CONSULTATION_EXPORT_MAX_ROWS = 1;
    try {
      const res = await request(app)
        .get("/api/consultations/export")
        .set("Authorization", `Bearer ${adminToken}`);
      expect(res.status).toBe(400);
      expect(res.body.error.code).toBe("CONSULTATION_EXPORT_LIMIT_EXCEEDED");
    } finally {
      (env as { CONSULTATION_EXPORT_MAX_ROWS: number }).CONSULTATION_EXPORT_MAX_ROWS = original;
    }
  });

  it("csvCell protege todos os prefixos perigosos", () => {
    expect(csvCell("=SUM(A1)")).toBe("'=SUM(A1)");
    expect(csvCell("+55 31")).toBe("'+55 31");
    expect(csvCell("-19,98")).toBe("'-19,98");
    expect(csvCell("@user")).toBe("'@user");
    expect(csvCell("linha1\nlinha2")).toBe('"linha1\nlinha2"');
    expect(csvCell('a"b')).toBe('"a""b"');
    expect(csvCell("valor;comum")).toBe('"valor;comum"');
    expect(csvCell(null)).toBe("");
  });
});

describe("retenção e cleanup", () => {
  it("dry-run conta expirados sem remover; execução real remove só os antigos", async () => {
    // Envelhece artificialmente uma consulta além da retenção:
    const rows = await prisma.viabilityConsultation.findMany({ orderBy: { createdAt: "asc" } });
    expect(rows.length).toBe(2);
    const oldDate = new Date(
      Date.now() - (env.CONSULTATION_RETENTION_DAYS + 10) * 24 * 60 * 60 * 1000
    );
    await prisma.viabilityConsultation.update({
      where: { id: rows[0].id },
      data: { createdAt: oldDate },
    });

    const dry = await cleanupConsultations({ dryRun: true });
    expect(dry.dryRun).toBe(true);
    expect(dry.expiredCount).toBe(1);
    expect(dry.removedCount).toBe(0);
    expect(await prisma.viabilityConsultation.count()).toBe(2); // nada removido

    const real = await cleanupConsultations({ dryRun: false, batchSize: 1 });
    expect(real.removedCount).toBe(1);
    const remaining = await prisma.viabilityConsultation.findMany();
    expect(remaining).toHaveLength(1);
    expect(remaining[0].id).toBe(rows[1].id); // registro recente preservado

    const audit = await prisma.auditLog.findMany({
      where: { action: "CONSULTATION_CLEANUP_EXECUTED" },
    });
    expect(audit).toHaveLength(1);
    expect(audit[0].metadata).toMatchObject({ removedCount: 1 });
  });
});
