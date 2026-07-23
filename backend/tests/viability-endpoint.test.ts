import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import request from "supertest";
import { createApp } from "../src/app";
import { coverageMemoryStore } from "../src/stores/coverage-memory.store";
import { parseCoverageKml } from "../src/services/coverage-parser.service";
import { checkViability } from "../src/services/viability.service";
import { VoalleRepository } from "../src/repositories/voalle.repository";
import { VoalleNetworkElement } from "../src/types/viability.types";
import { VoalleUnavailableError } from "../src/utils/errors";
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

function loadCoverage(): void {
  const result = parseCoverageKml(readFixtureKml(), "KML");
  coverageMemoryStore.replaceAll({ ...result, sourceFile: "manchas.kml" });
}

function fakeElement(id: string, title: string, latitude: number, longitude: number): VoalleNetworkElement {
  return {
    id,
    title,
    street: null,
    addressNumber: null,
    neighborhood: null,
    city: null,
    postalCode: null,
    latitude,
    longitude,
  };
}

function repoWith(elements: VoalleNetworkElement[]): VoalleRepository & { spy: ReturnType<typeof vi.fn> } {
  const spy = vi.fn().mockResolvedValue(elements);
  return { spy, isConfigured: () => true, findNetworkElementsNearCoordinates: spy };
}

describe("POST /api/viabilities/check-coordinates (HTTP, ferramenta de desenvolvimento)", () => {
  let adminToken = "";
  let operatorToken = "";

  beforeAll(async () => {
    await resetAppDatabase();
    const admin = await createTestUser({ role: "ADMIN", email: "coord-admin@teste.local" });
    const operator = await createTestUser({ role: "OPERATOR", email: "coord-op@teste.local" });
    adminToken = (await loginAs(app, admin.email)).accessToken;
    operatorToken = (await loginAs(app, operator.email)).accessToken;
  });
  afterAll(resetAppDatabase);
  beforeEach(() => coverageMemoryStore.clear());

  it("sem autenticacao retorna 401", async () => {
    const res = await request(app)
      .post("/api/viabilities/check-coordinates")
      .send(POINT_INSIDE_BARREIRO);
    expect(res.status).toBe(401);
    expect(res.body.error.code).toBe("UNAUTHORIZED");
  });

  it("fora de development a ferramenta exige ADMIN (operador recebe 403)", async () => {
    const res = await request(app)
      .post("/api/viabilities/check-coordinates")
      .set("Authorization", `Bearer ${operatorToken}`)
      .send(POINT_INSIDE_BARREIRO);
    expect(res.status).toBe(403);
  });

  it("com ADMIN retorna COVERAGE_NOT_LOADED quando as manchas nao foram carregadas", async () => {
    const res = await request(app)
      .post("/api/viabilities/check-coordinates")
      .set("Authorization", `Bearer ${adminToken}`)
      .send(POINT_INSIDE_BARREIRO);
    expect(res.status).toBe(200);
    expect(res.body.status).toBe("COVERAGE_NOT_LOADED");
  });

  it("valida o body e rejeita coordenadas invalidas", async () => {
    const res = await request(app)
      .post("/api/viabilities/check-coordinates")
      .set("Authorization", `Bearer ${adminToken}`)
      .send({ latitude: 120, longitude: -44.0 });
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe("VALIDATION_ERROR");
  });

  it("retorna OUTSIDE_COVERAGE para ponto fora das manchas", async () => {
    loadCoverage();
    const res = await request(app)
      .post("/api/viabilities/check-coordinates")
      .set("Authorization", `Bearer ${adminToken}`)
      .send(POINT_OUTSIDE);
    expect(res.status).toBe(200);
    expect(res.body.status).toBe("OUTSIDE_COVERAGE");
    expect(res.body.coverage.insideCoverage).toBe(false);
    expect(res.body.nearestNetworkLocation).toBeNull();
  });

  it("GET /api/coverage/areas e /status exigem autenticacao (qualquer perfil)", async () => {
    const denied = await request(app).get("/api/coverage/areas");
    expect(denied.status).toBe(401);
    const statusDenied = await request(app).get("/api/coverage/status");
    expect(statusDenied.status).toBe(401);
    const allowed = await request(app)
      .get("/api/coverage/areas")
      .set("Authorization", `Bearer ${operatorToken}`);
    expect(allowed.status).toBe(200);
    expect(allowed.body).toHaveProperty("areas");
  });
});

