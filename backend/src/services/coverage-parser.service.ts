import { createHash } from "crypto";
import { XMLParser } from "fast-xml-parser";
import {
  CoverageParseResult,
  CoveragePolygon,
  GeographicCoordinate,
} from "../types/coverage.types";
import { isValidLatitude, isValidLongitude } from "../utils/haversine";

/**
 * Interpreta um KML de MANCHAS DE COBERTURA.
 * Extrai Placemarks com Polygon (inclusive dentro de MultiGeometry), com
 * anel externo (outerBoundaryIs), aneis internos/buracos (innerBoundaryIs)
 * e pastas aninhadas. Pontos e LineStrings NAO sao areas de cobertura e sao
 * apenas contabilizados como ignorados no resumo da carga.
 */

interface RawNode {
  [key: string]: unknown;
}

const parser = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: "@_",
  removeNSPrefix: true,
  trimValues: true,
  isArray: (name) =>
    ["Folder", "Placemark", "Data", "SimpleData", "SchemaData", "Polygon", "innerBoundaryIs"].includes(
      name
    ),
});

function asText(value: unknown): string | null {
  if (value === undefined || value === null) return null;
  if (typeof value === "string") return value.trim() || null;
  if (typeof value === "number" || typeof value === "boolean") return String(value);
  if (typeof value === "object" && "#text" in (value as RawNode)) {
    return asText((value as RawNode)["#text"]);
  }
  return null;
}

function extractExtendedData(placemark: RawNode): Record<string, string> {
  const result: Record<string, string> = {};
  const extended = placemark["ExtendedData"] as RawNode | undefined;
  if (!extended) return result;

  const dataEntries = (extended["Data"] as RawNode[] | undefined) ?? [];
  for (const entry of dataEntries) {
    const key = asText(entry["@_name"]);
    const value = asText(entry["value"]);
    if (key && value !== null) result[key] = value;
  }

  const schemaBlocks = (extended["SchemaData"] as RawNode[] | undefined) ?? [];
  for (const block of schemaBlocks) {
    const simple = (block["SimpleData"] as RawNode[] | undefined) ?? [];
    for (const entry of simple) {
      const key = asText(entry["@_name"]);
      const value = asText(entry["#text"] ?? entry);
      if (key && value !== null) result[key] = value;
    }
  }
  return result;
}

/**
 * Converte a lista de coordenadas KML ("lng,lat[,alt]" separadas por espaco)
 * para a convencao da aplicacao (latitude, longitude).
 * Retorna null quando o anel nao tem ao menos 3 vertices validos.
 */
export function parseCoordinateList(raw: string | null): GeographicCoordinate[] | null {
  if (!raw) return null;
  const ring: GeographicCoordinate[] = [];
  for (const token of raw.split(/\s+/)) {
    if (!token) continue;
    const parts = token.split(",");
    if (parts.length < 2) return null;
    const longitude = Number(parts[0]);
    const latitude = Number(parts[1]);
    if (!isValidLatitude(latitude) || !isValidLongitude(longitude)) return null;
    ring.push({ latitude, longitude });
  }
  // Remove o vertice de fechamento repetido, comum em KML.
  if (
    ring.length > 1 &&
    ring[0].latitude === ring[ring.length - 1].latitude &&
    ring[0].longitude === ring[ring.length - 1].longitude
  ) {
    ring.pop();
  }
  return ring.length >= 3 ? ring : null;
}

function extractRing(boundary: RawNode | undefined): GeographicCoordinate[] | null {
  if (!boundary) return null;
  const linearRing = boundary["LinearRing"] as RawNode | undefined;
  if (!linearRing) return null;
  return parseCoordinateList(asText(linearRing["coordinates"]));
}

function parsePolygonNode(node: RawNode): CoveragePolygon | null {
  const outerRing = extractRing(node["outerBoundaryIs"] as RawNode | undefined);
  if (!outerRing) return null;
  const innerRings: GeographicCoordinate[][] = [];
  const innerBoundaries = (node["innerBoundaryIs"] as RawNode[] | undefined) ?? [];
  for (const inner of innerBoundaries) {
    const ring = extractRing(inner);
    if (ring) innerRings.push(ring);
  }
  return { outerRing, innerRings };
}

