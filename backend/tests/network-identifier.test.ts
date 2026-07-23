import { describe, expect, it } from "vitest";
import { classifyNetworkElementTitle } from "../src/utils/network-identifier";
import { toPublicNetworkLocation } from "../src/services/public-network.mapper";
import { NetworkLocation, VoalleNetworkElement } from "../src/types/viability.types";

function element(id: string, title: string): VoalleNetworkElement {
  return {
    id,
    title,
    street: "Rua Interna",
    addressNumber: "1",
    neighborhood: null,
    city: null,
    postalCode: null,
    latitude: -19.9878,
    longitude: -44.0128,
  };
}

function location(elements: VoalleNetworkElement[]): NetworkLocation {
  return {
    internalId: "loc-1",
    latitude: -19.9878,
    longitude: -44.0128,
    distanceMeters: 74.5,
    address: null,
    elements,
  };
}

describe("classifyNetworkElementTitle", () => {
  it("classifica SPLITTER", () => {
    expect(classifyNetworkElementTitle("SPLITTER 1_48")).toBe("SPLITTER");
    expect(classifyNetworkElementTitle("splitter 2_49")).toBe("SPLITTER");
  });

  it("classifica ROTA", () => {
    expect(classifyNetworkElementTitle("ROTA 01_1942")).toBe("ROUTE");
    expect(classifyNetworkElementTitle("ROTA 01(01) ROTA 02(DE 02 à 08)_1943")).toBe("ROUTE");
  });

  it("classifica COLETOR", () => {
    expect(classifyNetworkElementTitle("COLETOR 03")).toBe("COLLECTOR");
  });

  it("classifica identificadores padronizados como NETWORK_IDENTIFIER", () => {
    expect(classifyNetworkElementTitle("BHZ-C0016-RT10-CT03_2780")).toBe("NETWORK_IDENTIFIER");
    expect(classifyNetworkElementTitle("BHZ-C0016-RT11-CT04_2787")).toBe("NETWORK_IDENTIFIER");
    // Não presume prefixo BHZ:
    expect(classifyNetworkElementTitle("SPX9-C0001-RT01-CT01_10")).toBe("NETWORK_IDENTIFIER");
    // Ignora diferenças de caixa:
    expect(classifyNetworkElementTitle("bhz-c0016-rt10-ct03_2780")).toBe("NETWORK_IDENTIFIER");
  });

  it("títulos fora dos padrões viram OTHER", () => {
    expect(classifyNetworkElementTitle("CAIXA GENERICA 12")).toBe("OTHER");
  });
});

describe("toPublicNetworkLocation", () => {
  it("expõe apenas identificadores padronizados, preservando o valor original", () => {
    const pub = toPublicNetworkLocation(
      location([
        element("1", "SPLITTER 1_48"),
        element("2780", "BHZ-C0016-RT10-CT03_2780"),
        element("9", "ROTA 01_1942"),
        element("5", "COLETOR 02"),
      ])
    );
    expect(pub.identificationStatus).toBe("IDENTIFIED");
    expect(pub.identifiers).toEqual([{ id: "2780", code: "BHZ-C0016-RT10-CT03_2780" }]);
    const json = JSON.stringify(pub);
    expect(json).not.toContain("SPLITTER");
    expect(json).not.toContain("ROTA");
    expect(json).not.toContain("COLETOR");
    expect(json).not.toContain("Rua Interna"); // endereço interno dos elementos fora
  });

  it("mantém múltiplos identificadores, remove duplicados e ordena alfabeticamente", () => {
    const pub = toPublicNetworkLocation(
      location([
        element("2787", "BHZ-C0016-RT11-CT04_2787"),
        element("2780", "BHZ-C0016-RT10-CT03_2780"),
        element("9999", "bhz-c0016-rt10-ct03_2780"), // duplicado (caixa diferente)
      ])
    );
    expect(pub.identifiers.map((i) => i.code)).toEqual([
      "BHZ-C0016-RT10-CT03_2780",
      "BHZ-C0016-RT11-CT04_2787",
    ]);
  });

  it("sem identificador útil: lista vazia e NOT_IDENTIFIED, sem substitutos técnicos", () => {
    const pub = toPublicNetworkLocation(
      location([element("1", "SPLITTER 1_48"), element("2", "ROTA 01_1942")])
    );
    expect(pub.identifiers).toEqual([]);
    expect(pub.identificationStatus).toBe("NOT_IDENTIFIED");
  });
});
