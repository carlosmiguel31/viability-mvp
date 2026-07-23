import { describe, expect, it } from "vitest";
import {
  viabilityCheckAddressSchema,
  viabilityCheckCoordinatesSchema,
} from "../src/schemas/viability.schema";

describe("viabilityCheckCoordinatesSchema", () => {
  it("aceita coordenadas válidas", () => {
    const parsed = viabilityCheckCoordinatesSchema.parse({ latitude: -19.9878, longitude: -44.0128 });
    expect(parsed.latitude).toBe(-19.9878);
  });

  it("rejeita latitude fora de -90..90", () => {
    expect(() => viabilityCheckCoordinatesSchema.parse({ latitude: -91, longitude: 0 })).toThrow();
    expect(() => viabilityCheckCoordinatesSchema.parse({ latitude: 90.1, longitude: 0 })).toThrow();
  });

  it("rejeita longitude fora de -180..180", () => {
    expect(() => viabilityCheckCoordinatesSchema.parse({ latitude: 0, longitude: 181 })).toThrow();
  });

  it("rejeita valores não numéricos", () => {
    expect(() => viabilityCheckCoordinatesSchema.parse({ latitude: "a", longitude: 0 })).toThrow();
  });
});

describe("viabilityCheckAddressSchema", () => {
  const valid = {
    address: {
      postalCode: "30640-000",
      street: "Rua Exemplo",
      number: "100",
      city: "Belo Horizonte",
      state: "MG",
    },
  };

  it("aceita endereço válido, com adjustedLocation opcional", () => {
    expect(viabilityCheckAddressSchema.parse(valid).address.street).toBe("Rua Exemplo");
    const withAdjust = viabilityCheckAddressSchema.parse({
      ...valid,
      adjustedLocation: { latitude: -19.9, longitude: -44.0 },
    });
    expect(withAdjust.adjustedLocation?.latitude).toBe(-19.9);
  });

  it("exige rua, número, cidade e UF", () => {
    expect(() =>
      viabilityCheckAddressSchema.parse({ address: { number: "1", city: "BH", state: "MG" } })
    ).toThrow();
    expect(() =>
      viabilityCheckAddressSchema.parse({ address: { street: "Rua", city: "BH", state: "MG" } })
    ).toThrow();
  });

  it("rejeita adjustedLocation com coordenadas inválidas", () => {
    expect(() =>
      viabilityCheckAddressSchema.parse({
        ...valid,
        adjustedLocation: { latitude: 120, longitude: 0 },
      })
    ).toThrow();
  });
});
