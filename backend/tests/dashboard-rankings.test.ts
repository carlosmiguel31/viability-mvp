import { afterAll, beforeAll, describe, expect, it } from "vitest";
import request from "supertest";
import { promises as fs } from "fs";
import { readFileSync, readdirSync } from "fs";
import path from "path";
import { Client } from "pg";
import { createApp } from "../src/app";
import { prisma, disconnectAppDatabase } from "../src/db/prisma";
import { coverageSnapshotStore } from "../src/stores/coverage-snapshot.store";
import { storageRoot } from "../src/services/coverage-storage.service";
import { issueLocationConfirmationToken } from "../src/services/location-confirmation.service";
import { normalizeAddressInput } from "../src/services/address.service";
import {
  createTestUser,
  loginAs,
  POINT_INSIDE_BARREIRO,
  readFixtureKml,
  resetAppDatabase,
} from "./helpers";

const app = createApp();

const ADDRESS = {
  postalCode: "30640-000",
  street: "Rua Ranking",
  number: "77",
  neighborhood: "Barreiro",
  city: "Belo Horizonte",
  state: "MG",
};

let adminToken = "";
let operatorToken = "";
let viewerToken = "";
let operatorId = "";
let viewerId = "";

async function realConsultation(token: string, userId: string) {
  const locationConfirmationToken = issueLocationConfirmationToken({
    userId,
    address: normalizeAddressInput({ ...ADDRESS, country: "Brasil" }),
    geocoding: {
      provider: "dev",
      formattedAddress: "Rua Ranking, 77 (dev)",
      confidence: "LOW",
      partialMatch: true,
      locationType: "UNKNOWN",
      latitude: -19.988,
      longitude: -44.018,
    },
  });
  return request(app)
    .post("/api/viabilities/confirm-location")
    .set("Authorization", `Bearer ${token}`)
    .send({
      address: ADDRESS,
      adjustedLocation: POINT_INSIDE_BARREIRO,
      locationConfirmationToken,
    });
}

beforeAll(async () => {
  await resetAppDatabase();
  await prisma.coverageLayer.deleteMany();
  await prisma.coveragePartner.deleteMany();
  coverageSnapshotStore.clear();
  await fs.rm(storageRoot(), { recursive: true, force: true });

  const admin = await createTestUser({ role: "ADMIN", email: "rank-admin@teste.local" });
  const operator = await createTestUser({ role: "OPERATOR", email: "rank-op@teste.local" });
  const viewerUser = await createTestUser({ role: "VIEWER", email: "rank-view@teste.local" });
  operatorId = operator.id;
  viewerId = viewerUser.id;
  adminToken = (await loginAs(app, admin.email)).accessToken;
  operatorToken = (await loginAs(app, operator.email)).accessToken;
  viewerToken = (await loginAs(app, viewerUser.email)).accessToken;

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
});

afterAll(async () => {
  await prisma.coverageLayer.deleteMany();
  await prisma.coveragePartner.deleteMany();
  coverageSnapshotStore.clear();
  await resetAppDatabase();
  await disconnectAppDatabase();
});

describe("projeção relacional na persistência real", () => {
  it("nova consulta cria a projeção na MESMA transação da consulta", async () => {
    await prisma.viabilityConsultation.deleteMany();
    const res = await realConsultation(operatorToken, operatorId);
    expect(res.status).toBe(200);
    const consultation = await prisma.viabilityConsultation.findFirstOrThrow({
      include: { coverageMatchProjections: true },
    });
    expect(consultation.coverageMatchProjections).toHaveLength(1);
    const projection = consultation.coverageMatchProjections[0];
    expect(projection.partnerNameSnapshot).toBe("Rede Neutra");
    expect(projection.partnerCodeSnapshot).toBe("REDE_NEUTRA");
    expect(projection.layerNameSnapshot).toBe("Cobertura Barreiro");
    expect(projection.versionSnapshot).toBe("2026-07");
    // O Json original continua intacto (compatibilidade):
    const json = consultation.coverageMatches as Array<Record<string, unknown>>;
    expect(json[0].layerName).toBe("Cobertura Barreiro");
  });

  it("falha na projeção não deixa consulta parcialmente persistida (transação)", async () => {
    await prisma.viabilityConsultation.deleteMany();
    // Sabotagem: renomeia a tabela de projeção para forçar a falha DENTRO da
    // transação; a consulta não pode sobrar salva.
    await prisma.$executeRawUnsafe(
      'ALTER TABLE "viability_consultation_coverage_matches" RENAME TO "vccm_off"'
    );
    try {
      const res = await realConsultation(operatorToken, operatorId);
      expect(res.status).toBe(500);
      expect(res.body.error.code).toBe("CONSULTATION_HISTORY_SAVE_FAILED");
      expect(await prisma.viabilityConsultation.count()).toBe(0); // nada parcial
    } finally {
      await prisma.$executeRawUnsafe(
        'ALTER TABLE "vccm_off" RENAME TO "viability_consultation_coverage_matches"'
      );
    }
  });
});

