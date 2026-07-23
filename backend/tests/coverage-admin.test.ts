import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import request from "supertest";
import { promises as fs } from "fs";
import path from "path";
import { zipSync, strToU8 } from "fflate";
import { createApp } from "../src/app";
import { prisma, disconnectAppDatabase } from "../src/db/prisma";
import { coverageSnapshotStore } from "../src/stores/coverage-snapshot.store";
import { rebuildCoverageSnapshot } from "../src/services/coverage-snapshot.service";
import { resolveStoredFile, storageRoot } from "../src/services/coverage-storage.service";
import { AppError } from "../src/utils/errors";
import {
  createTestUser,
  loginAs,
  POINT_INSIDE_BARREIRO,
  POINT_IN_OVERLAP,
  POINT_OUTSIDE,
  readFixtureKml,
  resetAppDatabase,
} from "./helpers";

const app = createApp();

/** KML mínimo com um único polígono cobrindo o entorno de (lat, lng). */
function singlePolygonKml(name: string, lat: number, lng: number, delta = 0.01): string {
  const ring = [
    `${lng - delta},${lat - delta},0`,
    `${lng + delta},${lat - delta},0`,
    `${lng + delta},${lat + delta},0`,
    `${lng - delta},${lat + delta},0`,
    `${lng - delta},${lat - delta},0`,
  ].join(" ");
  return `<?xml version="1.0" encoding="UTF-8"?>
<kml xmlns="http://www.opengis.net/kml/2.2"><Document><name>${name}</name>
<Placemark><name>${name}</name><Polygon><outerBoundaryIs><LinearRing>
<coordinates>${ring}</coordinates>
</LinearRing></outerBoundaryIs></Polygon></Placemark>
</Document></kml>`;
}

const KML_ONLY_LINES = `<?xml version="1.0" encoding="UTF-8"?>
<kml xmlns="http://www.opengis.net/kml/2.2"><Document>
<Placemark><name>Rota</name><LineString><coordinates>-44.0,-19.9,0 -44.1,-19.8,0</coordinates></LineString></Placemark>
</Document></kml>`;

async function resetCoverage(): Promise<void> {
  await resetAppDatabase();
  await prisma.coverageLayer.deleteMany();
  await prisma.coveragePartner.deleteMany();
  coverageSnapshotStore.clear();
  await fs.rm(storageRoot(), { recursive: true, force: true });
}

let adminToken = "";
let operatorToken = "";

async function seedSessions(): Promise<void> {
  const admin = await createTestUser({ role: "ADMIN", email: "cov-admin@teste.local" });
  const operator = await createTestUser({ role: "OPERATOR", email: "cov-op@teste.local" });
  adminToken = (await loginAs(app, admin.email)).accessToken;
  operatorToken = (await loginAs(app, operator.email)).accessToken;
}

async function createPartnerViaApi(code: string, name = `Parceiro ${code}`): Promise<string> {
  const res = await request(app)
    .post("/api/coverage/partners")
    .set("Authorization", `Bearer ${adminToken}`)
    .send({ name, code });
  if (res.status !== 201) throw new Error(`falha ao criar parceiro: ${JSON.stringify(res.body)}`);
  return res.body.partner.id;
}

async function uploadLayer(options: {
  partnerId: string;
  name: string;
  content: string | Buffer;
  fileName?: string;
  version?: string;
  active?: string;
}): Promise<request.Response> {
  const req = request(app)
    .post("/api/coverage/layers")
    .set("Authorization", `Bearer ${adminToken}`)
    .field("partnerId", options.partnerId)
    .field("name", options.name);
  if (options.version) req.field("version", options.version);
  if (options.active) req.field("active", options.active);
  return req.attach(
    "file",
    typeof options.content === "string" ? Buffer.from(options.content) : options.content,
    options.fileName ?? "camada.kml"
  );
}

