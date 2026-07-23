import {
  coverageSnapshotStore,
  CoverageSnapshotLayer,
} from "../stores/coverage-snapshot.store";
import {
  CoverageArea,
  CoveragePolygon,
  GeographicCoordinate,
} from "../types/coverage.types";

/**
 * Point-in-polygon por ray casting (par/impar) com tratamento explicito de
 * bordas:
 * - ponto sobre a borda (ou vertice) do anel EXTERNO → dentro da cobertura;
 * - ponto sobre a borda de um BURACO → fora daquela cobertura;
 * - o resultado nao depende do sentido nem da ordem dos vertices.
 *
 * Tolerancia de borda: EDGE_TOLERANCE_DEGREES = 1e-7 grau (~1,1 cm de
 * latitude). Calculo planar em graus — adequado para manchas municipais;
 * nao trata poligonos que cruzam o antimeridiano.
 *
 * Coordenadas na convencao da aplicacao (latitude, longitude); a conversao a
 * partir do KML (longitude, latitude) acontece no parser.
 */

export const EDGE_TOLERANCE_DEGREES = 1e-7;

/** Distancia (em graus, planar) do ponto ao segmento AB <= tolerancia? */
export function isPointOnSegment(
  point: GeographicCoordinate,
  a: GeographicCoordinate,
  b: GeographicCoordinate,
  toleranceDegrees: number = EDGE_TOLERANCE_DEGREES
): boolean {
  const px = point.longitude;
  const py = point.latitude;
  const ax = a.longitude;
  const ay = a.latitude;
  const bx = b.longitude;
  const by = b.latitude;

  const abx = bx - ax;
  const aby = by - ay;
  const lengthSquared = abx * abx + aby * aby;

  let closestX = ax;
  let closestY = ay;
  if (lengthSquared > 0) {
    // Projecao do ponto no segmento, limitada aos extremos.
    const t = Math.max(0, Math.min(1, ((px - ax) * abx + (py - ay) * aby) / lengthSquared));
    closestX = ax + t * abx;
    closestY = ay + t * aby;
  }

  const dx = px - closestX;
  const dy = py - closestY;
  return Math.sqrt(dx * dx + dy * dy) <= toleranceDegrees;
}

export function isPointOnRingEdge(
  latitude: number,
  longitude: number,
  ring: GeographicCoordinate[]
): boolean {
  const point: GeographicCoordinate = { latitude, longitude };
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    if (isPointOnSegment(point, ring[j], ring[i])) return true;
  }
  return false;
}

export function isPointInRing(
  latitude: number,
  longitude: number,
  ring: GeographicCoordinate[]
): boolean {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const yi = ring[i].latitude;
    const xi = ring[i].longitude;
    const yj = ring[j].latitude;
    const xj = ring[j].longitude;
    const intersects =
      yi > latitude !== yj > latitude &&
      longitude < ((xj - xi) * (latitude - yi)) / (yj - yi) + xi;
    if (intersects) inside = !inside;
  }
  return inside;
}

export function isPointInPolygon(
  latitude: number,
  longitude: number,
  polygon: CoveragePolygon
): boolean {
  // Borda de buraco tem prioridade: e considerada FORA daquela cobertura.
  for (const hole of polygon.innerRings) {
    if (isPointOnRingEdge(latitude, longitude, hole)) return false;
    if (isPointInRing(latitude, longitude, hole)) return false;
  }
  // Borda (ou vertice) do anel externo: DENTRO da cobertura.
  if (isPointOnRingEdge(latitude, longitude, polygon.outerRing)) return true;
  return isPointInRing(latitude, longitude, polygon.outerRing);
}

export function isPointInArea(latitude: number, longitude: number, area: CoverageArea): boolean {
  return area.polygons.some((polygon) => isPointInPolygon(latitude, longitude, polygon));
}

export interface CoverageLayerMatch {
  layer: CoverageSnapshotLayer;
  matchedAreas: CoverageArea[];
}

/**
 * Retorna TODAS as camadas do snapshot que contem o ponto — cada uma com as
 * areas correspondentes. Camadas e areas podem se sobrepor; a ordem segue a
 * ordem de carga do snapshot (createdAt da camada, ordem de leitura do KML
 * dentro dela). A PRIMEIRA area do primeiro match e a area principal.
 */
export function findCoverageLayerMatches(
  latitude: number,
  longitude: number
): CoverageLayerMatch[] {
  const matches: CoverageLayerMatch[] = [];
  for (const layer of coverageSnapshotStore.getLayers()) {
    const matchedAreas = layer.areas.filter((area) =>
      isPointInArea(latitude, longitude, area)
    );
    if (matchedAreas.length > 0) matches.push({ layer, matchedAreas });
  }
  return matches;
}

/** Compat: todas as areas (de todas as camadas) que contem o ponto. */
export function findCoverageAreasForPoint(latitude: number, longitude: number): CoverageArea[] {
  return findCoverageLayerMatches(latitude, longitude).flatMap((match) => match.matchedAreas);
}
