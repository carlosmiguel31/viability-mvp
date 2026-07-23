import { describe, expect, it } from "vitest";
import {
  isPointInPolygon,
  isPointOnSegment,
  EDGE_TOLERANCE_DEGREES,
} from "../src/services/coverage-geo.service";
import { CoveragePolygon, GeographicCoordinate } from "../src/types/coverage.types";

// Quadrado: lat -19.99..-19.98, lng -44.02..-44.01, com buraco central.
const square = (reversed = false): CoveragePolygon => {
  const outer: GeographicCoordinate[] = [
    { latitude: -19.99, longitude: -44.02 },
    { latitude: -19.99, longitude: -44.01 },
    { latitude: -19.98, longitude: -44.01 },
    { latitude: -19.98, longitude: -44.02 },
  ];
  const hole: GeographicCoordinate[] = [
    { latitude: -19.986, longitude: -44.016 },
    { latitude: -19.986, longitude: -44.014 },
    { latitude: -19.984, longitude: -44.014 },
    { latitude: -19.984, longitude: -44.016 },
  ];
  return reversed
    ? { outerRing: [...outer].reverse(), innerRings: [[...hole].reverse()] }
    : { outerRing: outer, innerRings: [hole] };
};

describe("pontos na borda do poligono (borda externa = dentro)", () => {
  const cases: Array<[string, number, number]> = [
    ["borda superior", -19.98, -44.015],
    ["borda inferior", -19.99, -44.015],
    ["borda esquerda", -19.985, -44.02],
    ["borda direita", -19.985, -44.01],
    ["vertice", -19.99, -44.02],
  ];

  it.each(cases)("%s e considerado dentro da cobertura", (_label, lat, lng) => {
    expect(isPointInPolygon(lat, lng, square())).toBe(true);
  });

  it.each(cases)("%s: resultado independe do sentido dos vertices", (_label, lat, lng) => {
    expect(isPointInPolygon(lat, lng, square(true))).toBe(true);
  });
});

describe("borda de buraco = fora daquela cobertura", () => {
  const holeEdge: Array<[string, number, number]> = [
    ["borda superior do buraco", -19.984, -44.015],
    ["borda inferior do buraco", -19.986, -44.015],
    ["vertice do buraco", -19.986, -44.016],
  ];

  it.each(holeEdge)("%s e considerado fora", (_label, lat, lng) => {
    expect(isPointInPolygon(lat, lng, square())).toBe(false);
    expect(isPointInPolygon(lat, lng, square(true))).toBe(false);
  });

  it("interior do buraco continua fora e interior normal continua dentro", () => {
    expect(isPointInPolygon(-19.985, -44.015, square())).toBe(false);
    expect(isPointInPolygon(-19.9885, -44.018, square())).toBe(true);
  });
});

describe("isPointOnSegment", () => {
  const a = { latitude: 0, longitude: 0 };
  const b = { latitude: 0, longitude: 1 };

  it("detecta ponto sobre o segmento dentro da tolerancia", () => {
    expect(isPointOnSegment({ latitude: 0, longitude: 0.5 }, a, b)).toBe(true);
    expect(isPointOnSegment({ latitude: EDGE_TOLERANCE_DEGREES / 2, longitude: 0.5 }, a, b)).toBe(true);
  });

  it("rejeita ponto alem da tolerancia ou fora dos extremos", () => {
    expect(isPointOnSegment({ latitude: 0.001, longitude: 0.5 }, a, b)).toBe(false);
    expect(isPointOnSegment({ latitude: 0, longitude: 1.001 }, a, b)).toBe(false);
  });

  it("funciona com segmento degenerado (A == B)", () => {
    expect(isPointOnSegment({ latitude: 0, longitude: 0 }, a, a)).toBe(true);
    expect(isPointOnSegment({ latitude: 0.5, longitude: 0.5 }, a, a)).toBe(false);
  });
});
