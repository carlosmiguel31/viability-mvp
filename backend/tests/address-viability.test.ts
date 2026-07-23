import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import request from "supertest";
import { createApp } from "../src/app";
import { checkViabilityByAddress } from "../src/services/address-viability.service";
import { normalizeAddressInput } from "../src/services/address.service";
import {
  AddressNotFoundError,
  GeocodingUnavailableError,
} from "../src/services/geocoding/geocoding.errors";
import { coverageMemoryStore } from "../src/stores/coverage-memory.store";
import { parseCoverageKml } from "../src/services/coverage-parser.service";
import { GeocodingProvider, GeocodingResult } from "../src/types/address.types";
import { VoalleRepository } from "../src/repositories/voalle.repository";
import { VoalleNetworkElement } from "../src/types/viability.types";
import {
  createTestUser,
  loginAs,
  POINT_INSIDE_BARREIRO,
  POINT_OUTSIDE,
  readFixtureKml,
  resetAppDatabase,
} from "./helpers";

const address = normalizeAddressInput({
  postalCode: "30640-000",
  street: "Rua Exemplo",
  number: "100",
  neighborhood: "Barreiro",
  city: "Belo Horizonte",
  state: "MG",
});

function loadCoverage(): void {
  const result = parseCoverageKml(readFixtureKml(), "KML");
  coverageMemoryStore.replaceAll({ ...result, sourceFile: "manchas.kml" });
}

function geocoderReturning(result: Partial<GeocodingResult>): GeocodingProvider & {
  spy: ReturnType<typeof vi.fn>;
} {
  const spy = vi.fn().mockResolvedValue({
    latitude: POINT_INSIDE_BARREIRO.latitude,
    longitude: POINT_INSIDE_BARREIRO.longitude,
    formattedAddress: "Rua Exemplo, 100, Barreiro, Belo Horizonte - MG",
    confidence: "HIGH",
    provider: "fake",
    partialMatch: false,
    ...result,
  });
  return { spy, geocodeAddress: spy };
}

