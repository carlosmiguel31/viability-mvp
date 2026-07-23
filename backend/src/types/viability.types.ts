/**
 * Elemento de rede cadastrado no Voalle (erp.authentication_splitters).
 * Os titulos NAO representam apenas splitters — tambem existem registros
 * como ROTA e COLETOR, por isso o nome generico.
 * Tipos reais confirmados: id bigint, title/lat/lng character varying.
 */
export interface VoalleNetworkElement {
  /** bigint no banco — mantido como string para nao perder precisao. */
  id: string;
  title: string;
  street: string | null;
  addressNumber: string | null;
  neighborhood: string | null;
  city: string | null;
  postalCode: string | null;
  latitude: number;
  longitude: number;
}

/**
 * Ponto fisico de rede: agrupamento dos elementos do Voalle que possuem
 * exatamente a mesma coordenada (apos normalizacao com 7 casas decimais).
 */
export interface NetworkLocation {
  internalId: string;
  latitude: number;
  longitude: number;
  distanceMeters: number;
  address: {
    street: string | null;
    number: string | null;
    neighborhood: string | null;
    city: string | null;
    postalCode: string | null;
  } | null;
  elements: VoalleNetworkElement[];
}

/**
 * A mancha KML/KMZ e a fonte OFICIAL da cobertura: dentro de qualquer
 * poligono → PRELIMINARILY_VIABLE; fora de todos → OUTSIDE_COVERAGE.
 * Os demais status cobrem cobertura nao carregada e falhas de geocodificacao.
 */
export interface CoverageMatch {
  partnerId: string;
  partnerName: string;
  layerId: string;
  layerName: string;
  version: string | null;
}

export type ViabilityStatus =
  | "PRELIMINARILY_VIABLE"
  | "OUTSIDE_COVERAGE"
  | "COVERAGE_NOT_LOADED"
  | "COVERAGE_NOT_CONFIGURED"
  | "ADDRESS_NOT_FOUND"
  | "ADDRESS_AMBIGUOUS"
  | "GEOCODING_UNAVAILABLE";

/**
 * Situacao da REFERENCIA de rede (Voalle) — informacao complementar que
 * NUNCA aprova nem reprova a cobertura confirmada pela mancha.
 */
export type NetworkReferenceStatus =
  | "FOUND"
  | "NOT_FOUND"
  | "VOALLE_UNAVAILABLE"
  | "NOT_CHECKED";

/** @deprecated compatibilidade: o fluxo por endereco usa ViabilityStatus. */
export type AddressViabilityStatus = ViabilityStatus;

export interface CoverageAreaSummary {
  internalId: string;
  name: string | null;
  folderPath: string | null;
}

export interface ViabilityResponse {
  status: ViabilityStatus;
  message: string;
  /**
   * Camadas de cobertura (parceiro + camada + versao) que contem o ponto.
   * coverageMatches.length > 0 <=> PRELIMINARILY_VIABLE. Sem duplicacoes;
   * o poligono completo NUNCA e exposto aqui.
   */
  coverageMatches: CoverageMatch[];
  /** Situacao da busca de referencia de rede no Voalle (complementar). */
  networkReferenceStatus: NetworkReferenceStatus;
  /** Mensagem complementar sobre a referencia de rede, quando aplicavel. */
  networkReferenceMessage: string | null;
  searchedLocation: { latitude: number; longitude: number };
  coverage: {
    insideCoverage: boolean;
    /** Primeira area valida na ordem de leitura do KML (regra documentada). */
    primaryArea: CoverageAreaSummary | null;
    /** Demais areas sobrepostas que tambem contem o ponto. */
    matchingAreas: CoverageAreaSummary[];
  };
  nearestNetworkLocation: NetworkLocation | null;
  alternatives: NetworkLocation[];
  requiresTechnicalConfirmation: boolean;
  analysisBasis: string;
}

/**
 * Modelo PUBLICO do ponto de rede: apenas identificadores padronizados
 * (ex.: BHZ-C0016-RT10-CT03_2780). Titulos tecnicos (SPLITTER/ROTA/COLETOR),
 * enderecos internos dos elementos e qualquer nocao de portas NAO sao
 * expostos ao operador.
 */
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
  /** null quando o operador ajustou o marcador manualmente. */
  geocodingConfidence: "HIGH" | "MEDIUM" | "LOW" | null;
  manuallyAdjusted: boolean;
}

export interface AddressViabilityResponse {
  status: ViabilityStatus;
  message: string;
  /** Camadas (parceiro + camada + versao) que cobrem o endereco. */
  coverageMatches: CoverageMatch[];
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