/** Coleta recursivamente todos os Polygon de uma geometria (inclui MultiGeometry). */
function collectPolygonNodes(geometryHolder: RawNode, out: RawNode[]): void {
  const polygons = (geometryHolder["Polygon"] as RawNode[] | undefined) ?? [];
  out.push(...polygons);
  const multi = geometryHolder["MultiGeometry"] as RawNode | RawNode[] | undefined;
  if (multi) {
    for (const m of Array.isArray(multi) ? multi : [multi]) {
      collectPolygonNodes(m, out);
    }
  }
}

function countGeometry(holder: RawNode, tag: "Point" | "LineString"): number {
  const value = holder[tag] as RawNode | RawNode[] | undefined;
  let count = value ? (Array.isArray(value) ? value.length : 1) : 0;
  const multi = holder["MultiGeometry"] as RawNode | RawNode[] | undefined;
  if (multi) {
    for (const m of Array.isArray(multi) ? multi : [multi]) {
      count += countGeometry(m, tag);
    }
  }
  return count;
}

function buildInternalId(name: string | null, folderPath: string | null, polygons: CoveragePolygon[]): string {
  const first = polygons[0]?.outerRing[0];
  const base = `${name ?? ""}|${folderPath ?? ""}|${first ? `${first.latitude.toFixed(7)},${first.longitude.toFixed(7)}` : ""}|${polygons.length}`;
  return createHash("sha1").update(base).digest("hex").slice(0, 16);
}

function detectPartner(extendedData: Record<string, string>, folderPath: string | null): string | null {
  for (const key of Object.keys(extendedData)) {
    if (["partner", "parceiro", "operadora", "rede"].includes(key.toLowerCase())) {
      return extendedData[key];
    }
  }
  if (folderPath) return folderPath.split("/")[0] || null;
  return null;
}

function walk(
  node: RawNode,
  folderPath: string[],
  source: "KML" | "KMZ",
  out: CoverageParseResult
): void {
  const placemarks = (node["Placemark"] as RawNode[] | undefined) ?? [];
  for (const pm of placemarks) {
    out.ignoredPoints += countGeometry(pm, "Point");
    out.ignoredLines += countGeometry(pm, "LineString");

    const polygonNodes: RawNode[] = [];
    collectPolygonNodes(pm, polygonNodes);
    if (polygonNodes.length === 0) continue;

    const polygons: CoveragePolygon[] = [];
    for (const polygonNode of polygonNodes) {
      const polygon = parsePolygonNode(polygonNode);
      if (polygon) polygons.push(polygon);
      else out.rejectedGeometries += 1;
    }
    if (polygons.length === 0) continue;

    const path = folderPath.length ? folderPath.join("/") : null;
    const extendedData = extractExtendedData(pm);
    out.areas.push({
      internalId: buildInternalId(asText(pm["name"]), path, polygons),
      name: asText(pm["name"]),
      description: asText(pm["description"]),
      folderPath: path,
      partner: detectPartner(extendedData, path),
      polygons,
      extendedData,
      source,
    });
    out.totalPolygons += polygons.length;
  }

  const folders = (node["Folder"] as RawNode[] | undefined) ?? [];
  for (const folder of folders) {
    const folderName = asText(folder["name"]);
    walk(folder, folderName ? [...folderPath, folderName] : folderPath, source, out);
  }

  const document = node["Document"] as RawNode | undefined;
  if (document) walk(document, folderPath, source, out);
}

export function parseCoverageKml(kmlContent: string, source: "KML" | "KMZ"): CoverageParseResult {
  const parsed = parser.parse(kmlContent) as RawNode;
  const kml = (parsed["kml"] as RawNode | undefined) ?? parsed;
  const out: CoverageParseResult = {
    areas: [],
    totalPolygons: 0,
    ignoredPoints: 0,
    ignoredLines: 0,
    rejectedGeometries: 0,
  };
  walk(kml, [], source, out);
  return out;
}