describe("parceiros de cobertura", () => {
  beforeEach(async () => {
    await resetCoverage();
    await seedSessions();
  });

  it("ADMIN cria parceiro (auditado); code é normalizado e único", async () => {
    const res = await request(app)
      .post("/api/coverage/partners")
      .set("Authorization", `Bearer ${adminToken}`)
      .send({ name: "Rede Neutra", code: "rede_neutra", description: "Parceiro principal" });
    expect(res.status).toBe(201);
    expect(res.body.partner.code).toBe("REDE_NEUTRA");

    const duplicate = await request(app)
      .post("/api/coverage/partners")
      .set("Authorization", `Bearer ${adminToken}`)
      .send({ name: "Outro", code: "REDE_NEUTRA" });
    expect(duplicate.status).toBe(409);
    expect(duplicate.body.error.code).toBe("COVERAGE_PARTNER_CODE_IN_USE");

    const audit = await prisma.auditLog.findMany({
      where: { action: "COVERAGE_PARTNER_CREATED" },
    });
    expect(audit).toHaveLength(1);
  });

  it("OPERATOR não cria parceiro (403) e sem token retorna 401", async () => {
    const forbidden = await request(app)
      .post("/api/coverage/partners")
      .set("Authorization", `Bearer ${operatorToken}`)
      .send({ name: "X", code: "X1" });
    expect(forbidden.status).toBe(403);
    const anonymous = await request(app).post("/api/coverage/partners").send({});
    expect(anonymous.status).toBe(401);
  });

  it("paginação, busca e filtro active na listagem; não-admin vê apenas ativos", async () => {
    await createPartnerViaApi("ALFA", "Alfa Redes");
    await createPartnerViaApi("BETA", "Beta Fibra");
    const betaId = (
      await prisma.coveragePartner.findUniqueOrThrow({ where: { code: "BETA" } })
    ).id;
    await request(app)
      .patch(`/api/coverage/partners/${betaId}/status`)
      .set("Authorization", `Bearer ${adminToken}`)
      .send({ active: false });

    const search = await request(app)
      .get("/api/coverage/partners?search=alfa&page=1&limit=10")
      .set("Authorization", `Bearer ${adminToken}`);
    expect(search.body.total).toBe(1);
    expect(search.body.partners[0].code).toBe("ALFA");

    const inactive = await request(app)
      .get("/api/coverage/partners?active=false")
      .set("Authorization", `Bearer ${adminToken}`);
    expect(inactive.body.total).toBe(1);

    // Não-admin: filtro active é forçado — o inativo não aparece.
    const basicList = await request(app)
      .get("/api/coverage/partners")
      .set("Authorization", `Bearer ${operatorToken}`);
    expect(basicList.status).toBe(200);
    expect(basicList.body.partners.map((p: { code: string }) => p.code)).toEqual(["ALFA"]);
  });
});

