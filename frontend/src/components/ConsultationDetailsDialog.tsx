import { useState } from "react";
import { copyTextToClipboard } from "./ResultPanel";
import { ConsultationDetail } from "../types";

export const STATUS_LABELS: Record<string, string> = {
  PRELIMINARILY_VIABLE: "Viável preliminarmente",
  OUTSIDE_COVERAGE: "Fora da cobertura",
  COVERAGE_NOT_CONFIGURED: "Cobertura não configurada",
  COVERAGE_NOT_LOADED: "Cobertura indisponível",
  ADDRESS_NOT_FOUND: "Endereço não localizado",
  ADDRESS_AMBIGUOUS: "Confirmação pendente",
  GEOCODING_UNAVAILABLE: "Localização indisponível",
};

export const NETWORK_LABELS: Record<string, string> = {
  FOUND: "Encontrada",
  NOT_FOUND: "Não encontrada",
  VOALLE_UNAVAILABLE: "Voalle indisponível",
  NOT_CHECKED: "Não consultada",
};

export const CONFIDENCE_LABELS: Record<string, string> = {
  HIGH: "Alta",
  MEDIUM: "Média",
  LOW: "Baixa",
};

export const LOCATION_TYPE_LABELS: Record<string, string> = {
  ROOFTOP: "Localização exata",
  RANGE_INTERPOLATED: "Localização aproximada entre números",
  GEOMETRIC_CENTER: "Centro do logradouro ou da área",
  APPROXIMATE: "Localização aproximada",
  UNKNOWN: "Precisão não informada",
};

