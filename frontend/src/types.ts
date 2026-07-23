export type GeocodingLocationType =
  | "ROOFTOP"
  | "RANGE_INTERPOLATED"
  | "GEOMETRIC_CENTER"
  | "APPROXIMATE"
  | "UNKNOWN";

/** A mancha KML/KMZ decide: dentro → viável preliminarmente; fora → sem cobertura. */
export type ViabilityStatus =
  | "PRELIMINARILY_VIABLE"
  | "OUTSIDE_COVERAGE"
  | "COVERAGE_NOT_LOADED"
  | "COVERAGE_NOT_CONFIGURED"
  | "ADDRESS_NOT_FOUND"
  | "ADDRESS_AMBIGUOUS"
  | "GEOCODING_UNAVAILABLE";

/** Parceiro + camada + versão que cobrem o ponto (deduplicado no backend). */
export interface CoverageMatch {
  partnerId: string;
  partnerName: string;
  layerId: string;
  layerName: string;
  version: string | null;
}

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
  coverageMatches: CoverageMatch[];
  networkReferenceStatus: NetworkReferenceStatus;
  networkReferenceMessage: string | null;
  searchedAddress: SearchedAddress;
  geocoding?: {
    formattedAddress: string;
    confidence: "HIGH" | "MEDIUM" | "LOW";
    partialMatch: boolean;
    locationType: GeocodingLocationType;
  };
  /** Token opaco p/ confirmar/ajustar o marcador (curta duração, só em memória). */
  locationConfirmationToken?: string;
  coverage: {
    insideCoverage: boolean;
    primaryArea: CoverageAreaSummary | null;
    matchingAreas: CoverageAreaSummary[];
  };
  nearestNetworkLocation: PublicNetworkLocation | null;
  alternatives: PublicNetworkLocation[];
  requiresTechnicalConfirmation: boolean;
  analysisBasis: string;
  /** Registro do histórico criado para esta consulta (v0.4.0). */
  consultation?: ConsultationRef;
}

export interface CoverageStatus {
  configured: boolean;
  builtAt: string | null;
  totalPartners: number;
  totalLayers: number;
  totalAreas: number;
  totalPolygons: number;
  /** Compatibilidade com o formato anterior. */
  loaded: boolean;
  sourceFile: string | null;
}

// ── Administração de coberturas (v0.3.0) ─────────────────────
export type CoverageProcessingStatus = "PENDING" | "PROCESSING" | "READY" | "FAILED";

export type CoverageFileType = "KML" | "KMZ";

export interface CoveragePartner {
  id: string;
  name: string;
  code: string;
  description: string | null;
  active: boolean;
  layerCount?: number;
  createdAt: string;
  updatedAt: string;
}

export interface CoveragePartnersPage {
  partners: CoveragePartner[];
  total: number;
  page: number;
  limit: number;
}

export interface CoverageLayer {
  id: string;
  partner: { id: string; name: string; code: string };
  name: string;
  description: string | null;
  version: string | null;
  originalFileName: string;
  fileType: CoverageFileType;
  fileSize: number;
  sha256: string;
  active: boolean;
  processingStatus: CoverageProcessingStatus;
  polygonCount: number;
  areaCount: number;
  ignoredGeometryCount: number;
  processingError: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface CoverageLayersPage {
  layers: CoverageLayer[];
  total: number;
  page: number;
  limit: number;
}

export interface CoverageReloadSummary {
  reloaded: boolean;
  totalPartners: number;
  totalLayers: number;
  totalAreas: number;
  totalPolygons: number;
  durationMs?: number;
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

// ── Histórico de consultas (v0.4.0) ──────────────────────────
export interface ConsultationRef {
  id: string;
  protocol: string;
  createdAt: string;
}

export interface ConsultationSummary {
  id: string;
  protocol: string;
  status: ViabilityStatus | string;
  address: {
    postalCode: string | null;
    street: string;
    number: string;
    neighborhood: string | null;
    city: string;
    state: string;
  };
  user: { id: string; name: string } | null;
  coverageMatchCount: number;
  networkReferenceStatus: NetworkReferenceStatus | string;
  createdAt: string;
  durationMs: number | null;
}

export interface ConsultationsPage {
  consultations: ConsultationSummary[];
  total: number;
  page: number;
  limit: number;
}

export interface ConsultationCoverageMatchSnapshot {
  partnerId: string;
  partnerName: string;
  partnerCode: string | null;
  layerId: string;
  layerName: string;
  version: string | null;
}

export interface ConsultationDetail {
  id: string;
  protocol: string;
  status: ViabilityStatus | string;
  resultMessage: string;
  createdAt: string;
  completedAt: string | null;
  durationMs: number | null;
  user: { id: string; name: string; email: string } | null;
  address: {
    postalCode: string | null;
    street: string;
    number: string;
    complement: string | null;
    neighborhood: string | null;
    city: string;
    state: string;
  };
  geocoding: {
    provider: string;
    geocodedAddress: string | null;
    confidence: "HIGH" | "MEDIUM" | "LOW" | null;
    locationType: GeocodingLocationType | null;
    partialMatch: boolean;
    latitude: number | null;
    longitude: number | null;
  };
  confirmation: {
    latitude: number | null;
    longitude: number | null;
    confirmedManually: boolean;
    confirmationRequired: boolean;
  };
  coverage: {
    matches: ConsultationCoverageMatchSnapshot[];
    matchCount: number;
    configured: boolean;
    snapshotBuiltAt: string | null;
  };
  network: {
    status: NetworkReferenceStatus | string;
    reference: {
      latitude: number;
      longitude: number;
      distanceMeters: number;
      identificationStatus: string;
      identifiers: Array<{ id: string; code: string }>;
    } | null;
    alternatives: Array<{ distanceMeters: number }>;
    searchRadiusMeters: number | null;
  };
  source: string | null;
}

export interface ConsultationListParams {
  search?: string;
  protocol?: string;
  status?: string;
  userId?: string;
  postalCode?: string;
  city?: string;
  state?: string;
  dateFrom?: string;
  dateTo?: string;
  hasCoverage?: "" | "true" | "false";
  networkReferenceStatus?: string;
  page?: number;
  sortOrder?: "asc" | "desc";
}
