/** A mancha KML/KMZ decide: dentro → viável preliminarmente; fora → sem cobertura. */
export type ViabilityStatus =
  | "PRELIMINARILY_VIABLE"
  | "OUTSIDE_COVERAGE"
  | "COVERAGE_NOT_LOADED"
  | "ADDRESS_NOT_FOUND"
  | "ADDRESS_AMBIGUOUS"
  | "GEOCODING_UNAVAILABLE";

/** Referência de rede (Voalle) — complementar, nunca altera a viabilidade. */
export type NetworkReferenceStatus = "FOUND" | "NOT_FOUND" | "VOALLE_UNAVAILABLE" | "NOT_CHECKED";

export interface GeographicCoordinate {
  latitude: number;
  longitude: number;
}

export interface CoveragePolygon {
  outerRing: GeographicCoordinate[];
  innerRings: GeographicCoordinate[][];
}

export interface CoverageAreaSummary {
  internalId: string;
  name: string | null;
  folderPath: string | null;
}

export interface CoverageAreaWithPolygons extends CoverageAreaSummary {
  polygons: CoveragePolygon[];
}

export interface AddressFormValues {
  postalCode: string;
  street: string;
  number: string;
  complement: string;
  neighborhood: string;
  city: string;
  state: string;
}

export interface PostalCodeAddress {
  postalCode: string;
  street: string | null;
  neighborhood: string | null;
  city: string | null;
  state: string | null;
}

export interface PublicNetworkLocation {
  internalId: string;
  latitude: number;
  longitude: number;
  distanceMeters: number;
  identifiers: Array<{ id: string; code: string }>;
  identificationStatus: "IDENTIFIED" | "NOT_IDENTIFIED";
}

export interface SearchedAddress {
  input: {
    postalCode: string | null;
    street: string;
    number: string;
    complement: string | null;
    neighborhood: string | null;
    city: string;
    state: string;
  };
  formattedAddress: string;
  latitude: number | null;
  longitude: number | null;
  geocodingConfidence: "HIGH" | "MEDIUM" | "LOW" | null;
  manuallyAdjusted: boolean;
}

export interface AddressViabilityResponse {
  status: ViabilityStatus;
  message: string;
  networkReferenceStatus: NetworkReferenceStatus;
  networkReferenceMessage: string | null;
  searchedAddress: SearchedAddress;
  geocoding?: {
    formattedAddress: string;
    confidence: "HIGH" | "MEDIUM" | "LOW";
    partialMatch: boolean;
  };
  coverage: {
    insideCoverage: boolean;
    primaryArea: CoverageAreaSummary | null;
    matchingAreas: CoverageAreaSummary[];
  };
  nearestNetworkLocation: PublicNetworkLocation | null;
  alternatives: PublicNetworkLocation[];
  requiresTechnicalConfirmation: boolean;
  analysisBasis: string;
}

export interface CoverageStatus {
  loaded: boolean;
  loadedAt: string | null;
  sourceFile: string | null;
  totalAreas: number;
  totalPolygons: number;
  ignoredPoints: number;
  ignoredLines: number;
  rejectedGeometries: number;
}

// ── Autenticação e administração (v0.2.0) ────────────────────
export type UserRole = "ADMIN" | "OPERATOR" | "TECHNICIAN" | "VIEWER";

export const ROLE_LABELS: Record<UserRole, string> = {
  ADMIN: "Administrador",
  OPERATOR: "Operador",
  TECHNICIAN: "Técnico",
  VIEWER: "Visualizador",
};

export interface PublicUser {
  id: string;
  name: string;
  email: string;
  role: UserRole;
  active: boolean;
  lastLoginAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface UsersPage {
  users: PublicUser[];
  total: number;
  page: number;
  pageSize: number;
}

export interface AuditLogEntry {
  id: string;
  action: string;
  entity: string;
  entityId: string | null;
  createdAt: string;
  ipAddress: string | null;
  user: { id: string; name: string; email: string } | null;
}

export interface AuditLogPage {
  logs: AuditLogEntry[];
  total: number;
  page: number;
  pageSize: number;
}
