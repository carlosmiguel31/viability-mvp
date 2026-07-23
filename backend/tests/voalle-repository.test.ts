import { describe, expect, it, vi } from "vitest";
import {
  assertReadOnlySql,
  buildBoundingBoxParams,
  calculateBoundingBox,
  filterAndSortByDistance,
  FIND_ELEMENTS_IN_BOUNDING_BOX_SQL,
  parseVoalleElementRow,
  PgVoalleRepository,
  VoalleElementRow,
} from "../src/repositories/voalle.repository";

function row(overrides: Partial<VoalleElementRow> = {}): VoalleElementRow {
  return {
    id: "2485", // bigint chega como string no driver pg
    active: true,
    deleted: false,
    title: "ROTA 01_1942",
    street: "Rua Exemplo",
    number: "100",
    neighborhood: "Barreiro",
    city: "Belo Horizonte",
    postal_code: "00000-000",
    lat: "-20.001026142659995",
    lng: "-44.03332082234893",
    ...overrides,
  };
}

describe("consulta SQL de erp.authentication_splitters", () => {
  it("sempre exclui registros inativos ou apagados", () => {
    expect(FIND_ELEMENTS_IN_BOUNDING_BOX_SQL).toContain("active IS TRUE");
    expect(FIND_ELEMENTS_IN_BOUNDING_BOX_SQL).toContain("COALESCE(deleted, FALSE) = FALSE");
  });

  it("permanece parametrizada (bounding box em $1..$4) e somente leitura", () => {
    expect(FIND_ELEMENTS_IN_BOUNDING_BOX_SQL.trim()).toMatch(/^SELECT/i);
    for (const param of ["$1", "$2", "$3", "$4"]) {
      expect(FIND_ELEMENTS_IN_BOUNDING_BOX_SQL).toContain(param);
    }
    expect(() => assertReadOnlySql(FIND_ELEMENTS_IN_BOUNDING_BOX_SQL)).not.toThrow();
  });
});

describe("assertReadOnlySql — garantia de somente leitura", () => {
  it("aceita a consulta real da caixa geografica", () => {
    expect(() => assertReadOnlySql(FIND_ELEMENTS_IN_BOUNDING_BOX_SQL)).not.toThrow();
  });

  it.each([
    "INSERT INTO tabela VALUES (1)",
    "UPDATE tabela SET a = 1",
    "DELETE FROM tabela",
    "DROP TABLE tabela",
    "TRUNCATE tabela",
    "CREATE TABLE x (id int)",
    "ALTER TABLE x ADD y int",
    "SELECT 1; DELETE FROM tabela",
    "WITH x AS (DELETE FROM t RETURNING *) SELECT * FROM x",
  ])("rejeita comando de escrita: %s", (sql) => {
    expect(() => assertReadOnlySql(sql)).toThrow(/READ_ONLY_VIOLATION/);
  });

  it("nenhum comando de escrita existe no SQL do repositorio", () => {
    expect(FIND_ELEMENTS_IN_BOUNDING_BOX_SQL).not.toMatch(
      /\b(insert|update|delete|drop|alter|truncate)\b/i
    );
  });
});

describe("SQL da caixa geografica (lat/lng character varying)", () => {
  it("protege o cast com regex antes do ::double precision", () => {
    expect(FIND_ELEMENTS_IN_BOUNDING_BOX_SQL).toContain("btrim(lat) ~ '^[+-]?[0-9]+([.][0-9]+)?$'");
    expect(FIND_ELEMENTS_IN_BOUNDING_BOX_SQL).toContain("btrim(lng) ~ '^[+-]?[0-9]+([.][0-9]+)?$'");
    expect(FIND_ELEMENTS_IN_BOUNDING_BOX_SQL).toContain("btrim(lat)::double precision BETWEEN $1 AND $2");
    expect(FIND_ELEMENTS_IN_BOUNDING_BOX_SQL).toContain("btrim(lng)::double precision BETWEEN $3 AND $4");
  });
});