describe("upload e processamento de camadas", () => {
  beforeEach(async () => {
    await resetCoverage();
    await seedSessions();
  });

  it("importa KML válido: READY com estatísticas, SHA-256 e auditoria", async () => {
    const partnerId = await createPartnerViaApi("KML1");
    const res = await uploadLayer({
      partnerId,
      name: "Cobertura KML",
      content: readFixtureKml(),
      version: "2026-07",
    });
    expect(res.status).toBe(201);
    const layer = res.body.layer;
    expect(layer.processingStatus).toBe("READY");
    expect(layer.fileType).toBe("KML");
    expect(layer.areaCount).toBeGreaterThan(0);
    expect(layer.polygonCount).toBeGreaterThan(0);
    expect(layer.sha256).toMatch(/^[a-f0-9]{64}$/); // SHA-256 calculado
    expect(layer.version).toBe("2026-07");

    const audit = await prisma.auditLog.findMany({ where: { action: "COVERAGE_LAYER_UPLOADED" } });
    expect(audit).toHaveLength(1);
  });

  it("importa KMZ válido", async () => {
    const partnerId = await createPartnerViaApi("KMZ1");
    const kmz = Buffer.from(zipSync({ "doc.kml": strToU8(readFixtureKml()) }));
    const res = await uploadLayer({
      partnerId,
      name: "Cobertura KMZ",
      content: kmz,
      fileName: "camada.kmz",
    });
    expect(res.status).toBe(201);
    expect(res.body.layer.fileType).toBe("KMZ");
    expect(res.body.layer.processingStatus).toBe("READY");
  });

  it("rejeita extensão inválida, arquivo vazio e arquivo acima do limite", async () => {
    const partnerId = await createPartnerViaApi("VAL1");

    const wrongExt = await uploadLayer({
      partnerId,
      name: "Extensão",
      content: "conteudo",
      fileName: "cobertura.txt",
    });
    expect(wrongExt.status).toBe(400);
    expect(wrongExt.body.error.code).toBe("COVERAGE_FILE_INVALID");

    const empty = await uploadLayer({
      partnerId,
      name: "Vazio ok",
      content: Buffer.alloc(0),
    });
    expect(empty.status).toBe(400);
    expect(empty.body.error.code).toBe("COVERAGE_FILE_INVALID");

    const huge = Buffer.alloc(26 * 1024 * 1024, 0x20); // limite de teste: 25 MB
    const tooLarge = await uploadLayer({ partnerId, name: "Grande", content: huge });
    expect(tooLarge.status).toBe(400);
    expect(tooLarge.body.error.code).toBe("COVERAGE_FILE_TOO_LARGE");
  });

  it("arquivo sem polígonos vira FAILED (LineString é ignorada sem derrubar o parser)", async () => {
    const partnerId = await createPartnerViaApi("FAIL1");
    const res = await uploadLayer({ partnerId, name: "Só linhas", content: KML_ONLY_LINES });
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe("COVERAGE_PROCESSING_FAILED");
    expect(JSON.stringify(res.body)).not.toMatch(/\sat\s.+\.ts/); // sem stack trace

    const layer = await prisma.coverageLayer.findFirstOrThrow();
    expect(layer.processingStatus).toBe("FAILED");
    expect(layer.processingError).toBeTruthy();
    const audit = await prisma.auditLog.findMany({
      where: { action: "COVERAGE_LAYER_PROCESSING_FAILED" },
    });
    expect(audit).toHaveLength(1);
  });

  it("KML com polígonos E LineString importa ignorando a linha", async () => {
    const partnerId = await createPartnerViaApi("MIX1");
    const mixed = readFixtureKml().replace(
      "</Document>",
      `<Placemark><name>Rota</name><LineString><coordinates>-44.0,-19.9,0 -44.1,-19.8,0</coordinates></LineString></Placemark></Document>`
    );
    const res = await uploadLayer({ partnerId, name: "Mista", content: mixed });
    expect(res.status).toBe(201);
    expect(res.body.layer.processingStatus).toBe("READY");
    expect(res.body.layer.ignoredGeometryCount).toBeGreaterThan(0);
  });

  it("impede arquivo duplicado pelo SHA-256 com erro claro", async () => {
    const partnerId = await createPartnerViaApi("DUP1");
    const first = await uploadLayer({ partnerId, name: "Original", content: readFixtureKml() });
    expect(first.status).toBe(201);
    const duplicate = await uploadLayer({
      partnerId,
      name: "Cópia",
      content: readFixtureKml(),
    });
    expect(duplicate.status).toBe(409);
    expect(duplicate.body.error.code).toBe("COVERAGE_FILE_DUPLICATE");
  });

  it("nunca expõe storedFileName nem caminho físico em nenhuma resposta", async () => {
    const partnerId = await createPartnerViaApi("SEC1");
    const created = await uploadLayer({ partnerId, name: "Sigilosa", content: readFixtureKml() });
    const layerId = created.body.layer.id;

    const adminGet = await request(app)
      .get(`/api/coverage/layers/${layerId}`)
      .set("Authorization", `Bearer ${adminToken}`);
    const adminList = await request(app)
      .get("/api/coverage/layers")
      .set("Authorization", `Bearer ${adminToken}`);
    const basicList = await request(app)
      .get("/api/coverage/layers")
      .set("Authorization", `Bearer ${operatorToken}`);

    const stored = await prisma.coverageLayer.findUniqueOrThrow({ where: { id: layerId } });
    for (const res of [created, adminGet, adminList, basicList]) {
      const body = JSON.stringify(res.body);
      expect(body).not.toContain("storedFileName");
      expect(body).not.toContain(stored.storedFileName);
      expect(body).not.toContain(storageRoot());
    }
    // Lista básica (não-admin) também não expõe sha256/arquivo original.
    expect(JSON.stringify(basicList.body)).not.toContain("sha256");
  });

  it("path traversal no nome interno é rejeitado (formato estrito uuid.ext)", () => {
    expect(() => resolveStoredFile("../../etc/passwd")).toThrow(AppError);
    expect(() => resolveStoredFile("..\\segredo.kml")).toThrow(AppError);
    expect(() => resolveStoredFile("sub/dir.kml")).toThrow(AppError);
    expect(() => resolveStoredFile("nome-livre.kml")).toThrow(AppError);
    const ok = resolveStoredFile("0b8f4a52-1111-4222-8333-444455556666.kml");
    expect(ok.startsWith(path.resolve(storageRoot()))).toBe(true);
  });

  it("filtros e paginação de camadas (partnerId, processingStatus, fileType, search)", async () => {
    const partnerA = await createPartnerViaApi("FILT_A");
    const partnerB = await createPartnerViaApi("FILT_B");
    await uploadLayer({ partnerId: partnerA, name: "Norte", content: readFixtureKml() });
    const kmz = Buffer.from(zipSync({ "doc.kml": strToU8(singlePolygonKml("Sul", -20.1, -44.2)) }));
    await uploadLayer({ partnerId: partnerB, name: "Sul", content: kmz, fileName: "sul.kmz" });

    const byPartner = await request(app)
      .get(`/api/coverage/layers?partnerId=${partnerA}`)
      .set("Authorization", `Bearer ${adminToken}`);
    expect(byPartner.body.total).toBe(1);
    expect(byPartner.body.layers[0].name).toBe("Norte");

    const byType = await request(app)
      .get("/api/coverage/layers?fileType=KMZ")
      .set("Authorization", `Bearer ${adminToken}`);
    expect(byType.body.total).toBe(1);
    expect(byType.body.layers[0].fileType).toBe("KMZ");

    const byStatus = await request(app)
      .get("/api/coverage/layers?processingStatus=READY&page=1&limit=1")
      .set("Authorization", `Bearer ${adminToken}`);
    expect(byStatus.body.total).toBe(2);
    expect(byStatus.body.layers).toHaveLength(1); // paginação

    const bySearch = await request(app)
      .get("/api/coverage/layers?search=sul")
      .set("Authorization", `Bearer ${adminToken}`);
    expect(bySearch.body.total).toBe(1);
  });
});

