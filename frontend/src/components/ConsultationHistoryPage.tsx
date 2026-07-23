import { useCallback, useEffect, useState } from "react";
import {
  ApiError,
  exportConsultations,
  getConsultation,
  listConsultations,
  listUsers,
} from "../api";
import { SessionUser } from "../auth";
import { copyTextToClipboard } from "./ResultPanel";
import {
  ConsultationDetail,
  ConsultationListParams,
  ConsultationSummary,
  PublicUser,
} from "../types";

const LIMIT = 20;

const STATUS_LABELS: Record<string, string> = {
  PRELIMINARILY_VIABLE: "Viável preliminarmente",
  OUTSIDE_COVERAGE: "Fora da cobertura",
  COVERAGE_NOT_CONFIGURED: "Cobertura não configurada",
  COVERAGE_NOT_LOADED: "Cobertura indisponível",
  ADDRESS_NOT_FOUND: "Endereço não localizado",
  ADDRESS_AMBIGUOUS: "Confirmação pendente",
  GEOCODING_UNAVAILABLE: "Localização indisponível",
};

const NETWORK_LABELS: Record<string, string> = {
  FOUND: "Encontrada",
  NOT_FOUND: "Não encontrada",
  VOALLE_UNAVAILABLE: "Voalle indisponível",
  NOT_CHECKED: "Não consultada",
};

const CONFIDENCE_LABELS: Record<string, string> = {
  HIGH: "Alta",
  MEDIUM: "Média",
  LOW: "Baixa",
};

const LOCATION_TYPE_LABELS: Record<string, string> = {
  ROOFTOP: "Localização exata",
  RANGE_INTERPOLATED: "Localização aproximada entre números",
  GEOMETRIC_CENTER: "Centro do logradouro ou da área",
  APPROXIMATE: "Localização aproximada",
  UNKNOWN: "Precisão não informada",
};

interface Filters {
  search: string;
  status: string;
  dateFrom: string;
  dateTo: string;
  postalCode: string;
  city: string;
  state: string;
  userId: string;
  hasCoverage: "" | "true" | "false";
  networkReferenceStatus: string;
}

const EMPTY_FILTERS: Filters = {
  search: "",
  status: "",
  dateFrom: "",
  dateTo: "",
  postalCode: "",
  city: "",
  state: "",
  userId: "",
  hasCoverage: "",
  networkReferenceStatus: "",
};

