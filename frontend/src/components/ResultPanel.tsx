import { useState } from "react";
import { AddressViabilityResponse, PublicNetworkLocation } from "../types";

interface Props {
  result: AddressViabilityResponse;
}

/**
 * Card vermelho (signal-blocked) SOMENTE para OUTSIDE_COVERAGE.
 * Dentro da mancha o card é sempre verde: a referência de rede nunca
 * rebaixa o resultado principal.
 */
const STATUS_META: Record<string, { label: string; badge: string; panel: string }> = {
  PRELIMINARILY_VIABLE: {
    label: "Viável preliminarmente",
    badge: "bg-signal-viable text-white",
    panel: "border-signal-viable/40",
  },
  OUTSIDE_COVERAGE: {
    label: "Fora da cobertura",
    badge: "bg-signal-blocked text-white",
    panel: "border-signal-blocked/40",
  },
  COVERAGE_NOT_LOADED: {
    label: "Cobertura indisponível",
    badge: "bg-signal-offline text-white",
    panel: "border-signal-offline/40",
  },
  ADDRESS_NOT_FOUND: {
    label: "Endereço não localizado",
    badge: "bg-signal-analysis text-white",
    panel: "border-signal-analysis/40",
  },
  ADDRESS_AMBIGUOUS: {
    label: "Confirme a localização",
    badge: "bg-signal-analysis text-white",
    panel: "border-signal-analysis/40",
  },
  GEOCODING_UNAVAILABLE: {
    label: "Localização indisponível",
    badge: "bg-signal-offline text-white",
    panel: "border-signal-offline/40",
  },
};

const CONFIDENCE_LABEL: Record<string, string> = {
  HIGH: "Localização precisa",
  MEDIUM: "Localização aproximada",
  LOW: "Localização com baixa precisão",
};

function NetworkLocationDetails({ location }: { location: PublicNetworkLocation }) {
  return (
    <div>
      <p className="text-sm">
        <span className="text-xs uppercase tracking-wide text-ink/50">Distância até a rede: </span>
        <span className="font-mono">{location.distanceMeters} m</span>
      </p>

      {location.identificationStatus === "IDENTIFIED" ? (
        <div className="mt-3">
          <p className="mb-1 text-xs uppercase tracking-wide text-ink/50">
            Identificações neste ponto
          </p>
          <ul className="space-y-1 rounded border border-ink/10 bg-ink/[0.02] p-2">
            {location.identifiers.map((identifier) => (
              <li key={identifier.id} className="font-mono text-xs text-ink/80">
                {identifier.code}
              </li>
            ))}
          </ul>
        </div>
      ) : (
        <p className="mt-3 rounded bg-ink/5 px-3 py-2 text-xs text-ink/70">
          Ponto de rede localizado, porém sem identificação padronizada no cadastro.
        </p>
      )}
    </div>
  );
}

export default function ResultPanel({ result }: Props) {
  const [showTechnicalDetails, setShowTechnicalDetails] = useState(false);
  const meta = STATUS_META[result.status] ?? STATUS_META.COVERAGE_NOT_LOADED;
  const location = result.nearestNetworkLocation;
  const { coverage, searchedAddress } = result;

  return (
    <section className={`rounded-lg border bg-white p-4 shadow-sm ${meta.panel}`}>
      <div className="flex flex-wrap items-center gap-2">
        <span
          className={`rounded px-2.5 py-1 text-xs font-semibold uppercase tracking-wide ${meta.badge}`}
        >
          {meta.label}
        </span>
        {coverage.primaryArea && (
          <span className="rounded bg-ink/5 px-2 py-1 font-mono text-[11px] text-ink/60">
            Área de cobertura: {coverage.primaryArea.name ?? "sem nome"}
          </span>
        )}
      </div>

      <p className="mt-3 text-sm">{result.message}</p>

      <p className="mt-2 text-xs text-ink/60">
        <span className="font-semibold">Endereço consultado:</span>{" "}
        {searchedAddress.formattedAddress}
      </p>
      {searchedAddress.manuallyAdjusted ? (
        <p className="mt-1 text-[11px] text-ink/50">Ponto ajustado manualmente no mapa.</p>
      ) : (
        searchedAddress.geocodingConfidence && (
          <p className="mt-1 text-[11px] text-ink/50">
            {CONFIDENCE_LABEL[searchedAddress.geocodingConfidence]}
          </p>
        )
      )}

      {coverage.matchingAreas.length > 0 && (
        <p className="mt-2 text-xs text-ink/60">
          O ponto também está em:{" "}
          {coverage.matchingAreas.map((a) => a.name ?? "sem nome").join(", ")}
        </p>
      )}

      {location && (
        <div className="mt-4 border-t border-ink/10 pt-4">
          <h3 className="mb-2 text-sm font-semibold">Referência de rede mais próxima</h3>
          <NetworkLocationDetails location={location} />
        </div>
      )}

      {result.status === "PRELIMINARILY_VIABLE" &&
        result.networkReferenceStatus !== "FOUND" &&
        result.networkReferenceMessage && (
          <p className="mt-4 rounded border border-signal-analysis/30 bg-amber-50 px-3 py-2 text-xs text-amber-900">
            {result.networkReferenceMessage}
          </p>
        )}

      {result.alternatives.length > 0 && (
        <p className="mt-3 text-xs text-ink/60">
          {result.alternatives.length} outro(s) ponto(s) no raio de referência — veja no mapa.
        </p>
      )}

      {result.requiresTechnicalConfirmation && (
        <p className="mt-3 rounded bg-amber-50 px-3 py-2 text-xs text-amber-900">
          Resultado preliminar: a viabilidade final depende de validação técnica em campo.
        </p>
      )}

      {location && (
        <div className="mt-3">
          <button
            type="button"
            onClick={() => setShowTechnicalDetails((v) => !v)}
            className="text-[11px] text-ink/50 underline decoration-dotted"
          >
            {showTechnicalDetails ? "Ocultar detalhes técnicos" : "Detalhes técnicos"}
          </button>
          {showTechnicalDetails && (
            <dl className="mt-2 grid grid-cols-2 gap-x-4 gap-y-1 rounded bg-ink/[0.03] p-2 font-mono text-[11px] text-ink/60">
              <dt>Endereço (lat, lng)</dt>
              <dd>
                {searchedAddress.latitude?.toFixed(6)}, {searchedAddress.longitude?.toFixed(6)}
              </dd>
              <dt>Ponto de rede (lat, lng)</dt>
              <dd>
                {location.latitude.toFixed(6)}, {location.longitude.toFixed(6)}
              </dd>
            </dl>
          )}
        </div>
      )}

      <p className="mt-4 text-[11px] leading-snug text-ink/45">{result.analysisBasis}</p>
    </section>
  );
}