describe("parseVoalleElementRow", () => {
  it("converte lat/lng varchar e mantem o id bigint como string", () => {
    const element = parseVoalleElementRow(row());
    expect(element?.id).toBe("2485");
    expect(element?.title).toBe("ROTA 01_1942");
    expect(element?.latitude).toBeCloseTo(-20.001026142659995, 10);
    expect(element?.longitude).toBeCloseTo(-44.03332082234893, 10);
    expect(element?.addressNumber).toBe("100");
    expect(element?.postalCode).toBe("00000-000");
  });

  it("rejeita coordenadas nulas, vazias e nao numericas", () => {
    expect(parseVoalleElementRow(row({ lat: null }))).toBeNull();
    expect(parseVoalleElementRow(row({ lng: "" }))).toBeNull();
    expect(parseVoalleElementRow(row({ lat: "abc" }))).toBeNull();
    expect(parseVoalleElementRow(row({ lng: "12,34" }))).toBeNull();
  });

  it("rejeita coordenadas fora dos limites e o par 0,0", () => {
    expect(parseVoalleElementRow(row({ lat: "95" }))).toBeNull();
    expect(parseVoalleElementRow(row({ lng: "-181" }))).toBeNull();
    expect(parseVoalleElementRow(row({ lat: "0", lng: "0" }))).toBeNull();
  });

  it("preserva IDs bigint acima de Number.MAX_SAFE_INTEGER sem perder precisao", () => {
    const element = parseVoalleElementRow(row({ id: "9007199254740993" }));
    expect(element?.id).toBe("9007199254740993");
  });

  it("rejeita registro sem id", () => {
    expect(parseVoalleElementRow(row({ id: null as never }))).toBeNull();
  });
});

describe("PgVoalleRepository.findNetworkElementsNearCoordinates", () => {
  it("usa consulta parametrizada com os parametros na ordem correta", async () => {
    const runner = vi.fn().mockResolvedValue([row()]);
    const repo = new PgVoalleRepository(runner);

    await repo.findNetworkElementsNearCoordinates(-20.001, -44.0333, 300);

    expect(runner).toHaveBeenCalledTimes(1);
    const [sql, params] = runner.mock.calls[0];
    expect(sql).toBe(FIND_ELEMENTS_IN_BOUNDING_BOX_SQL);
    expect(sql).not.toContain("-20.001"); // nada interpolado
    const box = calculateBoundingBox(-20.001, -44.0333, 300);
    expect(params).toEqual(buildBoundingBoxParams(box));
    expect(params[0]).toBeLessThan(params[1]);
    expect(params[2]).toBeLessThan(params[3]);
  });

  it("aplica o filtro final por Haversine (dentro da caixa, fora do circulo)", async () => {
    const inside = row();
    const cornerOfBox = row({ id: "9999", lat: "-20.003", lng: "-44.036" }); // ~350 m
    const runner = vi.fn().mockResolvedValue([cornerOfBox, inside]);
    const repo = new PgVoalleRepository(runner);

    const result = await repo.findNetworkElementsNearCoordinates(-20.001026, -44.033321, 200);
    expect(result.map((e) => e.id)).toEqual(["2485"]);
  });

  it("ignora linhas invalidas sem derrubar a consulta", async () => {
    const runner = vi.fn().mockResolvedValue([row({ lat: "invalido" }), row({ id: "10" })]);
    const repo = new PgVoalleRepository(runner);
    const result = await repo.findNetworkElementsNearCoordinates(-20.001026, -44.033321, 200);
    expect(result.map((e) => e.id)).toEqual(["10"]);
  });
});

describe("calculateBoundingBox", () => {
  it("protege contra divisao por ~0 perto dos polos e limita a ±90/±180", () => {
    const box = calculateBoundingBox(89.9999, 0, 1000);
    expect(Number.isFinite(box.minimumLongitude)).toBe(true);
    expect(box.maximumLatitude).toBeLessThanOrEqual(90);
    expect(box.maximumLongitude).toBeLessThanOrEqual(180);
    expect(box.minimumLongitude).toBeGreaterThanOrEqual(-180);
  });
});

describe("filterAndSortByDistance", () => {
  it("ordena pela distancia real", () => {
    const near = parseVoalleElementRow(row({ id: "2", lat: "-20.00105", lng: "-44.03335" }))!;
    const far = parseVoalleElementRow(row({ id: "1", lat: "-20.0020", lng: "-44.0333" }))!;
    const result = filterAndSortByDistance([far, near], -20.001026, -44.033321, 500);
    expect(result.map((e) => e.id)).toEqual(["2", "1"]);
  });
});
