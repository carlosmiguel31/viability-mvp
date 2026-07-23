import { describe, expect, it } from "vitest";
import { calculateDistanceInMeters } from "../src/utils/haversine";

describe("calculateDistanceInMeters (Haversine)", () => {
  it("retorna 0 para o mesmo ponto", () => {
    expect(calculateDistanceInMeters(-19.9, -44.0, -19.9, -44.0)).toBe(0);
  });

  it("calcula ~111 km para 1 grau de latitude", () => {
    const d = calculateDistanceInMeters(0, 0, 1, 0);
    expect(d).toBeGreaterThan(110_000);
    expect(d).toBeLessThan(112_000);
  });

  it("calcula distancia curta conhecida com precisao razoavel", () => {
    // ~52,7 m entre estes dois pontos em BH (valor de referencia pre-calculado)
    const d = calculateDistanceInMeters(-19.9450, -44.0120, -19.94545, -44.01210);
    expect(d).toBeGreaterThan(45);
    expect(d).toBeLessThan(60);
  });

  it("e simetrica", () => {
    const ab = calculateDistanceInMeters(-19.9, -44.0, -19.95, -44.05);
    const ba = calculateDistanceInMeters(-19.95, -44.05, -19.9, -44.0);
    expect(ab).toBeCloseTo(ba, 6);
  });
});