export function formatDateTime(value: string): string {
  return new Date(value).toLocaleString("pt-BR", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

interface Props {
  detail: ConsultationDetail;
  onClose: () => void;
}

/**
 * Modal de detalhes de uma consulta do histórico — COMPARTILHADO entre a
 * página de Histórico e o Dashboard (consultas recentes), sempre alimentado
 * pelo endpoint de detalhes existente. Nunca exibe IDs internos como
 * informação principal, credenciais, caminhos ou dados brutos.
 */
export default function ConsultationDetailsDialog({ detail, onClose }: Props) {
  const [protocolCopied, setProtocolCopied] = useState(false);
  return (
    <>

        <div
          role="dialog"
          aria-modal="true"
          aria-label={`Detalhes da consulta ${detail.protocol}`}
          className="fixed inset-0 z-50 flex items-center justify-center bg-ink/40 px-4 py-6"
          onKeyDown={(event) => {
            if (event.key === "Escape") onClose();
          }}
        >
          <div className="max-h-full w-full max-w-2xl overflow-y-auto rounded-lg border border-ink/10 bg-white p-5 shadow-lg">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <h3 className="text-sm font-semibold text-ink">
                Consulta <span className="font-mono">{detail.protocol}</span>
              </h3>
              <div className="flex gap-2">
                <button
                  type="button"
                  onClick={() => {
                    void copyTextToClipboard(detail.protocol).then((copied) => {
                      setProtocolCopied(copied);
                      if (copied) window.setTimeout(() => setProtocolCopied(false), 2500);
                    });
                  }}
                  className="rounded border border-ink/20 px-2 py-1 text-[11px] text-ink/70 transition hover:bg-ink/5"
                >
                  {protocolCopied ? "Copiado!" : "Copiar protocolo"}
                </button>
                <button
                  type="button"
                  onClick={onClose}
                  className="rounded border border-ink/20 px-2 py-1 text-[11px] text-ink/70 transition hover:bg-ink/5"
                >
                  Fechar
                </button>
              </div>
            </div>

            <dl className="mt-3 grid grid-cols-1 gap-x-6 gap-y-1 text-xs sm:grid-cols-2">
              <dt className="font-semibold text-ink/60">Data e horário</dt>
              <dd>{formatDateTime(detail.createdAt)}</dd>
              <dt className="font-semibold text-ink/60">Responsável</dt>
              <dd>{detail.user ? `${detail.user.name} (${detail.user.email})` : "—"}</dd>
              <dt className="font-semibold text-ink/60">Duração</dt>
              <dd>{detail.durationMs !== null ? `${detail.durationMs} ms` : "—"}</dd>
              <dt className="font-semibold text-ink/60">Resultado</dt>
              <dd>{STATUS_LABELS[detail.status] ?? detail.status}</dd>
            </dl>

            <p className="mt-2 rounded bg-ink/[0.03] px-3 py-2 text-xs text-ink/80">
              {detail.resultMessage}
            </p>

            <h4 className="mt-4 text-xs font-semibold uppercase tracking-wide text-ink/50">
              Endereço informado
            </h4>
            <p className="text-xs text-ink/80">
              {detail.address.street}, {detail.address.number}
              {detail.address.complement ? ` (${detail.address.complement})` : ""}
              {detail.address.neighborhood ? ` — ${detail.address.neighborhood}` : ""} —{" "}
              {detail.address.city}/{detail.address.state}
              {detail.address.postalCode ? ` · CEP ${detail.address.postalCode}` : ""}
            </p>

            <h4 className="mt-3 text-xs font-semibold uppercase tracking-wide text-ink/50">
              Localização
            </h4>
            <dl className="grid grid-cols-1 gap-x-6 gap-y-1 text-xs sm:grid-cols-2">
              <dt className="text-ink/60">Endereço localizado</dt>
              <dd>{detail.geocoding.geocodedAddress ?? "—"}</dd>
              <dt className="text-ink/60">Confiança</dt>
              <dd>
                {detail.geocoding.confidence
                  ? CONFIDENCE_LABELS[detail.geocoding.confidence]
                  : "—"}
                {detail.geocoding.partialMatch ? " · correspondência parcial" : ""}
              </dd>
              <dt className="text-ink/60">Tipo de localização</dt>
              <dd>
                {detail.geocoding.locationType
                  ? LOCATION_TYPE_LABELS[detail.geocoding.locationType] ??
                    detail.geocoding.locationType
                  : "—"}
              </dd>
              <dt className="text-ink/60">Coordenadas geocodificadas</dt>
              <dd className="font-mono">
                {detail.geocoding.latitude !== null && detail.geocoding.longitude !== null
                  ? `${detail.geocoding.latitude.toFixed(6)}, ${detail.geocoding.longitude.toFixed(6)}`
                  : "—"}
              </dd>
              <dt className="text-ink/60">Coordenadas confirmadas</dt>
              <dd className="font-mono">
                {detail.confirmation.latitude !== null && detail.confirmation.longitude !== null
                  ? `${detail.confirmation.latitude.toFixed(6)}, ${detail.confirmation.longitude.toFixed(6)}`
                  : "—"}
              </dd>
            </dl>
            {detail.confirmation.confirmedManually && (
              <p className="mt-1 text-[11px] text-ink/60">
                Ponto ajustado manualmente no mapa pelo operador.
              </p>
            )}

            <h4 className="mt-3 text-xs font-semibold uppercase tracking-wide text-ink/50">
              Coberturas encontradas na época
            </h4>
            {detail.coverage.matches.length === 0 ? (
              <p className="text-xs text-ink/60">Nenhuma cobertura encontrada.</p>
            ) : (
              <ul className="space-y-1 rounded border border-ink/10 bg-ink/[0.02] p-2">
                {detail.coverage.matches.map((match) => (
                  <li key={match.layerId} className="text-xs text-ink/80">
                    <span className="font-semibold">{match.partnerName}</span>
                    <span className="block text-ink/60">
                      {match.layerName}
                      {match.version ? ` · versão ${match.version}` : ""}
                    </span>
                  </li>
                ))}
              </ul>
            )}

            <h4 className="mt-3 text-xs font-semibold uppercase tracking-wide text-ink/50">
              Referência de rede (Voalle)
            </h4>
            <p className="text-xs text-ink/80">
              Status: {NETWORK_LABELS[detail.network.status] ?? detail.network.status}
            </p>
            {detail.network.reference && (
              <div className="mt-1 rounded border border-ink/10 bg-ink/[0.02] p-2 text-xs">
                <p>
                  Distância:{" "}
                  <span className="font-mono">{detail.network.reference.distanceMeters} m</span>
                </p>
                {detail.network.reference.identifiers.length > 0 && (
                  <ul className="mt-1 space-y-0.5">
                    {detail.network.reference.identifiers.map((identifier) => (
                      <li key={identifier.id} className="font-mono text-ink/80">
                        {identifier.code}
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            )}
            {detail.network.alternatives.length > 0 && (
              <p className="mt-1 text-[11px] text-ink/60">
                {detail.network.alternatives.length} ponto(s) alternativo(s) no raio de
                referência.
              </p>
            )}
          </div>
        </div>
    </>
  );
}
