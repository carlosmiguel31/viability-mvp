import { describe, expect, it } from "vitest";
import {
  groupElementsByLocation,
  normalizeCoordinateKey,
} from "../src/services/network-grouping.service";
import { VoalleNetworkElement } from "../src/types/viability.types";

function element(
  id: string,
  title: string,
  latitude: number,
  longitude: number,
  address: Partial<Pick<VoalleNetworkElement, "street" | "addressNumber" | "neighborhood" | "city" | "postalCode">> = {}
): VoalleNetworkElement {
  return {
    id,
    title,
    street: address.street ?? null,
    addressNumber: address.addressNumber ?? null,
    neighborhood: address.neighborhood ?? null,
    city: address.city ?? null,
    postalCode: address.postalCode ?? null,
    latitude,
    longitude,
  };
}

const LAT = -20.001026142659995;
const LNG = -44.03332082234893;

describe("groupElementsByLocation", () => {
  it("agrupa registros com exatamente a mesma coordenada em um unico ponto fisico", () => {
    const elements = [
      element("2486", "ROTA 01(01) ROTA 02(DE 02 a 08)_1943", LAT, LNG),
      element("2485", "ROTA 01_1942", LAT, LNG),
      element("3000", "SPLITTER 1_48", -19.9878, -44.0128),
    ];
    const locations = groupElementsByLocation(elements, -20.0015, -44.0333);
    const grouped = locations.find((l) => l.elements.length === 2)!;
    expect(locations).toHaveLength(2);
    expect(grouped.elements.map((e) => e.id)).toEqual(["2485", "2486"]); // ordenados por id
  });

  it("ordena elementos do grupo por id bigint (9 antes de 10, sem perder precisao)", () => {
    const elements = [
      element("10", "SPLITTER 10", LAT, LNG),
      element("9", "SPLITTER 9", LAT, LNG),
      element("9007199254740993", "SPLITTER GIGANTE", LAT, LNG),
      element("9007199254740992", "SPLITTER GRANDE", LAT, LNG),
    ];
    const [location] = groupElementsByLocation(elements, LAT, LNG);
    expect(location.elements.map((e) => e.id)).toEqual([
      "9",
      "10",
      "9007199254740992",
      "9007199254740993",
    ]);
  });

  it("nao agrupa pontos apenas proximos (coordenadas diferentes apos normalizacao)", () => {
    const elements = [
      element("1", "SPLITTER A", -19.9878000, -44.0128000),
      element("2", "SPLITTER B", -19.9878004, -44.0128000), // difere na 7a casa
    ];
    const locations = groupElementsByLocation(elements, -19.9878, -44.0128);
    expect(locations).toHaveLength(2);
  });

  it("usa o primeiro endereco nao vazio do grupo (ordem de id)", () => {
    const elements = [
      element("20", "COLETOR 2", LAT, LNG, { street: "Rua Certa", city: "BH" }),
      element("10", "COLETOR 1", LAT, LNG), // sem endereco, id menor
      element("30", "COLETOR 3", LAT, LNG, { street: "Rua Errada" }),
    ];
    const [location] = groupElementsByLocation(elements, LAT, LNG);
    expect(location.address?.street).toBe("Rua Certa");
    expect(location.address?.city).toBe("BH");
  });

  it("address e null quando nenhum elemento tem endereco", () => {
    const [location] = groupElementsByLocation([element("1", "ROTA", LAT, LNG)], LAT, LNG);
    expect(location.address).toBeNull();
  });

  it("calcula a distancia uma unica vez por ponto fisico e ordena por distancia", () => {
    const elements = [
      element("1", "LONGE", -20.003, LNG),
      element("2", "PERTO A", LAT, LNG),
      element("3", "PERTO B", LAT, LNG),
    ];
    const locations = groupElementsByLocation(elements, LAT, LNG);
    expect(locations[0].elements.map((e) => e.id)).toEqual(["2", "3"]);
    expect(locations[0].distanceMeters).toBe(0);
    expect(locations[1].distanceMeters).toBeGreaterThan(0);
  });

  it("nao expoe nenhuma informacao de portas ou dados pessoais", () => {
    const [location] = groupElementsByLocation([element("1", "SPLITTER 1_48", LAT, LNG)], LAT, LNG);
    const json = JSON.stringify(location).toLowerCase();
    for (const forbidden of ["port", "cpf", "cnpj", "telefone", "phone", "cliente"]) {
      expect(json).not.toContain(forbidden);
    }
  });
});

describe("normalizeCoordinateKey", () => {
  it("normaliza com 7 casas decimais", () => {
    expect(normalizeCoordinateKey(-20.00102614, -44.03332082)).toBe("-20.0010261,-44.0333208");
  });
});
