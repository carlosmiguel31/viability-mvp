import { env } from "../../config/env";
import { GeocodingProvider } from "../../types/address.types";
import { GoogleGeocodingProvider } from "./google-geocoding.provider";
import { DevGeocodingProvider } from "./dev-geocoding.provider";

export function createGeocodingProvider(): GeocodingProvider {
  if (env.GEOCODING_PROVIDER === "dev") return new DevGeocodingProvider();
  return new GoogleGeocodingProvider();
}

export const geocodingProvider: GeocodingProvider = createGeocodingProvider();
