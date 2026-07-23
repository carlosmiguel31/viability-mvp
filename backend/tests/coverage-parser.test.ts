import { describe, expect, it } from "vitest";
import { parseCoverageKml, parseCoordinateList } from "../src/services/coverage-parser.service";
import { readFixtureKml } from "./helpers";

describe("parseCoverageKml", () => {
  const result = parseCoverageKml(readFixtureKml(), "KML");

  it("extrai as areas com poligonos validos", () => {
    expect(result.areas.map((a) => a.name)).toEqual([
      "BARREIRO",
      "SOBREPOSICAO LESTE",
      "DUAS ILHAS",
    ]);
    expect(result.totalPolygons).toBe(4); // 1 + 1 + 2 (MultiGeometry)
  });

  it("le o anel externo convertendo lng,lat para lat,lng", () => {
    const barreiro = result.areas[0];
    const first = barreiro.polygons[0].outerRing[0];
    expect(first.latitude).toBeCloseTo(-19.99, 6);
    expect(first.longitude).toBeCloseTo(-44.02, 6);
  });

  it("le aneis internos (buracos)", () => {
    expect(result.areas[0].polygons[0].innerRings).toHaveLength(1);
    expect(result.areas[0].polygons[0].innerRings[0].length).toBeGreaterThanOrEqual(3);
  });

  it("extrai varios poligonos de um MultiGeometry no mesmo Placemark", () => {
    const ilhas = result.areas.find((a) => a.name === "DUAS ILHAS");
    expect(ilhas?.polygons).toHaveLength(2);
  });

  it("ignora LineString e Point sem trata-los como cobertura", () => {
    expect(result.ignoredLines).toBe(1);
    expect(result.ignoredPoints).toBe(1);
  });

  it("contabiliza geometrias rejeitadas (anel com menos de 3 vertices)", () => {
    expect(result.rejectedGeometries).toBe(1);
  });

  it("captura pasta aninhada e nome", () => {
    expect(result.areas[0].folderPath).toBe("AREA DE ATENDIMENTO");
    expect(result.areas[2].folderPath).toBe("EXPANSAO");
  });
});

describe("parseCoordinateList", () => {
  it("remove o vertice de fechamento repetido", () => {
    const ring = parseCoordinateList("-44.0,-19.9 -44.1,-19.9 -44.1,-19.8 -44.0,-19.9");
    expect(ring).toHaveLength(3);
  });

  it("rejeita aneis com coordenadas invalidas", () => {
    expect(parseCoordinateList("-44.0,-19.9 abc,def -44.1,-19.8")).toBeNull();
    expect(parseCoordinateList("-44.0,95.0 -44.1,-19.9 -44.2,-19.8")).toBeNull();
  });
});