describe("rankings", () => {
  beforeAll(async () => {
    await prisma.viabilityConsultation.deleteMany();
    await realConsultation(operatorToken, operatorId);
    await realConsultation(operatorToken, operatorId);
    await realConsultation(viewerToken, viewerId);
  });

  it("parceiros, camadas e cidades com contagens; usuários para ADMIN", async () => {
    const res = await request(app)
      .get("/api/dashboard/rankings?preset=LAST_7_DAYS")
      .set("Authorization", `Bearer ${adminToken}`);
    expect(res.status).toBe(200);

    expect(res.body.partners[0]).toMatchObject({
      partnerCode: "REDE_NEUTRA",
      partnerName: "Rede Neutra",
      matchCount: 3,
      consultationCount: 3,
    });
    expect(res.body.layers[0]).toMatchObject({
      layerName: "Cobertura Barreiro",
      partnerName: "Rede Neutra",
      version: "2026-07",
      matchCount: 3,
    });
    expect(res.body.cities[0]).toMatchObject({
      city: "Belo Horizonte",
      state: "MG",
      consultationCount: 3,
      preliminarilyViableCount: 3,
      coverageRate: 1,
    });
    const userRow = res.body.users.find(
      (item: { userId: string }) => item.userId === operatorId
    )!;
    expect(userRow.consultationCount).toBe(2);
    expect(userRow.email).toBe("rank-op@teste.local");

    // Sem dados de endereço detalhado nos rankings:
    const serialized = JSON.stringify(res.body);
    expect(serialized).not.toContain('"postalCode"');
    expect(serialized).not.toContain('"number"');
    expect(serialized).not.toContain("latitude");
  });

  it("VIEWER não recebe ranking de usuários e o escopo é apenas o próprio", async () => {
    const res = await request(app)
      .get("/api/dashboard/rankings?preset=LAST_7_DAYS")
      .set("Authorization", `Bearer ${viewerToken}`);
    expect(res.body.users).toEqual([]);
    expect(res.body.partners[0].matchCount).toBe(1); // só a própria consulta
    expect(JSON.stringify(res.body)).not.toContain("rank-op@teste.local");
  });

  it("limit é respeitado (máximo 25)", async () => {
    const res = await request(app)
      .get("/api/dashboard/rankings?preset=LAST_7_DAYS&limit=1")
      .set("Authorization", `Bearer ${adminToken}`);
    expect(res.body.partners.length).toBeLessThanOrEqual(1);
    const invalid = await request(app)
      .get("/api/dashboard/rankings?preset=LAST_7_DAYS&limit=999")
      .set("Authorization", `Bearer ${adminToken}`);
    expect(invalid.status).toBe(400); // Zod max(25)
    expect(invalid.body.error.code).toBe("DASHBOARD_INVALID_FILTER");
  });

  it("excluir a camada e renomear o parceiro NÃO alteram o ranking histórico", async () => {
    const layer = await prisma.coverageLayer.findFirstOrThrow();
    const partner = await prisma.coveragePartner.findFirstOrThrow();
    await request(app)
      .patch(`/api/coverage/partners/${partner.id}`)
      .set("Authorization", `Bearer ${adminToken}`)
      .send({ name: "Nome Trocado" });
    await request(app)
      .delete(`/api/coverage/layers/${layer.id}`)
      .set("Authorization", `Bearer ${adminToken}`);

    const res = await request(app)
      .get("/api/dashboard/rankings?preset=LAST_7_DAYS")
      .set("Authorization", `Bearer ${adminToken}`);
    expect(res.body.partners[0].partnerName).toBe("Rede Neutra"); // snapshot da época
    expect(res.body.layers[0].layerName).toBe("Cobertura Barreiro");
    expect(res.body.layers[0].matchCount).toBe(3);
  });
});

