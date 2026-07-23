import { beforeAll, describe, expect, it } from "vitest";
import {
  findCoverageAreasForPoint,
  isPointInPolygon,
} from "../src/services/coverage-geo.service";
import { parseCoverageKml } from "../src/services/coverage-parser.service";
import { coverageSnapshotStore } from "../src/stores/coverage-snapshot.store";
import {
  POINT_IN_ISLAND_2,
  POINT_IN_OVERLAP,
  POINT_INSIDE_BARREIRO,
  POINT_INSIDE_HOLE,
  POINT_OUTSIDE,
  readFixtureKml,
} from "./helpers";

describe("point-in-polygon com o fixture de cobertura", () => {
  beforeAll(() => {
    const result = parseCoverageKml(readFixtureKml(), "KML");
    coverageSnapshotStore.replaceAll([
      {
        layerId: "legacy-file",
        layerName: "manchas.kml",
        partnerId: "legacy",
        partnerName: "Arquivo local (legado)",
        partnerCode: "LEGACY",
        version: null,
        areas: result.areas,
        polygonCount: result.totalPolygons,
      },
    ]);
  });

  it("detecta ponto dentro do poligono", () => {
    const areas = findCoverageAreasForPoint(
      POINT_INSIDE_BARREIRO.latitude,
      POINT_INSIDE_BARREIRO.longitude
    );
    expect(areas.map((a) => a.name)).toEqual(["BARREIRO"]);
  });

  it("detecta ponto fora de todos os poligonos", () => {
    expect(findCoverageAreasForPoint(POINT_OUTSIDE.latitude, POINT_OUTSIDE.longitude)).toHaveLength(0);
  });

  it("ponto dentro de um buraco e considerado fora daquela area", () => {
    const areas = findCoverageAreasForPoint(POINT_INSIDE_HOLE.latitude, POINT_INSIDE_HOLE.longitude);
    expect(areas.find((a) => a.name === "BARREIRO")).toBeUndefined();
  });

  it("retorna todas as areas sobrepostas, com a principal na ordem do KML", () => {
    const areas = findCoverageAreasForPoint(POINT_IN_OVERLAP.latitude, POINT_IN_OVERLAP.longitude);
    expect(areas.map((a) => a.name)).toEqual(["BARREIRO", "SOBREPOSICAO LESTE"]);
  });

  it("encontra ponto no segundo poligono de um MultiGeometry", () => {
    const areas = findCoverageAreasForPoint(POINT_IN_ISLAND_2.latitude, POINT_IN_ISLAND_2.longitude);
    expect(areas.map((a) => a.name)).toEqual(["DUAS ILHAS"]);
  });

  it("isPointInPolygon respeita o buraco diretamente", () => {
    const result = parseCoverageKml(readFixtureKml(), "KML");
    const polygon = result.areas[0].polygons[0];
    expect(isPointInPolygon(POINT_INSIDE_BARREIRO.latitude, POINT_INSIDE_BARREIRO.longitude, polygon)).toBe(true);
    expect(isPointInPolygon(POINT_INSIDE_HOLE.latitude, POINT_INSIDE_HOLE.longitude, polygon)).toBe(false);
  });
});
