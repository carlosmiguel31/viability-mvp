import { describe, expect, it, vi } from "vitest";
import { GoogleGeocodingProvider } from "../src/services/geocoding/google-geocoding.provider";
import {
  AddressNotFoundError,
  GeocodingUnavailableError,
} from "../src/services/geocoding/geocoding.errors";
import { env } from "../src/config/env";
import { normalizeAddressInput } from "../src/services/address.service";

const address = normalizeAddressInput({
  postalCode: "30640-000",
  street: "Rua Exemplo",
  number: "100",
  neighborhood: "Barreiro",
  city: "Belo Horizonte",
  state: "MG",
});

function googleResponse(body: unknown) {
  return { ok: true, json: async () => body } as Response;
}

describe("GoogleGeocodingProvider", () => {
  it("geocodificação bem-sucedida mapeia coordenadas e confiança", async () => {
    env.GOOGLE_GEOCODING_API_KEY = "chave-teste";
    const fetchFn = vi.fn().mockResolvedValue(
      googleResponse({
        status: "OK",
        results: [
          {
            formatted_address: "Rua Exemplo, 100 - Barreiro, Belo Horizonte - MG",
            geometry: {
              location: { lat: -19.9878, lng: -44.0128 },
              location_type: "ROOFTOP",
            },
          },
        ],
      })
    );
    const provider = new GoogleGeocodingProvider(fetchFn as unknown as typeof fetch);
    const result = await provider.geocodeAddress(address);

    expect(result.latitude).toBeCloseTo(-19.9878, 6);
    expect(result.longitude).toBeCloseTo(-44.0128, 6);
    expect(result.confidence).toBe("HIGH");
    expect(result.partialMatch).toBe(false);
    expect(result.provider).toBe("google");

    // A chave vai por parâmetro na chamada do BACKEND, nunca ao navegador.
    const url = String(fetchFn.mock.calls[0][0]);
    expect(url).toContain("maps.googleapis.com");
    env.GOOGLE_GEOCODING_API_KEY = "";
  });

  it("ZERO_RESULTS vira AddressNotFoundError", async () => {
    env.GOOGLE_GEOCODING_API_KEY = "chave-teste";
    const fetchFn = vi.fn().mockResolvedValue(googleResponse({ status: "ZERO_RESULTS", results: [] }));
    const provider = new GoogleGeocodingProvider(fetchFn as unknown as typeof fetch);
    await expect(provider.geocodeAddress(address)).rejects.toBeInstanceOf(AddressNotFoundError);
    env.GOOGLE_GEOCODING_API_KEY = "";
  });

  it("partial_match ou múltiplos resultados marcam partialMatch", async () => {
    env.GOOGLE_GEOCODING_API_KEY = "chave-teste";
    const fetchFn = vi.fn().mockResolvedValue(
      googleResponse({
        status: "OK",
        results: [
          {
            formatted_address: "Aproximado",
            partial_match: true,
            geometry: { location: { lat: -19.9, lng: -44.0 }, location_type: "APPROXIMATE" },
          },
        ],
      })
    );
    const provider = new GoogleGeocodingProvider(fetchFn as unknown as typeof fetch);
    const result = await provider.geocodeAddress(address);
    expect(result.partialMatch).toBe(true);
    expect(result.confidence).toBe("LOW");
    env.GOOGLE_GEOCODING_API_KEY = "";
  });

  it("falha de rede/HTTP vira GeocodingUnavailableError", async () => {
    env.GOOGLE_GEOCODING_API_KEY = "chave-teste";
    const provider = new GoogleGeocodingProvider(
      vi.fn().mockRejectedValue(new Error("timeout")) as unknown as typeof fetch
    );
    await expect(provider.geocodeAddress(address)).rejects.toBeInstanceOf(
      GeocodingUnavailableError
    );
    env.GOOGLE_GEOCODING_API_KEY = "";
  });

  it("sem chave configurada o provider se declara indisponível", async () => {
    env.GOOGLE_GEOCODING_API_KEY = "";
    const provider = new GoogleGeocodingProvider(vi.fn() as unknown as typeof fetch);
    await expect(provider.geocodeAddress(address)).rejects.toBeInstanceOf(
      GeocodingUnavailableError
    );
  });
});
