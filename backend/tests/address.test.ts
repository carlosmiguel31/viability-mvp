import { describe, expect, it, vi } from "vitest";
import {
  formatAddressFromInput,
  normalizeAddressInput,
  normalizePostalCode,
} from "../src/services/address.service";
import { ViaCepProvider } from "../src/services/postal-code/postal-code.provider";
import { AppError } from "../src/utils/errors";

describe("normalizePostalCode (validação de CEP)", () => {
  it("remove caracteres não numéricos e valida 8 dígitos", () => {
    expect(normalizePostalCode("30640-000")).toBe("30640000");
    expect(normalizePostalCode(" 30.640-000 ")).toBe("30640000");
  });

  it("CEP ausente é permitido (opcional)", () => {
    expect(normalizePostalCode(undefined)).toBeNull();
    expect(normalizePostalCode("")).toBeNull();
  });

  it("rejeita CEP com quantidade errada de dígitos", () => {
    expect(() => normalizePostalCode("3064-000")).toThrow(AppError);
    expect(() => normalizePostalCode("306400001")).toThrow(/8 dígitos/);
  });
});

describe("normalizeAddressInput", () => {
  const base = {
    postalCode: "30640-000",
    street: "  Rua   Exemplo ",
    number: " 100 ",
    complement: "  ",
    neighborhood: " Barreiro ",
    city: " Belo  Horizonte ",
    state: " mg ",
  };

  it("aplica trim, colapsa espaços duplicados e normaliza a UF", () => {
    const normalized = normalizeAddressInput(base);
    expect(normalized.street).toBe("Rua Exemplo");
    expect(normalized.number).toBe("100");
    expect(normalized.city).toBe("Belo Horizonte");
    expect(normalized.state).toBe("MG");
    expect(normalized.complement).toBeNull();
    expect(normalized.neighborhood).toBe("Barreiro");
    expect(normalized.country).toBe("Brasil"); // país padrão
    expect(normalized.postalCode).toBe("30640000");
  });

  it("preserva acentos", () => {
    const normalized = normalizeAddressInput({ ...base, street: "Avenida São João" });
    expect(normalized.street).toBe("Avenida São João");
  });

  it("exige rua, número, cidade e UF", () => {
    expect(() => normalizeAddressInput({ ...base, street: " " })).toThrow(/rua/);
    expect(() => normalizeAddressInput({ ...base, number: "" })).toThrow(/número/);
    expect(() => normalizeAddressInput({ ...base, city: "" })).toThrow(/cidade/);
    expect(() => normalizeAddressInput({ ...base, state: "" })).toThrow(/UF/);
  });

  it("rejeita UF que não seja sigla de 2 letras", () => {
    expect(() => normalizeAddressInput({ ...base, state: "Minas" })).toThrow(/UF inválida/);
  });

  it("formata o endereço para exibição", () => {
    expect(formatAddressFromInput(normalizeAddressInput(base))).toBe(
      "Rua Exemplo, 100, Barreiro, Belo Horizonte - MG"
    );
  });
});

describe("ViaCepProvider", () => {
  it("consulta bem-sucedida preenche rua, bairro, cidade e UF", async () => {
    const fetchFn = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        cep: "30640-000",
        logradouro: "Rua Exemplo",
        bairro: "Barreiro",
        localidade: "Belo Horizonte",
        uf: "mg",
      }),
    });
    const provider = new ViaCepProvider(fetchFn as unknown as typeof fetch);
    const address = await provider.findAddressByPostalCode("30640-000");
    expect(fetchFn.mock.calls[0][0]).toContain("viacep.com.br/ws/30640000/json");
    expect(address).toEqual({
      postalCode: "30640000",
      street: "Rua Exemplo",
      neighborhood: "Barreiro",
      city: "Belo Horizonte",
      state: "MG",
    });
  });

  it("CEP não encontrado retorna null", async () => {
    const fetchFn = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ erro: true }) });
    const provider = new ViaCepProvider(fetchFn as unknown as typeof fetch);
    expect(await provider.findAddressByPostalCode("99999999")).toBeNull();
  });

  it("falha no serviço não lança erro (preenchimento manual continua possível)", async () => {
    const fetchFn = vi.fn().mockRejectedValue(new Error("network down"));
    const provider = new ViaCepProvider(fetchFn as unknown as typeof fetch);
    await expect(provider.findAddressByPostalCode("30640000")).resolves.toBeNull();
  });

  it("CEP com formato inválido retorna null sem chamar o serviço", async () => {
    const fetchFn = vi.fn();
    const provider = new ViaCepProvider(fetchFn as unknown as typeof fetch);
    expect(await provider.findAddressByPostalCode("123")).toBeNull();
    expect(fetchFn).not.toHaveBeenCalled();
  });
});
