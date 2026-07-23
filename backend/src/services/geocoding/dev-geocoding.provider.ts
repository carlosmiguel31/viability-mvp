import { env } from "../../config/env";
import {
  GeocodingProvider,
  GeocodingResult,
  NormalizedAddress,
} from "../../types/address.types";
import { formatAddressFromInput } from "../address.service";
import { GeocodingUnavailableError } from "./geocoding.errors";

/**
 * Provider SOMENTE para desenvolvimento (GEOCODING_PROVIDER=dev): retorna a
 * coordenada fixa configurada em DEV_GEOCODING_FIXED_LAT/LNG com confianca
 * LOW e partialMatch=true — ou seja, SEMPRE exige confirmacao/ajuste do
 * marcador no mapa. Nenhuma coordenada e estimada silenciosamente; sem as
 * variaveis configuradas, o provider se declara indisponivel.
 */
export class DevGeocodingProvider implements GeocodingProvider {
  async geocodeAddress(address: NormalizedAddress): Promise<GeocodingResult> {
    const { DEV_GEOCODING_FIXED_LAT: lat, DEV_GEOCODING_FIXED_LNG: lng } = env;
    if (lat === undefined || lng === undefined) {
      throw new GeocodingUnavailableError();
    }
    return {
      latitude: lat,
      longitude: lng,
      formattedAddress: `${formatAddressFromInput(address)} (dev)`,
      confidence: "LOW",
      provider: "dev",
      partialMatch: true,
    };
  }
}
