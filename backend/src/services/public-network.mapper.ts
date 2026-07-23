import { NetworkLocation, PublicNetworkLocation } from "../types/viability.types";
import { classifyNetworkElementTitle } from "../utils/network-identifier";

/**
 * Converte o NetworkLocation interno (todos os elementos do Voalle) no modelo
 * PUBLICO exibido ao operador:
 * - somente titulos classificados como NETWORK_IDENTIFIER viram identifiers
 *   (valor original preservado em `code`, id do registro em `id`);
 * - titulos tecnicos (SPLITTER/ROTA/COLETOR/OTHER) NAO sao expostos nem
 *   usados como substitutos;
 * - duplicados removidos (por codigo, ignorando maiusculas/minusculas,
 *   preservando a primeira ocorrencia);
 * - identificadores ordenados alfabeticamente, sem escolher um arbitrariamente;
 * - enderecos internos dos elementos e qualquer nocao de portas ficam fora.
 */
export function toPublicNetworkLocation(location: NetworkLocation): PublicNetworkLocation {
  const seen = new Set<string>();
  const identifiers: Array<{ id: string; code: string }> = [];

  for (const element of location.elements) {
    if (classifyNetworkElementTitle(element.title) !== "NETWORK_IDENTIFIER") continue;
    const code = element.title.trim();
    const key = code.toUpperCase();
    if (seen.has(key)) continue;
    seen.add(key);
    identifiers.push({ id: element.id, code });
  }

  identifiers.sort((a, b) => a.code.localeCompare(b.code, "pt-BR"));

  return {
    internalId: location.internalId,
    latitude: location.latitude,
    longitude: location.longitude,
    distanceMeters: location.distanceMeters,
    identifiers,
    identificationStatus: identifiers.length > 0 ? "IDENTIFIED" : "NOT_IDENTIFIED",
  };
}
