import { createHash } from "crypto";
import { NetworkLocation, VoalleNetworkElement } from "../types/viability.types";
import { calculateDistanceInMeters } from "../utils/haversine";
import { compareVoalleIds } from "../utils/voalle-id";

/**
 * Registros do Voalle com a MESMA coordenada representam elementos instalados
 * em um mesmo ponto fisico de rede (ex.: SPLITTER 1..4 na mesma caixa).
 *
 * Regras (documentadas e testadas):
 * - A chave de agrupamento e a coordenada normalizada com 7 casas decimais:
 *   `${latitude.toFixed(7)},${longitude.toFixed(7)}`.
 * - Somente coordenadas EQUIVALENTES apos a normalizacao sao agrupadas;
 *   pontos apenas "proximos" NAO sao agrupados nesta versao.
 * - Os elementos de cada grupo sao ordenados por id.
 * - O endereco do grupo e o primeiro endereco nao vazio encontrado
 *   (na ordem de id).
 * - A distancia ate o ponto consultado e calculada UMA unica vez por grupo.
 * - Nada de portas: ocupacao/disponibilidade nao e calculada nem somada.
 */

export function normalizeCoordinateKey(latitude: number, longitude: number): string {
  return `${latitude.toFixed(7)},${longitude.toFixed(7)}`;
}

function hasAnyAddressField(element: VoalleNetworkElement): boolean {
  return Boolean(
    element.street ||
      element.addressNumber ||
      element.neighborhood ||
      element.city ||
      element.postalCode
  );
}

export function groupElementsByLocation(
  elements: VoalleNetworkElement[],
  queryLatitude: number,
  queryLongitude: number
): NetworkLocation[] {
  const groups = new Map<string, VoalleNetworkElement[]>();
  for (const element of elements) {
    const key = normalizeCoordinateKey(element.latitude, element.longitude);
    const bucket = groups.get(key);
    if (bucket) bucket.push(element);
    else groups.set(key, [element]);
  }

  const locations: NetworkLocation[] = [];
  for (const [key, groupElements] of groups) {
    const sorted = [...groupElements].sort((a, b) => compareVoalleIds(a.id, b.id));
    const reference = sorted[0];
    const withAddress = sorted.find(hasAnyAddressField);
    const distanceMeters = calculateDistanceInMeters(
      queryLatitude,
      queryLongitude,
      reference.latitude,
      reference.longitude
    );
    locations.push({
      internalId: createHash("sha1").update(key).digest("hex").slice(0, 16),
      latitude: reference.latitude,
      longitude: reference.longitude,
      distanceMeters: Number(distanceMeters.toFixed(1)),
      address: withAddress
        ? {
            street: withAddress.street,
            number: withAddress.addressNumber,
            neighborhood: withAddress.neighborhood,
            city: withAddress.city,
            postalCode: withAddress.postalCode,
          }
        : null,
      elements: sorted,
    });
  }

  return locations.sort(
    (a, b) => a.distanceMeters - b.distanceMeters || a.internalId.localeCompare(b.internalId)
  );
}