function formatDateTime(value: string): string {
  return new Date(value).toLocaleString("pt-BR", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function shortAddress(item: ConsultationSummary): string {
  return `${item.address.street}, ${item.address.number} — ${item.address.city}/${item.address.state}`;
}

/** Histórico persistente e imutável das consultas de viabilidade. */
export default function ConsultationHistoryPage({ currentUser }: { currentUser: SessionUser }) {
  const isAdmin = currentUser.role === "ADMIN";
  const canFilterByUser = currentUser.role !== "VIEWER";

  const [items, setItems] = useState<ConsultationSummary[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [draft, setDraft] = useState<Filters>(EMPTY_FILTERS);
  const [applied, setApplied] = useState<Filters>(EMPTY_FILTERS);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [userOptions, setUserOptions] = useState<PublicUser[]>([]);
  const [detail, setDetail] = useState<ConsultationDetail | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [protocolCopied, setProtocolCopied] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const params: ConsultationListParams = {
        search: applied.search || undefined,
        status: applied.status || undefined,
        dateFrom: applied.dateFrom || undefined,
        dateTo: applied.dateTo || undefined,
        postalCode: applied.postalCode || undefined,
        city: applied.city || undefined,
        state: applied.state || undefined,
        userId: applied.userId || undefined,
        hasCoverage: applied.hasCoverage || undefined,
        networkReferenceStatus: applied.networkReferenceStatus || undefined,
        page,
      };
      const data = await listConsultations(params);
      setItems(data.consultations);
      setTotal(data.total);
    } catch (err) {
      setItems([]);
      setTotal(0);
      setError(err instanceof ApiError ? err.message : "Falha ao carregar o histórico.");
    } finally {
      setLoading(false);
    }
  }, [applied, page]);

  useEffect(() => {
    void load();
  }, [load]);

  // Filtro por usuário: apenas para perfis que enxergam todas as consultas.
  useEffect(() => {
    if (!canFilterByUser || !isAdmin) return; // /api/users é ADMIN-only
    let cancelled = false;
    (async () => {
      try {
        const collected: PublicUser[] = [];
        let current = 1;
        for (;;) {
          const data = await listUsers({ page: current });
          collected.push(...data.users);
          const totalPages = Math.max(1, Math.ceil(data.total / data.pageSize));
          if (current >= totalPages || current >= 25) break;
          current += 1;
        }
        if (!cancelled) setUserOptions(collected);
      } catch {
        if (!cancelled) setUserOptions([]);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [canFilterByUser, isAdmin]);

  function applyFilters() {
    setPage(1);
    setApplied(draft);
  }

  function clearFilters() {
    setDraft(EMPTY_FILTERS);
    setApplied(EMPTY_FILTERS);
    setPage(1);
  }

  async function openDetail(id: string) {
    setNotice(null);
    setDetailLoading(true);
    try {
      const data = await getConsultation(id);
      setDetail(data.consultation);
    } catch (err) {
      if (err instanceof ApiError && err.code === "CONSULTATION_NOT_FOUND") {
        setError("Consulta não encontrada ou sem permissão de acesso.");
      } else if (err instanceof ApiError && err.code === "CONSULTATION_ACCESS_DENIED") {
        setError("Você não tem permissão para abrir esta consulta.");
      } else {
        setError(err instanceof ApiError ? err.message : "Falha ao abrir os detalhes.");
      }
    } finally {
      setDetailLoading(false);
    }
  }

  async function handleExport() {
    if (exporting) return;
    setNotice(null);
    setError(null);
    setExporting(true);
    try {
      await exportConsultations({
        search: applied.search || undefined,
        status: applied.status || undefined,
        dateFrom: applied.dateFrom || undefined,
        dateTo: applied.dateTo || undefined,
        postalCode: applied.postalCode || undefined,
        city: applied.city || undefined,
        state: applied.state || undefined,
        userId: applied.userId || undefined,
        hasCoverage: applied.hasCoverage || undefined,
        networkReferenceStatus: applied.networkReferenceStatus || undefined,
      });
      setNotice("Exportação iniciada — o download começará em instantes.");
    } catch (err) {
      if (err instanceof ApiError && err.code === "CONSULTATION_EXPORT_LIMIT_EXCEEDED") {
        setError(err.message);
      } else {
        setError(err instanceof ApiError ? err.message : "Falha ao exportar as consultas.");
      }
    } finally {
      setExporting(false);
    }
  }

  const totalPages = Math.max(1, Math.ceil(total / LIMIT));
  const inputClass = "rounded border border-ink/20 px-3 py-2 text-sm";
  const linkButton = "text-xs font-medium text-petrol-800 hover:underline disabled:opacity-50";

  return (
    <div className="space-y-4">
      <section className="space-y-3 rounded-lg border border-ink/10 bg-white p-4 shadow-sm">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h2 className="text-base font-semibold">Histórico de consultas</h2>
          {isAdmin && (
            <button
              type="button"
              onClick={() => void handleExport()}
              disabled={exporting}
              className="rounded border border-ink/20 px-4 py-2 text-sm text-ink/70 transition hover:bg-ink/5 disabled:opacity-60"
            >
              {exporting ? "Exportando…" : "Exportar CSV"}
            </button>
          )}
        </div>

        <div className="flex flex-wrap items-end gap-2">
          <div className="flex flex-col">
            <label htmlFor="hist-search" className="text-xs font-medium text-ink/60">
              Buscar
            </label>
            <input
              id="hist-search"
              value={draft.search}
              onChange={(event) => setDraft({ ...draft, search: event.target.value })}
              placeholder="Protocolo, endereço, responsável"
              className={inputClass}
            />
          </div>
          <div className="flex flex-col">
            <label htmlFor="hist-status" className="text-xs font-medium text-ink/60">
              Resultado
            </label>
            <select
              id="hist-status"
              value={draft.status}
              onChange={(event) => setDraft({ ...draft, status: event.target.value })}
              className={inputClass}
            >
              <option value="">Todos</option>
              {Object.entries(STATUS_LABELS).map(([value, label]) => (
                <option key={value} value={value}>
                  {label}
                </option>
              ))}
            </select>
          </div>
          <div className="flex flex-col">
            <label htmlFor="hist-from" className="text-xs font-medium text-ink/60">
              Data inicial
            </label>
            <input
              id="hist-from"
              type="date"
              value={draft.dateFrom}
              onChange={(event) => setDraft({ ...draft, dateFrom: event.target.value })}
              className={inputClass}
            />
          </div>
          <div className="flex flex-col">
            <label htmlFor="hist-to" className="text-xs font-medium text-ink/60">
              Data final
            </label>
            <input
              id="hist-to"
              type="date"
              value={draft.dateTo}
              onChange={(event) => setDraft({ ...draft, dateTo: event.target.value })}
              className={inputClass}
            />
          </div>
          <div className="flex flex-col">
            <label htmlFor="hist-cep" className="text-xs font-medium text-ink/60">
              CEP
            </label>
            <input
              id="hist-cep"
              value={draft.postalCode}
              onChange={(event) => setDraft({ ...draft, postalCode: event.target.value })}
              className={`${inputClass} w-28`}
            />
          </div>
          <div className="flex flex-col">
            <label htmlFor="hist-city" className="text-xs font-medium text-ink/60">
              Cidade
            </label>
            <input
              id="hist-city"
              value={draft.city}
              onChange={(event) => setDraft({ ...draft, city: event.target.value })}
              className={inputClass}
            />
          </div>
          <div className="flex flex-col">
            <label htmlFor="hist-state" className="text-xs font-medium text-ink/60">
              UF
            </label>
            <input
              id="hist-state"
              maxLength={2}
              value={draft.state}
              onChange={(event) =>
                setDraft({ ...draft, state: event.target.value.toUpperCase() })
              }
              className={`${inputClass} w-16 uppercase`}
            />
          </div>
          {canFilterByUser && isAdmin && (
            <div className="flex flex-col">
              <label htmlFor="hist-user" className="text-xs font-medium text-ink/60">
                Usuário
              </label>
              <select
                id="hist-user"
                value={draft.userId}
                onChange={(event) => setDraft({ ...draft, userId: event.target.value })}
                className={inputClass}
              >
                <option value="">Todos</option>
                {userOptions.map((user) => (
                  <option key={user.id} value={user.id}>
                    {user.name}
                  </option>
                ))}
              </select>
            </div>
          )}
          <div className="flex flex-col">
            <label htmlFor="hist-coverage" className="text-xs font-medium text-ink/60">
              Cobertura
            </label>
            <select
              id="hist-coverage"
              value={draft.hasCoverage}
              onChange={(event) =>
                setDraft({ ...draft, hasCoverage: event.target.value as "" | "true" | "false" })
              }
              className={inputClass}
            >
              <option value="">Todos</option>
              <option value="true">Com cobertura</option>
              <option value="false">Sem cobertura</option>
            </select>
          </div>
          <div className="flex flex-col">
            <label htmlFor="hist-network" className="text-xs font-medium text-ink/60">
              Referência de rede
            </label>
            <select
              id="hist-network"
              value={draft.networkReferenceStatus}
              onChange={(event) =>
                setDraft({ ...draft, networkReferenceStatus: event.target.value })
              }
              className={inputClass}
            >
              <option value="">Todas</option>
              {Object.entries(NETWORK_LABELS).map(([value, label]) => (
                <option key={value} value={value}>
                  {label}
                </option>
              ))}
            </select>
          </div>
          <button
            type="button"
            onClick={applyFilters}
            className="rounded bg-petrol-800 px-4 py-2 text-sm font-semibold text-white transition hover:opacity-90"
          >
            Buscar
          </button>
          <button
            type="button"
            onClick={clearFilters}
            className="rounded border border-ink/20 px-4 py-2 text-sm text-ink/70 transition hover:bg-ink/5"
          >
            Limpar filtros
          </button>
        </div>

        {notice && (
          <p role="status" className="rounded bg-signal-viable/10 px-3 py-2 text-sm text-emerald-900">
            {notice}
          </p>
        )}
        {error && (
          <p role="alert" className="text-sm text-signal-blocked">
            {error}
          </p>
        )}

        {loading ? (
          <p className="text-sm text-ink/60">Carregando…</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm">
              <thead>
                <tr className="border-b border-ink/10 text-xs uppercase tracking-wide text-ink/50">
                  <th className="py-2 pr-3">Protocolo</th>
                  <th className="py-2 pr-3">Data</th>
                  <th className="py-2 pr-3">Endereço</th>
                  <th className="py-2 pr-3">Resultado</th>
                  <th className="py-2 pr-3">Coberturas</th>
                  <th className="py-2 pr-3">Referência de rede</th>
                  <th className="py-2 pr-3">Responsável</th>
                  <th className="py-2">Ações</th>
                </tr>
              </thead>
              <tbody>
                {items.map((item) => (
                  <tr key={item.id} className="border-b border-ink/5">
                    <td className="py-2 pr-3 font-mono text-xs">{item.protocol}</td>
                    <td className="py-2 pr-3 text-xs text-ink/70">
                      {formatDateTime(item.createdAt)}
                    </td>
                    <td className="py-2 pr-3 text-xs">{shortAddress(item)}</td>
                    <td className="py-2 pr-3 text-xs">
                      {STATUS_LABELS[item.status] ?? item.status}
                    </td>
                    <td className="py-2 pr-3">{item.coverageMatchCount}</td>
                    <td className="py-2 pr-3 text-xs">
                      {NETWORK_LABELS[item.networkReferenceStatus] ?? item.networkReferenceStatus}
                    </td>
                    <td className="py-2 pr-3 text-xs">{item.user?.name ?? "—"}</td>
                    <td className="py-2">
                      <button
                        type="button"
                        onClick={() => void openDetail(item.id)}
                        disabled={detailLoading}
                        className={linkButton}
                      >
                        Ver detalhes
                      </button>
                    </td>
                  </tr>
                ))}
                {items.length === 0 && (
                  <tr>
                    <td colSpan={8} className="py-4 text-center text-sm text-ink/50">
                      Nenhuma consulta encontrada.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        )}

        <div className="flex items-center justify-between text-xs text-ink/60">
          <span>
            {total} consulta(s) · página {page} de {totalPages}
          </span>
          <div className="flex gap-2">
            <button
              type="button"
              disabled={page <= 1}
              onClick={() => setPage((value) => Math.max(1, value - 1))}
              className={linkButton}
            >
              Anterior
            </button>
            <button
              type="button"
              disabled={page >= totalPages}
              onClick={() => setPage((value) => Math.min(totalPages, value + 1))}
              className={linkButton}
            >
              Próxima
            </button>
          </div>
        </div>
      </section>

      {detail && (
        <div
          role="dialog"
          aria-modal="true"
          aria-label={`Detalhes da consulta ${detail.protocol}`}
          className="fixed inset-0 z-50 flex items-center justify-center bg-ink/40 px-4 py-6"
          onKeyDown={(event) => {
            if (event.key === "Escape") setDetail(null);
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
                  onClick={() => setDetail(null)}
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
      )}
    </div>
  );
}
