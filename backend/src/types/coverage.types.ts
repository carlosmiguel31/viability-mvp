export interface GeographicCoordinate {
  latitude: number;
  longitude: number;
}

export interface CoveragePolygon {
  outerRing: GeographicCoordinate[];
  innerRings: GeographicCoordinate[][];
}

/**
 * Mancha de cobertura extraida do KML/KMZ.
 * O arquivo NAO contem pontos de CTO — apenas areas (poligonos).
 */
export interface CoverageArea {
  internalId: string;
  name: string | null;
  folderPath: string | null;
  description: string | null;
  partner: string | null;
  polygons: CoveragePolygon[];
  extendedData: Record<string, string>;
  source: "KML" | "KMZ";
}

export interface CoverageParseResult {
  areas: CoverageArea[];
  totalPolygons: number;
  ignoredPoints: number;
  ignoredLines: number;
  rejectedGeometries: number;
}

export interface CoverageMemoryState {
  loaded: boolean;
  loadedAt: Date | null;
  sourceFile: string | null;
  areas: CoverageArea[];
  totalPolygons: number;
  ignoredPoints: number;
  ignoredLines: number;
  rejectedGeometries: number;
}