describe("consultas recentes e auditoria", () => {
  it("recent-consultations retorna resumo (sem JSON detalhado); VIEWER só as próprias", async () => {
    const res = await request(app)
      .get("/api/dashboard/recent-consultations?preset=LAST_7_DAYS&limit=10")
      .set("Authorization", `Bearer ${adminToken}`);
    expect(res.status).toBe(200);
    expect(res.body.consultations).toHaveLength(3);
    const item = res.body.consultations[0];
    expect(item.protocol).toMatch(/^VIA-/);
    expect(item.address.city).toBe("Belo Horizonte");
    expect(item.coverageMatchCount).toBe(1);
    expect(item.coverageMatches).toBeUndefined();
    expect(item.networkReference).toBeUndefined();

    const own = await request(app)
      .get("/api/dashboard/recent-consultations?preset=LAST_7_DAYS")
      .set("Authorization", `Bearer ${viewerToken}`);
    expect(own.body.consultations).toHaveLength(1);
  });

  it("DASHBOARD_VIEWED é registrado UMA vez por visualização lógica (summary com recordView=true), não por endpoint", async () => {
    await prisma.auditLog.deleteMany({ where: { action: "DASHBOARD_VIEWED" } });
    const base = "preset=LAST_7_DAYS";
    await request(app)
      .get(`/api/dashboard/summary?${base}&recordView=true`)
      .set("Authorization", `Bearer ${adminToken}`);
    // Duplicata técnica (StrictMode/retry): recordView ausente => sem evento.
    await request(app)
      .get(`/api/dashboard/summary?${base}`)
      .set("Authorization", `Bearer ${adminToken}`);
    await request(app)
      .get(`/api/dashboard/timeline?${base}`)
      .set("Authorization", `Bearer ${adminToken}`);
    await request(app)
      .get(`/api/dashboard/breakdowns?${base}`)
      .set("Authorization", `Bearer ${adminToken}`);
    await request(app)
      .get(`/api/dashboard/rankings?${base}`)
      .set("Authorization", `Bearer ${adminToken}`);
    await request(app)
      .get(`/api/dashboard/recent-consultations?${base}`)
      .set("Authorization", `Bearer ${adminToken}`);

    const events = await prisma.auditLog.findMany({ where: { action: "DASHBOARD_VIEWED" } });
    expect(events).toHaveLength(1);
    expect(events[0].metadata).toMatchObject({ preset: "LAST_7_DAYS", scope: "ALL" });
    // Sem endereço/coordenadas/agregados na auditoria:
    const serialized = JSON.stringify(events[0]);
    expect(serialized).not.toContain("Rua Ranking");
    expect(serialized).not.toContain("latitude");
  });
});