describe("snapshot multi-camada", () => {
  beforeEach(async () => {
    await resetCoverage();
    await seedSessions();
  });
  afterAll(async () => {
    await resetCoverage();
    await disconnectAppDatabase();
  });

  it("carrega duas camadas ativas; camada inativa e parceiro inativo ficam fora", async () => {
    const partnerA = await createPartnerViaApi("SNAP_A");
    const partnerB = await createPartnerViaApi("SNAP_B");
    const partnerC = await createPartnerViaApi("SNAP_C");
    await uploadLayer({ partnerId: partnerA, name: "Ativa A", content: readFixtureKml() });
    await uploadLayer({
      partnerId: partnerB,
      name: "Ativa B",
      content: singlePolygonKml("B", -20.5, -44.5),
    });
    // Camada inativa desde o upload:
    await uploadLayer({
      partnerId: partnerA,
      name: "Inativa",
      content: singlePolygonKml("Inativa", -21.0, -45.0),
      active: "false",
    });
    // Parceiro inativado depois do upload:
    await uploadLayer({
      partnerId: partnerC,
      name: "De parceiro inativo",
      content: singlePolygonKml("C", -22.0, -46.0),
    });
    await request(app)
      .patch(`/api/coverage/partners/${partnerC}/status`)
      .set("Authorization", `Bearer ${adminToken}`)
      .send({ active: false });

    const names = coverageSnapshotStore.getLayers().map((layer) => layer.layerName);
    expect(names.sort()).toEqual(["Ativa A", "Ativa B"]);
  });

  it("ativação de camada reconstrói o snapshot", async () => {
    const partnerId = await createPartnerViaApi("SNAP_ON");
    const created = await uploadLayer({
      partnerId,
      name: "Ligável",
      content: readFixtureKml(),
      active: "false",
    });
    expect(coverageSnapshotStore.getLayers()).toHaveLength(0);

    const on = await request(app)
      .patch(`/api/coverage/layers/${created.body.layer.id}/status`)
      .set("Authorization", `Bearer ${adminToken}`)
      .send({ active: true });
    expect(on.status).toBe(200);
    expect(coverageSnapshotStore.getLayers().map((l) => l.layerName)).toEqual(["Ligável"]);
    const audit = await prisma.auditLog.findMany({ where: { action: "COVERAGE_LAYER_ACTIVATED" } });
    expect(audit).toHaveLength(1);
  });

  it("falha na reconstrução mantém o snapshot anterior funcionando", async () => {
    const partnerId = await createPartnerViaApi("SNAP_KEEP");
    const created = await uploadLayer({ partnerId, name: "Estável", content: readFixtureKml() });
    expect(coverageSnapshotStore.getLayers()).toHaveLength(1);

    // Sabotagem: remove o arquivo físico; a próxima reconstrução falha.
    const stored = await prisma.coverageLayer.findUniqueOrThrow({
      where: { id: created.body.layer.id },
    });
    await fs.unlink(resolveStoredFile(stored.storedFileName));

    await expect(rebuildCoverageSnapshot()).rejects.toMatchObject({
      code: "COVERAGE_SNAPSHOT_REBUILD_FAILED",
    });
    // Snapshot anterior intacto: consultas seguem funcionando.
    expect(coverageSnapshotStore.getLayers().map((l) => l.layerName)).toEqual(["Estável"]);
  });

  it("excluir camada remove registro, arquivo físico e snapshot; PROCESSING não pode ser excluída", async () => {
    const partnerId = await createPartnerViaApi("SNAP_DEL");
    const created = await uploadLayer({ partnerId, name: "Removível", content: readFixtureKml() });
    const layerId = created.body.layer.id;
    const stored = await prisma.coverageLayer.findUniqueOrThrow({ where: { id: layerId } });
    const absolutePath = resolveStoredFile(stored.storedFileName);
    await expect(fs.stat(absolutePath)).resolves.toBeTruthy();

    // Em PROCESSING a exclusão é recusada.
    await prisma.coverageLayer.update({
      where: { id: layerId },
      data: { processingStatus: "PROCESSING" },
    });
    const blocked = await request(app)
      .delete(`/api/coverage/layers/${layerId}`)
      .set("Authorization", `Bearer ${adminToken}`);
    expect(blocked.status).toBe(409);
    expect(blocked.body.error.code).toBe("COVERAGE_LAYER_PROCESSING");

    await prisma.coverageLayer.update({
      where: { id: layerId },
      data: { processingStatus: "READY" },
    });
    const removed = await request(app)
      .delete(`/api/coverage/layers/${layerId}`)
      .set("Authorization", `Bearer ${adminToken}`);
    expect(removed.status).toBe(204);
    expect(await prisma.coverageLayer.count()).toBe(0);
    await expect(fs.stat(absolutePath)).rejects.toThrow(); // arquivo removido
    expect(coverageSnapshotStore.getLayers()).toHaveLength(0);
    const audit = await prisma.auditLog.findMany({ where: { action: "COVERAGE_LAYER_DELETED" } });
    expect(audit).toHaveLength(1);
  });

  it("duas importações concorrentes não corrompem o snapshot", async () => {
    const partnerId = await createPartnerViaApi("SNAP_RACE");
    const [first, second] = await Promise.all([
      uploadLayer({ partnerId, name: "Concorrente 1", content: readFixtureKml() }),
      uploadLayer({
        partnerId,
        name: "Concorrente 2",
        content: singlePolygonKml("C2", -20.7, -44.7),
      }),
    ]);
    expect(first.status).toBe(201);
    expect(second.status).toBe(201);
    const names = coverageSnapshotStore
      .getLayers()
      .map((layer) => layer.layerName)
      .sort();
    expect(names).toEqual(["Concorrente 1", "Concorrente 2"]);
  });
});

