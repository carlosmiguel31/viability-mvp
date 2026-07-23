export interface AddressInput {
  postalCode?: string | null;
  street: string;
  number: string;
  complement?: string | null;
  neighborhood?: string | null;
  city: string;
  state: string;
  country?: string;
}

export interface NormalizedAddress {
  postalCode: string | null;
  street: string;
  number: string;
  complement: string | null;
  neighborhood: string | null;
  city: string;
  state: string;
  country: string;
}

export interface PostalCodeAddress {
  postalCode: string;
  street: string | null;
  neighborhood: string | null;
  city: string | null;
  state: string | null;
}

export interface PostalCodeProvider {
  findAddressByPostalCode(postalCode: string): Promise<PostalCodeAddress | null>;
}

export type GeocodingConfidence = "HIGH" | "MEDIUM" | "LOW";

export type GeocodingLocationType =
  | "ROOFTOP"
  | "RANGE_INTERPOLATED"
  | "GEOMETRIC_CENTER"
  | "APPROXIMATE"
  | "UNKNOWN";

export interface GeocodingResult {
  latitude: number;
  longitude: number;
  formattedAddress: string;
  confidence: GeocodingConfidence;
  provider: string;
  partialMatch: boolean;
  /** location_type bruto do provider (UNKNOWN quando nao informado). */
  locationType: GeocodingLocationType;
}

export interface GeocodingProvider {
  geocodeAddress(address: NormalizedAddress): Promise<GeocodingResult>;
}