describe("backfill da migration em banco com histórico", () => {
  const MIGRATIONS_DIR = path.join(__dirname, "..", "prisma", "migrations");
  const CHECK_DB = `viability_backfill_check_${Date.now()}`;

  afterAll(async () => {
    const admin = new Client({ connectionString: process.env.APP_DATABASE_URL });
    await admin.connect();
    await admin.query(`DROP DATABASE IF EXISTS ${CHECK_DB}`);
    await admin.end();
  });

  it("preenche a projeção a partir do Json existente, sem duplicar nem alterar o original", async () => {
    const admin = new Client({ connectionString: process.env.APP_DATABASE_URL });
    await admin.connect();
    await admin.query(`CREATE DATABASE ${CHECK_DB}`);
    await admin.end();

    const freshUrl = process.env.APP_DATABASE_URL!.replace(/[^/]+$/, CHECK_DB);
    const fresh = new Client({ connectionString: freshUrl });
    await fresh.connect();
    try {
      const folders = readdirSync(MIGRATIONS_DIR)
        .filter((name) => /^\d{14}/.test(name))
        .sort();
      const backfillFolder = folders[folders.length - 1];
      expect(backfillFolder).toContain("consultation_coverage_matches");

      // Aplica todas as migrations ANTERIORES à do backfill:
      for (const folder of folders.slice(0, -1)) {
        const sql = readFileSync(path.join(MIGRATIONS_DIR, folder, "migration.sql"), "utf-8");
        await fresh.query(sql);
      }

      // Consultas históricas com Json variado: 2 matches, array vazio e itens inválidos.
      await fresh.query(`
        INSERT INTO "viability_consultations"
          ("id","protocol","status","resultMessage","street","number","city","state",
           "geocodingProvider","coverageMatches","coverageMatchCount","networkReferenceStatus","networkAlternatives")
        VALUES
          (gen_random_uuid(),'VIA-20260720-HISTA222','PRELIMINARILY_VIABLE','ok','Rua A','1','BH','MG','google',
           '[{"partnerId":"p1","partnerName":"Rede Neutra","partnerCode":"REDE_NEUTRA","layerId":"l1","layerName":"Barreiro","version":"2026-07"},
             {"partnerId":"p2","partnerName":"Parceiro B","partnerCode":"PARC_B","layerId":"l2","layerName":"Sobreposta","version":null}]'::jsonb,
           2,'FOUND','[]'::jsonb),
          (gen_random_uuid(),'VIA-20260720-HISTB222','OUTSIDE_COVERAGE','ok','Rua B','2','BH','MG','google',
           '[]'::jsonb,0,'NOT_CHECKED','[]'::jsonb),
          (gen_random_uuid(),'VIA-20260720-HISTC222','PRELIMINARILY_VIABLE','ok','Rua C','3','BH','MG','google',
           '["texto-invalido", {"partnerName":"Só Nome","layerName":"Camada X"}]'::jsonb,
           2,'NOT_FOUND','[]'::jsonb)
      `);

      // Aplica a migration do backfill:
      const backfillSql = readFileSync(
        path.join(MIGRATIONS_DIR, backfillFolder, "migration.sql"),
        "utf-8"
      );
      await fresh.query(backfillSql);

      const projections = await fresh.query(
        `SELECT "partnerNameSnapshot","partnerCodeSnapshot","layerNameSnapshot","versionSnapshot"
         FROM "viability_consultation_coverage_matches" ORDER BY "partnerNameSnapshot"`
      );
      // 2 matches válidos da 1ª + 1 item objeto válido da 3ª; string inválida ignorada.
      expect(projections.rows).toHaveLength(3);
      expect(projections.rows[0].partnerNameSnapshot).toBe("Parceiro B");
      expect(projections.rows[1].partnerNameSnapshot).toBe("Rede Neutra");
      expect(projections.rows[1].partnerCodeSnapshot).toBe("REDE_NEUTRA");
      expect(projections.rows[1].versionSnapshot).toBe("2026-07");
      expect(projections.rows[2].partnerNameSnapshot).toBe("Só Nome");

      // Reexecutar o backfill NÃO duplica (ON CONFLICT DO NOTHING):
      const backfillOnly = backfillSql.slice(backfillSql.indexOf("INSERT INTO"));
      await fresh.query(backfillOnly);
      const again = await fresh.query(
        `SELECT count(*)::int AS count FROM "viability_consultation_coverage_matches"`
      );
      expect(again.rows[0].count).toBe(3);

      // O Json original permanece intacto:
      const json = await fresh.query(
        `SELECT "coverageMatches" FROM "viability_consultations" WHERE protocol = 'VIA-20260720-HISTA222'`
      );
      expect(json.rows[0].coverageMatches).toHaveLength(2);
      expect(json.rows[0].coverageMatches[0].partnerName).toBe("Rede Neutra");
    } finally {
      await fresh.end();
    }
  });
});