describe("checkViability com repositorio injetado", () => {
  beforeEach(() => {
    loadCoverage();
  });

  it("fora da cobertura NAO consulta o Voalle", async () => {
    const repo = repoWith([]);
    const result = await checkViability(POINT_OUTSIDE, repo);
    expect(result.status).toBe("OUTSIDE_COVERAGE");
    expect(repo.spy).not.toHaveBeenCalled();
  });

  it("dentro da cobertura faz UMA UNICA consulta ao Voalle", async () => {
    const repo = repoWith([]);
    await checkViability(POINT_INSIDE_BARREIRO, repo);
    expect(repo.spy).toHaveBeenCalledTimes(1);
    const [, , radius] = repo.spy.mock.calls[0];
    expect(radius).toBe(300); // NETWORK_REFERENCE_SEARCH_RADIUS_METERS padrao
  });

  it("dentro da cobertura com ponto proximo: PRELIMINARILY_VIABLE + referencia FOUND", async () => {
    const { latitude, longitude } = POINT_INSIDE_BARREIRO;
    const repo = repoWith([
      fakeElement("4", "SPLITTER 4_51", latitude + 0.0005, longitude),   // ~55 m
      fakeElement("1", "SPLITTER 1_48", latitude + 0.0005, longitude),
      fakeElement("9", "ROTA 01_1942", latitude + 0.002, longitude),     // ~220 m
    ]);
    const result = await checkViability(POINT_INSIDE_BARREIRO, repo);

    expect(result.status).toBe("PRELIMINARILY_VIABLE");
    expect(result.networkReferenceStatus).toBe("FOUND");
    expect(result.requiresTechnicalConfirmation).toBe(true);
    expect(result.coverage.primaryArea?.name).toBe("BARREIRO");

    const nearest = result.nearestNetworkLocation!;
    expect(nearest.elements.map((e) => e.id)).toEqual(["1", "4"]); // mesmo ponto fisico, por id
    expect(nearest.distanceMeters).toBeLessThan(150);

    expect(result.alternatives).toHaveLength(1);
    expect(result.alternatives[0].distanceMeters).toBeGreaterThan(nearest.distanceMeters);
  });

  it("a distancia da referencia NUNCA rebaixa a viabilidade (ponto a ~220 m segue viavel)", async () => {
    const { latitude, longitude } = POINT_INSIDE_BARREIRO;
    const repo = repoWith([fakeElement("1", "COLETOR 01", latitude + 0.002, longitude)]); // ~220 m
    const result = await checkViability(POINT_INSIDE_BARREIRO, repo);
    expect(result.status).toBe("PRELIMINARILY_VIABLE");
    expect(result.networkReferenceStatus).toBe("FOUND");
    expect(result.requiresTechnicalConfirmation).toBe(true);
  });

  it("dentro da cobertura sem ponto proximo: PRELIMINARILY_VIABLE + NOT_FOUND", async () => {
    const repo = repoWith([]);
    const result = await checkViability(POINT_INSIDE_BARREIRO, repo);
    expect(result.status).toBe("PRELIMINARILY_VIABLE");
    expect(result.networkReferenceStatus).toBe("NOT_FOUND");
    expect(result.nearestNetworkLocation).toBeNull();
    expect(result.alternatives).toEqual([]);
    expect(result.message).toBe(
      "O endereço está dentro da área de cobertura e possui viabilidade preliminar."
    );
    expect(result.networkReferenceMessage).toBe(
      "Não foi possível identificar automaticamente um ponto de rede próximo no Voalle."
    );
    // Textos proibidos dentro da mancha:
    const json = JSON.stringify(result);
    expect(json).not.toContain("Sem rede próxima");
    expect(json).not.toContain("Sem viabilidade");
    expect(json).not.toContain("distância técnica");
  });

  it("dentro da cobertura com Voalle indisponivel: PRELIMINARILY_VIABLE + VOALLE_UNAVAILABLE", async () => {
    const repo: VoalleRepository = {
      isConfigured: () => true,
      findNetworkElementsNearCoordinates: vi.fn().mockRejectedValue(new VoalleUnavailableError()),
    };
    const result = await checkViability(POINT_INSIDE_BARREIRO, repo);
    expect(result.status).toBe("PRELIMINARILY_VIABLE");
    expect(result.networkReferenceStatus).toBe("VOALLE_UNAVAILABLE");
    expect(result.coverage.insideCoverage).toBe(true);
    expect(result.nearestNetworkLocation).toBeNull();
    expect(result.networkReferenceMessage).toBe(
      "O endereço está dentro da cobertura, mas não foi possível consultar as referências de rede no momento."
    );
  });

  it("fora da cobertura: OUTSIDE_COVERAGE + NOT_CHECKED", async () => {
    const repo = repoWith([]);
    const result = await checkViability(POINT_OUTSIDE, repo);
    expect(result.status).toBe("OUTSIDE_COVERAGE");
    expect(result.networkReferenceStatus).toBe("NOT_CHECKED");
    expect(result.message).toBe("O endereço está fora das áreas de cobertura cadastradas.");
  });

  it("areas sobrepostas: principal e a primeira na ordem do KML", async () => {
    const repo = repoWith([]);
    const result = await checkViability(POINT_IN_OVERLAP, repo);
    expect(result.coverage.primaryArea?.name).toBe("BARREIRO");
    expect(result.coverage.matchingAreas.map((a) => a.name)).toEqual(["SOBREPOSICAO LESTE"]);
  });

  it("limita as alternativas a MAX_NETWORK_ALTERNATIVES", async () => {
    const { latitude, longitude } = POINT_INSIDE_BARREIRO;
    const elements = Array.from({ length: 10 }, (_, i) =>
      fakeElement(String(i + 1), `SPLITTER ${i + 1}`, latitude + 0.0001 * (i + 1), longitude)
    );
    const repo = repoWith(elements);
    const result = await checkViability(POINT_INSIDE_BARREIRO, repo);
    expect(result.alternatives.length).toBeLessThanOrEqual(5);
  });

  it("nenhuma resposta contem informacao de portas ou dados pessoais", async () => {
    const { latitude, longitude } = POINT_INSIDE_BARREIRO;
    const repo = repoWith([fakeElement("1", "SPLITTER 1_48", latitude + 0.0005, longitude)]);
    const result = await checkViability(POINT_INSIDE_BARREIRO, repo);
    const json = JSON.stringify(result).toLowerCase();
    for (const forbidden of ["porta", "port_", "cpf", "cnpj", "telefone", "phone", "capacidade", "disponibilidade"]) {
      expect(json).not.toContain(forbidden);
    }
  });
});
