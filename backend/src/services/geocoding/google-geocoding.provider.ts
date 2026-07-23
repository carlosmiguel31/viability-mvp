import { env } from "../../config/env";
import {
  GeocodingConfidence,
  GeocodingProvider,
  GeocodingResult,
  NormalizedAddress,
} from "../../types/address.types";
import { AddressNotFoundError, GeocodingUnavailableError } from "./geocoding.errors";
import { logger } from "../../utils/logger";

/**
 * Geocodificacao executada EXCLUSIVAMENTE pelo backend: a chave da API nunca
 * chega ao navegador e nenhum endereco e persistido. Enderecos completos nao
 * sao registrados em logs de producao.
 */

interface GoogleGeocodeResponse {
  status: string;
  results: Array<{
    formatted_address: string;
    partial_match?: boolean;
    geometry: {
      location: { lat: number; lng: number };
      location_type: "ROOFTOP" | "RANGE_INTERPOLATED" | "GEOMETRIC_CENTER" | "APPROXIMATE";
    };
  }>;
}

const LOCATION_TYPES = new Set([
  "ROOFTOP",
  "RANGE_INTERPOLATED",
  "GEOMETRIC_CENTER",
  "APPROXIMATE",
] as const);

function confidenceFromLocationType(locationType: string): GeocodingConfidence {
  if (locationType === "ROOFTOP") return "HIGH";
  if (locationType === "RANGE_INTERPOLATED") return "MEDIUM";
  return "LOW";
}

export class GoogleGeocodingProvider implements GeocodingProvider {
  constructor(private readonly fetchFn: typeof fetch = fetch) {}

  async geocodeAddress(address: NormalizedAddress): Promise<GeocodingResult> {
    if (!env.GOOGLE_GEOCODING_API_KEY) {
      logger.error("GOOGLE_GEOCODING_API_KEY nao configurada");
      throw new GeocodingUnavailableError();
    }

    const parts = [
      `${address.street}, ${address.number}`,
      address.neighborhood,
      `${address.city} - ${address.state}`,
      address.postalCode,
      address.country,
    ].filter(Boolean);

    const params = new URLSearchParams({
      address: parts.join(", "),
      region: "br",
      key: env.GOOGLE_GEOCODING_API_KEY,
    });

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), env.GEOCODING_TIMEOUT_MS);
    let body: GoogleGeocodeResponse;
    try {
      const response = await this.fetchFn(
        `https://maps.googleapis.com/maps/api/geocode/json?${params.toString()}`,
        { signal: controller.signal }
      );
      if (!response.ok) throw new GeocodingUnavailableError();
      body = (await response.json()) as GoogleGeocodeResponse;
    } catch (err) {
      if (err instanceof GeocodingUnavailableError) throw err;
      logger.warn("Falha na chamada de geocodificacao");
      throw new GeocodingUnavailableError();
    } finally {
      clearTimeout(timeout);
    }

    if (body.status === "ZERO_RESULTS" || body.results.length === 0) {
      throw new AddressNotFoundError();
    }
    if (body.status !== "OK") {
      logger.warn("Geocodificacao retornou status inesperado", { status: body.status });
      throw new GeocodingUnavailableError();
    }

    const first = body.results[0];
    return {
      latitude: first.geometry.location.lat,
      longitude: first.geometry.location.lng,
      formattedAddress: first.formatted_address,
      confidence: confidenceFromLocationType(first.geometry.location_type),
      // location_type do Google preservado no resultado (UNKNOWN se ausente).
      locationType: LOCATION_TYPES.has(first.geometry.location_type)
        ? first.geometry.location_type
        : "UNKNOWN",
      provider: "google",
      // Correspondencia parcial ou multiplos resultados = localizacao ambigua.
      partialMatch: Boolean(first.partial_match) || body.results.length > 1,
    };
  }
}