describe("consulta de viabilidade multi-camada", () => {
  beforeAll(async () => {
    await resetCoverage();
    await seedSessions();
  });
  afterAll(async () => {
    await resetCoverage();
    await disconnectAppDatabase();
  });

  it("ausência total de camadas retorna COVERAGE_NOT_CONFIGURED (não OUTSIDE silencioso)", async () => {
    coverageSnapshotStore.clear();
    const res = await request(app)
      .post("/api/viabilities/check-coordinates")
      .set("Authorization", `Bearer ${adminToken}`)
      .send(POINT_INSIDE_BARREIRO);
    expect(res.status).toBe(200);
    expect(res.body.status).toBe("COVERAGE_NOT_CONFIGURED");
    expect(res.body.coverageMatches).toEqual([]);
  });

  it("dentro de uma camada: um match com parceiro/camada/versão; Voalle indisponível não altera; polígono não é exposto", async () => {
    const partnerId = await createPartnerViaApi("VIA_A", "Rede Neutra");
    await uploadLayer({
      partnerId,
      name: "Cobertura Barreiro",
      content: readFixtureKml(),
      version: "2026-07",
    });

    const res = await request(app)
      .post("/api/viabilities/check-coordinates")
      .set("Authorization", `Bearer ${adminToken}`)
      .send(POINT_INSIDE_BARREIRO);
    expect(res.status).toBe(200);
    expect(res.body.status).toBe("PRELIMINARILY_VIABLE"); // Voalle sem config: não altera
    expect(res.body.networkReferenceStatus).toBe("VOALLE_UNAVAILABLE");
    expect(res.body.coverageMatches).toHaveLength(1);
    expect(res.body.coverageMatches[0]).toMatchObject({
      partnerName: "Rede Neutra",
      layerName: "Cobertura Barreiro",
      version: "2026-07",
    });
    expect(JSON.stringify(res.body.coverageMatches)).not.toContain("polygons");
  });

  it("camadas sobrepostas retornam TODOS os matches sem duplicações", async () => {
    const partnerB = await createPartnerViaApi("VIA_B", "Parceiro B");
    const { latitude, longitude } = POINT_IN_OVERLAP;
    await uploadLayer({
      partnerId: partnerB,
      name: "Sobreposta B",
      content: singlePolygonKml("Sobreposta", latitude, longitude),
    });

    const res = await request(app)
      .post("/api/viabilities/check-coordinates")
      .set("Authorization", `Bearer ${adminToken}`)
      .send(POINT_IN_OVERLAP);
    expect(res.status).toBe(200);
    expect(res.body.status).toBe("PRELIMINARILY_VIABLE");
    const matches = res.body.coverageMatches as Array<{ layerId: string; layerName: string }>;
    expect(matches.length).toBe(2);
    const layerIds = matches.map((m) => m.layerId);
    expect(new Set(layerIds).size).toBe(layerIds.length); // sem duplicações
    expect(matches.map((m) => m.layerName).sort()).toEqual([
      "Cobertura Barreiro",
      "Sobreposta B",
    ]);
  });

  it("fora de todas as camadas retorna OUTSIDE_COVERAGE com matches vazios", async () => {
    const res = await request(app)
      .post("/api/viabilities/check-coordinates")
      .set("Authorization", `Bearer ${adminToken}`)
      .send(POINT_OUTSIDE);
    expect(res.status).toBe(200);
    expect(res.body.status).toBe("OUTSIDE_COVERAGE");
    expect(res.body.coverageMatches).toEqual([]);
  });
});