function geocoderFailing(error: Error): GeocodingProvider & { spy: ReturnType<typeof vi.fn> } {
  const spy = vi.fn().mockRejectedValue(error);
  return { spy, geocodeAddress: spy };
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

function repoWith(elements: VoalleNetworkElement[]): VoalleRepository & {
  spy: ReturnType<typeof vi.fn>;
} {
  const spy = vi.fn().mockResolvedValue(elements);
  return { spy, isConfigured: () => true, findNetworkElementsNearCoordinates: spy };
}

describe("checkViabilityByAddress", () => {
  beforeEach(() => loadCoverage());

  it("endereço geocodificado dentro da cobertura executa o fluxo geográfico completo", async () => {
    const { latitude, longitude } = POINT_INSIDE_BARREIRO;
    const repo = repoWith([
      fakeElement("2780", "BHZ-C0016-RT10-CT03_2780", latitude + 0.0005, longitude),
      fakeElement("1", "SPLITTER 1_48", latitude + 0.0005, longitude),
    ]);
    const result = await checkViabilityByAddress(
      { address },
      { geocoder: geocoderReturning({}), repository: repo }
    );

    expect(result.status).toBe("PRELIMINARILY_VIABLE");
    expect(result.searchedAddress.latitude).toBeCloseTo(latitude, 6);
    expect(result.searchedAddress.geocodingConfidence).toBe("HIGH");
    expect(result.searchedAddress.manuallyAdjusted).toBe(false);
    expect(result.coverage.primaryArea?.name).toBe("BARREIRO");

    const nearest = result.nearestNetworkLocation!;
    expect(nearest.identificationStatus).toBe("IDENTIFIED");
    expect(nearest.identifiers).toEqual([{ id: "2780", code: "BHZ-C0016-RT10-CT03_2780" }]);
    // Resposta pública sem títulos técnicos:
    const json = JSON.stringify(result);
    expect(json).not.toContain("SPLITTER");
    expect(json).not.toContain("ROTA");
    expect(json).not.toContain("COLETOR");
  });

  it("endereço geocodificado fora da cobertura retorna OUTSIDE_COVERAGE", async () => {
    const repo = repoWith([]);
    const result = await checkViabilityByAddress(
      {
        address,
      },
      {
        geocoder: geocoderReturning({
          latitude: POINT_OUTSIDE.latitude,
          longitude: POINT_OUTSIDE.longitude,
        }),
        repository: repo,
      }
    );
    expect(result.status).toBe("OUTSIDE_COVERAGE");
    expect(repo.spy).not.toHaveBeenCalled();
  });

  it("ADDRESS_NOT_FOUND: não consulta o Voalle", async () => {
    const repo = repoWith([]);
    const result = await checkViabilityByAddress(
      { address },
      { geocoder: geocoderFailing(new AddressNotFoundError()), repository: repo }
    );
    expect(result.status).toBe("ADDRESS_NOT_FOUND");
    expect(result.searchedAddress.latitude).toBeNull();
    expect(repo.spy).not.toHaveBeenCalled();
  });

  it.each(["HIGH", "MEDIUM", "LOW"] as const)(
    "ADDRESS_AMBIGUOUS: partialMatch exige confirmação no mapa mesmo com confiança %s, sem consultar o Voalle",
    async (confidence) => {
      const repo = repoWith([]);
      const result = await checkViabilityByAddress(
        { address },
        {
          geocoder: geocoderReturning({ confidence, partialMatch: true }),
          repository: repo,
        }
      );
      expect(result.status).toBe("ADDRESS_AMBIGUOUS");
      expect(result.geocoding?.partialMatch).toBe(true);
      expect(result.message).toContain("Confirme o ponto no mapa");
      expect(repo.spy).not.toHaveBeenCalled();
    }
  );

  it("LOW + partialMatch false também exige confirmação, mantendo as coordenadas para o marcador", async () => {
    const repo = repoWith([]);
    const result = await checkViabilityByAddress(
      { address },
      { geocoder: geocoderReturning({ confidence: "LOW", partialMatch: false }), repository: repo }
    );
    expect(result.status).toBe("ADDRESS_AMBIGUOUS");
    // Coordenadas retornadas para posicionar o marcador de confirmação/ajuste:
    expect(result.searchedAddress.latitude).toBeCloseTo(POINT_INSIDE_BARREIRO.latitude, 6);
    expect(result.searchedAddress.longitude).toBeCloseTo(POINT_INSIDE_BARREIRO.longitude, 6);
    expect(result.geocoding?.confidence).toBe("LOW");
  });

  it("LOW não consulta o Voalle antes da confirmação (e a confirmação libera a consulta)", async () => {
    const { latitude, longitude } = POINT_INSIDE_BARREIRO;
    const repo = repoWith([fakeElement("2780", "BHZ-C0016-RT10-CT03_2780", latitude, longitude)]);
    const geocoder = geocoderReturning({ confidence: "LOW", partialMatch: false });

    const before = await checkViabilityByAddress({ address }, { geocoder, repository: repo });
    expect(before.status).toBe("ADDRESS_AMBIGUOUS");
    expect(repo.spy).not.toHaveBeenCalled();

    const after = await checkViabilityByAddress(
      { address, adjustedLocation: { latitude, longitude } },
      { geocoder, repository: repo }
    );
    expect(after.status).toBe("PRELIMINARILY_VIABLE");
    expect(repo.spy).toHaveBeenCalledTimes(1);
  });

  it.each(["HIGH", "MEDIUM"] as const)(
    "%s + partialMatch false continua o fluxo normalmente",
    async (confidence) => {
      const { latitude, longitude } = POINT_INSIDE_BARREIRO;
      const repo = repoWith([fakeElement("2780", "BHZ-C0016-RT10-CT03_2780", latitude, longitude)]);
      const result = await checkViabilityByAddress(
        { address },
        { geocoder: geocoderReturning({ confidence, partialMatch: false }), repository: repo }
      );
      expect(result.status).toBe("PRELIMINARILY_VIABLE");
      expect(result.networkReferenceStatus).toBe("FOUND");
      expect(result.searchedAddress.geocodingConfidence).toBe(confidence);
      expect(repo.spy).toHaveBeenCalledTimes(1);
    }
  );

  it("GEOCODING_UNAVAILABLE: provider indisponível não afirma viabilidade", async () => {
    const repo = repoWith([]);
    const result = await checkViabilityByAddress(
      { address },
      { geocoder: geocoderFailing(new GeocodingUnavailableError()), repository: repo }
    );
    expect(result.status).toBe("GEOCODING_UNAVAILABLE");
    expect(result.nearestNetworkLocation).toBeNull();
    expect(repo.spy).not.toHaveBeenCalled();
  });

  it("marcador ajustado manualmente: usa as coordenadas informadas e dispensa geocodificação", async () => {
    const { latitude, longitude } = POINT_INSIDE_BARREIRO;
    const geocoder = geocoderReturning({});
    const repo = repoWith([fakeElement("2780", "BHZ-C0016-RT10-CT03_2780", latitude, longitude)]);
    const result = await checkViabilityByAddress(
      { address, adjustedLocation: { latitude, longitude } },
      { geocoder, repository: repo }
    );
    expect(geocoder.spy).not.toHaveBeenCalled();
    expect(result.searchedAddress.manuallyAdjusted).toBe(true);
    expect(result.searchedAddress.geocodingConfidence).toBeNull();
    expect(result.status).toBe("PRELIMINARILY_VIABLE");
  });

  it("ponto sem identificador útil segue na análise, com NOT_IDENTIFIED e confirmação técnica", async () => {
    const { latitude, longitude } = POINT_INSIDE_BARREIRO;
    const repo = repoWith([fakeElement("1", "SPLITTER 1_48", latitude, longitude)]);
    const result = await checkViabilityByAddress(
      { address },
      { geocoder: geocoderReturning({}), repository: repo }
    );
    expect(result.nearestNetworkLocation?.identificationStatus).toBe("NOT_IDENTIFIED");
    expect(result.nearestNetworkLocation?.identifiers).toEqual([]);
    expect(result.requiresTechnicalConfirmation).toBe(true);
  });
});

describe("POST /api/viabilities/check e /confirm-location (endereço, HTTP)", () => {
  const app = createApp();
  let viewerToken = "";

  beforeAll(async () => {
    await resetAppDatabase();
    const viewer = await createTestUser({ role: "VIEWER", email: "addr-viewer@teste.local" });
    viewerToken = (await loginAs(app, viewer.email)).accessToken;
  });
  afterAll(resetAppDatabase);

  it("consulta sem autenticação retorna 401 (check e confirm-location)", async () => {
    for (const route of ["/api/viabilities/check", "/api/viabilities/confirm-location"]) {
      const res = await request(app).post(route).send({
        address: { street: "Rua X", number: "1", city: "BH", state: "MG" },
      });
      expect(res.status).toBe(401);
    }
  });

  it("qualquer perfil autenticado consulta viabilidade (VIEWER incluído)", async () => {
    loadCoverage();
    const res = await request(app)
      .post("/api/viabilities/check")
      .set("Authorization", `Bearer ${viewerToken}`)
      .send({
        address: { street: "Rua Exemplo", number: "100", city: "Belo Horizonte", state: "MG" },
        adjustedLocation: POINT_OUTSIDE,
      });
    expect(res.status).toBe(200);
    expect(res.body.status).toBe("OUTSIDE_COVERAGE");
  });

  it("POST /confirm-location aceita o ajuste do marcador autenticado", async () => {
    loadCoverage();
    const res = await request(app)
      .post("/api/viabilities/confirm-location")
      .set("Authorization", `Bearer ${viewerToken}`)
      .send({
        address: { street: "Rua Exemplo", number: "100", city: "Belo Horizonte", state: "MG" },
        adjustedLocation: POINT_INSIDE_BARREIRO,
      });
    expect(res.status).toBe(200);
    expect(res.body.searchedAddress.manuallyAdjusted).toBe(true);
  });

  it("valida o endereço (UF errada → 400)", async () => {
    const res = await request(app)
      .post("/api/viabilities/check")
      .set("Authorization", `Bearer ${viewerToken}`)
      .send({
        address: {
          street: "Rua Exemplo",
          number: "100",
          city: "Belo Horizonte",
          state: "Minas Gerais",
        },
      });
    expect(res.status).toBe(400);
    expect(["VALIDATION_ERROR", "INVALID_ADDRESS"]).toContain(res.body.error.code);
  });

  it("rejeita body sem endereço", async () => {
    const res = await request(app)
      .post("/api/viabilities/check")
      .set("Authorization", `Bearer ${viewerToken}`)
      .send({ latitude: -19.9, longitude: -44.0 });
    expect(res.status).toBe(400);
  });
});
