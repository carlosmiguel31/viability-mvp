import { FormEvent, useRef, useState } from "react";
import { ApiError, lookupPostalCode } from "../api";
import { AddressFormValues } from "../types";

interface Props {
  values: AddressFormValues;
  onChange: (values: AddressFormValues) => void;
  /**
   * Patch funcional baseado no estado MAIS RECENTE: usado pelo retorno
   * assíncrono do CEP para não sobrescrever número, complemento ou correções
   * feitas pelo operador enquanto a requisição estava em andamento.
   */
  onPatch: (patch: (previous: AddressFormValues) => AddressFormValues) => void;
  onSearch: () => void;
  loading: boolean;
}

const inputClass =
  "w-full rounded border border-ink/20 px-3 py-2 text-sm focus:border-petrol-600 focus:outline-none focus:ring-1 focus:ring-petrol-600";

/**
 * O operador consulta por ENDEREÇO — latitude/longitude nunca são pedidas
 * aqui. Um CEP válido preenche rua/bairro/cidade/UF automaticamente (ViaCEP
 * via backend), sem nunca substituir o número, e o operador pode corrigir
 * qualquer campo. Falha na consulta de CEP não bloqueia a digitação manual.
 */
export default function AddressForm({ values, onChange, onPatch, onSearch, loading }: Props) {
  const [cepStatus, setCepStatus] = useState<"idle" | "loading" | "not_found" | "error">("idle");
  const lastLookedUp = useRef<string>("");

  function set<K extends keyof AddressFormValues>(key: K, value: AddressFormValues[K]) {
    onChange({ ...values, [key]: value });
  }

  async function maybeLookupCep(raw: string) {
    const digits = raw.replace(/\D/g, "");
    if (digits.length !== 8 || digits === lastLookedUp.current) return;
    lastLookedUp.current = digits;
    // Campos no momento do disparo: o retorno só preenche o que o operador
    // NÃO alterou durante a requisição.
    const snapshot = { ...values };
    setCepStatus("loading");
    try {
      const found = await lookupPostalCode(digits);
      onPatch((previous) => {
        const fill = (
          field: "street" | "neighborhood" | "city" | "state",
          value: string | null
        ): string => {
          if (value === null) return previous[field];
          // Correção do operador durante a requisição prevalece.
          if (previous[field] !== snapshot[field]) return previous[field];
          return value;
        };
        return {
          ...previous,
          // Número e complemento NUNCA são alterados pelo retorno do CEP.
          street: fill("street", found.street),
          neighborhood: fill("neighborhood", found.neighborhood),
          city: fill("city", found.city),
          state: fill("state", found.state),
        };
      });
      setCepStatus("idle");
    } catch (err) {
      // Falha libera nova tentativa para o MESMO CEP.
      lastLookedUp.current = "";
      if (err instanceof ApiError && err.status === 401) {
        // Sessão expirada: o cliente HTTP global já encerrou a sessão.
        return;
      }
      setCepStatus(err instanceof ApiError && err.status === 404 ? "not_found" : "error");
    }
  }

  function handleSubmit(event: FormEvent) {
    event.preventDefault();
    onSearch();
  }

  return (
    <form onSubmit={handleSubmit} className="rounded-lg border border-ink/10 bg-white p-4 shadow-sm">
      <div className="grid grid-cols-2 gap-3">
        <label className="col-span-1 block text-sm">
          <span className="mb-1 block font-medium">CEP</span>
          <input
            value={values.postalCode}
            onChange={(e) => {
              set("postalCode", e.target.value);
              void maybeLookupCep(e.target.value);
            }}
            onBlur={(e) => void maybeLookupCep(e.target.value)}
            inputMode="numeric"
            className={`${inputClass} font-mono`}
            placeholder="30640-000"
          />
        </label>
        <div className="col-span-1 flex items-end pb-1 text-[11px] leading-snug text-ink/50">
          {cepStatus === "loading" && "Buscando CEP..."}
          {cepStatus === "not_found" && "CEP não encontrado — preencha manualmente."}
          {cepStatus === "error" && "Consulta de CEP indisponível — preencha manualmente."}
        </div>

        <label className="col-span-2 block text-sm">
          <span className="mb-1 block font-medium">Rua / logradouro *</span>
          <input
            value={values.street}
            onChange={(e) => set("street", e.target.value)}
            required
            className={inputClass}
            placeholder="Rua Exemplo"
          />
        </label>

        <label className="col-span-1 block text-sm">
          <span className="mb-1 block font-medium">Número *</span>
          <input
            value={values.number}
            onChange={(e) => set("number", e.target.value)}
            required
            className={inputClass}
            placeholder="100"
          />
        </label>
        <label className="col-span-1 block text-sm">
          <span className="mb-1 block font-medium">Complemento</span>
          <input
            value={values.complement}
            onChange={(e) => set("complement", e.target.value)}
            className={inputClass}
            placeholder="Apto 101"
          />
        </label>

        <label className="col-span-2 block text-sm">
          <span className="mb-1 block font-medium">Bairro</span>
          <input
            value={values.neighborhood}
            onChange={(e) => set("neighborhood", e.target.value)}
            className={inputClass}
            placeholder="Barreiro"
          />
        </label>

        <label className="col-span-1 block text-sm">
          <span className="mb-1 block font-medium">Cidade *</span>
          <input
            value={values.city}
            onChange={(e) => set("city", e.target.value)}
            required
            className={inputClass}
            placeholder="Belo Horizonte"
          />
        </label>
        <label className="col-span-1 block text-sm">
          <span className="mb-1 block font-medium">UF *</span>
          <input
            value={values.state}
            onChange={(e) => set("state", e.target.value.toUpperCase())}
            required
            maxLength={2}
            className={`${inputClass} uppercase`}
            placeholder="MG"
          />
        </label>
      </div>

      <button
        type="submit"
        disabled={loading}
        className="mt-4 w-full rounded bg-petrol-700 px-4 py-2.5 text-sm font-semibold text-white transition hover:bg-petrol-600 focus:outline-none focus:ring-2 focus:ring-petrol-600 focus:ring-offset-2 disabled:opacity-60"
      >
        {loading ? "Consultando..." : "Buscar endereço"}
      </button>
    </form>
  );
}
