import { env } from "../config/env";
import { findCoverageLayerMatches } from "./coverage-geo.service";
import { groupElementsByLocation } from "./network-grouping.service";
import { coverageSnapshotStore } from "../stores/coverage-snapshot.store";
import { VoalleRepository, voalleRepository } from "../repositories/voalle.repository";
import {
  CoverageAreaSummary,
  CoverageMatch,
  NetworkReferenceStatus,
  ViabilityResponse,
} from "../types/viability.types";
import { CoverageArea } from "../types/coverage.types";
import { logger } from "../utils/logger";

const ANALYSIS_BASIS =
  "A mancha KML/KMZ é a fonte oficial da cobertura. Os dados do Voalle são utilizados somente para localizar referências de rede próximas. A viabilidade final depende de validação técnica.";

const MESSAGES = {
  PRELIMINARILY_VIABLE:
    "O endereço está dentro da área de cobertura e possui viabilidade preliminar.",
  OUTSIDE_COVERAGE: "O endereço está fora das áreas de cobertura cadastradas.",
  COVERAGE_NOT_LOADED:
    "As manchas de cobertura ainda não foram carregadas. Tente novamente em instantes.",
  COVERAGE_NOT_CONFIGURED:
    "Nenhuma cobertura está configurada no momento. Cadastre e ative pelo menos uma camada de cobertura.",
} as const;

const NETWORK_REFERENCE_MESSAGES: Partial<Record<NetworkReferenceStatus, string>> = {
  NOT_FOUND:
    "Não foi possível identificar automaticamente um ponto de rede próximo no Voalle.",
  VOALLE_UNAVAILABLE:
    "O endereço está dentro da cobertura, mas não foi possível consultar as referências de rede no momento.",
};

function toSummary(area: CoverageArea): CoverageAreaSummary {
  return { internalId: area.internalId, name: area.name, folderPath: area.folderPath };
}

/**
 * REGRA PRINCIPAL: a mancha KML/KMZ e a fonte OFICIAL da cobertura.
 * - Dentro de QUALQUER poligono (inclusive areas com nomes como
 *   "IMPLANTAR - POP VTA" — todo poligono do arquivo e mancha valida; o nome
 *   e apenas exibido) → PRELIMINARILY_VIABLE.
 * - Fora de todos → OUTSIDE_COVERAGE, e o Voalle NAO e consultado.
 *
 * O Voalle e consultado SOMENTE como referencia de rede (raio
 * NETWORK_REFERENCE_SEARCH_RADIUS_METERS). Ausencia de pontos ou
 * indisponibilidade NUNCA altera a viabilidade confirmada pela mancha —
 * apenas o networkReferenceStatus (FOUND / NOT_FOUND / VOALLE_UNAVAILABLE /
 * NOT_CHECKED). Ocupacao de portas nao e consultada nem retornada.
 */
export async function checkViability(
  input: { latitude: number; longitude: number },
  repository: VoalleRepository = voalleRepository
): Promise<ViabilityResponse> {
  const startedAt = Date.now();
  const searchedLocation = { latitude: input.latitude, longitude: input.longitude };

  const base = {
    searchedLocation,
    analysisBasis: ANALYSIS_BASIS,
    nearestNetworkLocation: null,
    alternatives: [] as ViabilityResponse["alternatives"],
    networkReferenceStatus: "NOT_CHECKED" as NetworkReferenceStatus,
    networkReferenceMessage: null,
  };

  if (!coverageSnapshotStore.isConfigured()) {
    // Sem NENHUMA camada ativa cadastrada: informar claramente, em vez de
    // tratar todos os enderecos como fora da cobertura silenciosamente.
    return {
      ...base,
      status: "COVERAGE_NOT_CONFIGURED",
      message: MESSAGES.COVERAGE_NOT_CONFIGURED,
      coverageMatches: [],
      coverage: { insideCoverage: false, primaryArea: null, matchingAreas: [] },
      requiresTechnicalConfirmation: false,
    };
  }

  const layerMatches = findCoverageLayerMatches(input.latitude, input.longitude);
  if (layerMatches.length === 0) {
    // Fora da cobertura: o Voalle NAO e consultado (NOT_CHECKED).
    return {
      ...base,
      status: "OUTSIDE_COVERAGE",
      message: MESSAGES.OUTSIDE_COVERAGE,
      coverageMatches: [],
      coverage: { insideCoverage: false, primaryArea: null, matchingAreas: [] },
      requiresTechnicalConfirmation: false,
    };
  }

  // Todas as camadas/parceiros que cobrem o ponto, sem duplicacoes.
  const seenLayers = new Set<string>();
  const coverageMatches: CoverageMatch[] = [];
  for (const match of layerMatches) {
    if (seenLayers.has(match.layer.layerId)) continue;
    seenLayers.add(match.layer.layerId);
    coverageMatches.push({
      partnerId: match.layer.partnerId,
      partnerName: match.layer.partnerName,
      layerId: match.layer.layerId,
      layerName: match.layer.layerName,
      version: match.layer.version,
    });
  }

  // Dentro da mancha: viabilidade preliminar JA esta definida.
  const matching = layerMatches.flatMap((match) => match.matchedAreas);
  const coverage = {
    insideCoverage: true,
    primaryArea: toSummary(matching[0]),
    matchingAreas: matching.slice(1).map(toSummary),
  };

  let networkReferenceStatus: NetworkReferenceStatus;
  let nearest: ViabilityResponse["nearestNetworkLocation"] = null;
  let alternatives: ViabilityResponse["alternatives"] = [];

  try {
    const elements = await repository.findNetworkElementsNearCoordinates(
      input.latitude,
      input.longitude,
      env.NETWORK_REFERENCE_SEARCH_RADIUS_METERS
    );
    const locations = groupElementsByLocation(elements, input.latitude, input.longitude);
    nearest = locations[0] ?? null;
    alternatives = locations.slice(1, 1 + env.MAX_NETWORK_ALTERNATIVES);
    networkReferenceStatus = nearest ? "FOUND" : "NOT_FOUND";
  } catch (err) {
    // A indisponibilidade do Voalle nao reprova a cobertura confirmada pelo KML.
    const message = err instanceof Error ? err.message : "erro desconhecido";
    logger.warn("Voalle indisponivel durante busca de referencia de rede", { message });
    networkReferenceStatus = "VOALLE_UNAVAILABLE";
  }

  logger.info("Consulta de viabilidade concluida", {
    status: "PRELIMINARILY_VIABLE",
    networkReferenceStatus,
    areas: matching.length,
    durationMs: Date.now() - startedAt,
  });

  return {
    status: "PRELIMINARILY_VIABLE",
    message: MESSAGES.PRELIMINARILY_VIABLE,
    coverageMatches,
    networkReferenceStatus,
    networkReferenceMessage: NETWORK_REFERENCE_MESSAGES[networkReferenceStatus] ?? null,
    searchedLocation,
    coverage,
    nearestNetworkLocation: nearest,
    alternatives,
    requiresTechnicalConfirmation: true,
    analysisBasis: ANALYSIS_BASIS,
  };
}
