import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  ApiError,
  getConsultation,
  getDashboardBreakdowns,
  getDashboardRankings,
  getDashboardRecentConsultations,
  getDashboardSummary,
  getDashboardTimeline,
  getDashboardUserOptions,
} from "../api";
import { SessionUser } from "../auth";
import { getReviewsSummary } from "../api";
import { ReviewsSummary } from "../types";
import ConsultationDetailsDialog, {
  NETWORK_LABELS,
  STATUS_LABELS,
  CONFIDENCE_LABELS,
  LOCATION_TYPE_LABELS,
  formatDateTime,
} from "./ConsultationDetailsDialog";
import {
  ConsultationDetail,
  DashboardBreakdowns,
  DashboardFilters,
  DashboardPreset,
  DashboardRankings,
  DashboardRecentConsultation,
  DashboardSummary,
  DashboardTimeline,
  DashboardUserOption,
} from "../types";

const PRESET_LABELS: Record<DashboardPreset, string> = {
  TODAY: "Hoje",
  LAST_7_DAYS: "Últimos 7 dias",
  LAST_30_DAYS: "Últimos 30 dias",
  CURRENT_MONTH: "Mês atual",
  PREVIOUS_MONTH: "Mês anterior",
  CUSTOM: "Personalizado",
};

interface DraftFilters {
  preset: DashboardPreset;
  dateFrom: string;
  dateTo: string;
  status: string;
  city: string;
  state: string;
  partnerCode: string;
  userId: string;
}

const EMPTY_DRAFT: DraftFilters = {
  preset: "LAST_30_DAYS",
  dateFrom: "",
  dateTo: "",
  status: "",
  city: "",
  state: "",
  partnerCode: "",
  userId: "",
};

const numberFormat = new Intl.NumberFormat("pt-BR");

function formatPercent(value: number): string {
  return `${(value * 100).toLocaleString("pt-BR", { maximumFractionDigits: 1 })}%`;
}

function formatDurationMs(value: number): string {
  if (value >= 1000) {
    return `${(value / 1000).toLocaleString("pt-BR", { maximumFractionDigits: 1 })} s`;
  }
  return `${Math.round(value).toLocaleString("pt-BR")} ms`;
}

/** Comparação com texto explícito (não depende de cor). */
function comparisonText(value: number | null, unit: "%" | "pp"): string | null {
  if (value === null) return null;
  const formatted = Math.abs(value).toLocaleString("pt-BR", { maximumFractionDigits: 1 });
  if (value > 0) return `aumento de ${formatted} ${unit === "pp" ? "ponto(s) percentual(is)" : "%"}`;
  if (value < 0) return `queda de ${formatted} ${unit === "pp" ? "ponto(s) percentual(is)" : "%"}`;
  return "sem variação";
}

function toApiFilters(draft: DraftFilters): DashboardFilters {
  return {
    preset: draft.preset,
    dateFrom: draft.preset === "CUSTOM" ? draft.dateFrom : undefined,
    dateTo: draft.preset === "CUSTOM" ? draft.dateTo : undefined,
    status: draft.status || undefined,
    city: draft.city || undefined,
    state: draft.state || undefined,
    partnerCode: draft.partnerCode || undefined,
    userId: draft.userId || undefined,
  };
}

/** Gráfico de evolução simples em SVG, com alternativa tabular acessível. */
function TimelineChart({ timeline }: { timeline: DashboardTimeline }) {
  const points = timeline.points;
  const width = 720;
  const height = 200;
  const padding = 28;
  const max = Math.max(1, ...points.map((point) => point.total));
  const stepX = points.length > 1 ? (width - padding * 2) / (points.length - 1) : 0;

  const path = (selector: (p: (typeof points)[number]) => number) =>
    points
      .map((point, index) => {
        const x = padding + index * stepX;
        const y = height - padding - (selector(point) / max) * (height - padding * 2);
        return `${index === 0 ? "M" : "L"}${x.toFixed(1)},${y.toFixed(1)}`;
      })
      .join(" ");

  const description = points
    .map(
      (point) =>
        `${point.period}: ${point.total} consulta(s), ${point.preliminarilyViable} viável(is), ${point.outsideCoverage} fora da cobertura`
    )
    .join("; ");

  if (points.every((point) => point.total === 0)) {
    return <p className="text-sm text-ink/50">Sem consultas no período selecionado.</p>;
  }

  return (
    <div>
      <svg
        viewBox={`0 0 ${width} ${height}`}
        role="img"
        aria-label={`Evolução das consultas por período (${timeline.granularity}). ${description}`}
        className="h-48 w-full"
      >
        <line
          x1={padding}
          y1={height - padding}
          x2={width - padding}
          y2={height - padding}
          stroke="currentColor"
          strokeOpacity="0.2"
        />
        <path d={path((p) => p.total)} fill="none" stroke="#155e75" strokeWidth="2.5" />
        <path d={path((p) => p.preliminarilyViable)} fill="none" stroke="#059669" strokeWidth="2" />
        <path d={path((p) => p.outsideCoverage)} fill="none" stroke="#dc2626" strokeWidth="2" />
        {points.map((point, index) => (
          <circle
            key={point.period}
            cx={padding + index * stepX}
            cy={height - padding - (point.total / max) * (height - padding * 2)}
            r="3"
            fill="#155e75"
          >
            <title>{`${point.period}: ${point.total} consulta(s)`}</title>
          </circle>
        ))}
      </svg>
      <div className="mt-1 flex flex-wrap gap-4 text-[11px] text-ink/70">
        <span>
          <span className="mr-1 inline-block h-2 w-4 rounded bg-[#155e75] align-middle" /> Total
        </span>
        <span>
          <span className="mr-1 inline-block h-2 w-4 rounded bg-[#059669] align-middle" /> Viáveis
        </span>
        <span>
          <span className="mr-1 inline-block h-2 w-4 rounded bg-[#dc2626] align-middle" /> Fora da
          cobertura
        </span>
      </div>
      {/* Alternativa tabular acessível */}
      <details className="mt-1 text-[11px] text-ink/60">
        <summary>Ver dados do gráfico em tabela</summary>
        <table className="mt-1 w-full text-left">
          <thead>
            <tr>
              <th className="pr-2">Período</th>
              <th className="pr-2">Total</th>
              <th className="pr-2">Viáveis</th>
              <th>Fora</th>
            </tr>
          </thead>
          <tbody>
            {points.map((point) => (
              <tr key={point.period}>
                <td className="pr-2">{point.period}</td>
                <td className="pr-2">{point.total}</td>
                <td className="pr-2">{point.preliminarilyViable}</td>
                <td>{point.outsideCoverage}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </details>
    </div>
  );
}

function BreakdownList({
  title,
  items,
}: {
  title: string;
  items: Array<{ label: string; count: number; percentage: number }>;
}) {
  return (
    <div className="rounded-lg border border-ink/10 bg-white p-4 shadow-sm">
      <h3 className="text-sm font-semibold">{title}</h3>
      {items.length === 0 ? (
        <p className="mt-2 text-xs text-ink/50">Sem dados no período.</p>
      ) : (
        <ul className="mt-2 space-y-2">
          {items.map((item) => (
            <li key={item.label} className="text-xs">
              <div className="flex justify-between">
                <span>{item.label}</span>
                <span className="text-ink/60">
                  {numberFormat.format(item.count)} ·{" "}
                  {item.percentage.toLocaleString("pt-BR", { maximumFractionDigits: 1 })}%
                </span>
              </div>
              <div
                className="mt-0.5 h-1.5 w-full rounded bg-ink/5"
                role="presentation"
                aria-hidden="true"
              >
                <div
                  className="h-1.5 rounded bg-petrol-800"
                  style={{ width: `${Math.min(100, item.percentage)}%` }}
                />
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

/** Dashboard operacional somente leitura (v0.5.0). */
export default function DashboardPage({ currentUser }: { currentUser: SessionUser }) {
  const isViewer = currentUser.role === "VIEWER";
  const canFilterByUser = !isViewer; // ADMIN, OPERATOR e TECHNICIAN

  const [draft, setDraft] = useState<DraftFilters>(EMPTY_DRAFT);
  const [applied, setApplied] = useState<DraftFilters>(EMPTY_DRAFT);
  const [filterError, setFilterError] = useState<string | null>(null);

  const [summary, setSummary] = useState<DashboardSummary | null>(null);
  const [summaryError, setSummaryError] = useState<string | null>(null);
  const [summaryLoading, setSummaryLoading] = useState(true);

  const [timeline, setTimeline] = useState<DashboardTimeline | null>(null);
  const [timelineError, setTimelineError] = useState<string | null>(null);

  const [breakdowns, setBreakdowns] = useState<DashboardBreakdowns | null>(null);
  const [breakdownsError, setBreakdownsError] = useState<string | null>(null);

  const [rankings, setRankings] = useState<DashboardRankings | null>(null);
  const [rankingsError, setRankingsError] = useState<string | null>(null);

  const [recent, setRecent] = useState<DashboardRecentConsultation[] | null>(null);
  const [recentError, setRecentError] = useState<string | null>(null);

  // Resumo da fila de análises (v0.6.0): consumido separadamente do
  // dashboard — uma falha aqui NUNCA derruba os indicadores principais.
  const [reviewsSummary, setReviewsSummary] = useState<ReviewsSummary | null>(null);
  const [reviewsSummaryError, setReviewsSummaryError] = useState<string | null>(null);

  useEffect(() => {
    getReviewsSummary()
      .then(setReviewsSummary)
      .catch(() => setReviewsSummaryError("Não foi possível carregar o resumo das análises."));
  }, []);

  const [userOptions, setUserOptions] = useState<DashboardUserOption[]>([]);
  const [detail, setDetail] = useState<ConsultationDetail | null>(null);

  const apiFilters = useMemo(() => toApiFilters(applied), [applied]);

  // Visualização lógica: registra DASHBOARD_VIEWED (recordView=true) apenas
  // uma vez por chave estável de filtros aplicados — o useRef impede a
  // duplicação do React.StrictMode; "Tentar novamente" reusa a mesma chave e
  // portanto não registra. A chave vive só em memória (nunca em storage).
  const lastRecordedViewKey = useRef<string | null>(null);

  const loadAll = useCallback(async () => {
    setSummaryLoading(true);
    // Estados independentes: uma falha nos rankings não esconde os cards.
    setSummary(null);
    setTimeline(null);
    setBreakdowns(null);
    setRankings(null);
    setRecent(null);
    setSummaryError(null);
    setTimelineError(null);
    setBreakdownsError(null);
    setRankingsError(null);
    setRecentError(null);
    const viewKey = JSON.stringify(apiFilters);
    const recordView = lastRecordedViewKey.current !== viewKey;
    if (recordView) lastRecordedViewKey.current = viewKey;
    await Promise.all([
      getDashboardSummary(apiFilters, { recordView })
        .then(setSummary)
        .catch((err) =>
          setSummaryError(err instanceof ApiError ? err.message : "Falha ao carregar o resumo.")
        )
        .finally(() => setSummaryLoading(false)),
      getDashboardTimeline(apiFilters)
        .then(setTimeline)
        .catch((err) =>
          setTimelineError(
            err instanceof ApiError ? err.message : "Falha ao carregar a evolução."
          )
        ),
      getDashboardBreakdowns(apiFilters)
        .then(setBreakdowns)
        .catch((err) =>
          setBreakdownsError(
            err instanceof ApiError ? err.message : "Falha ao carregar as distribuições."
          )
        ),
      getDashboardRankings(apiFilters)
        .then(setRankings)
        .catch((err) =>
          setRankingsError(
            err instanceof ApiError ? err.message : "Falha ao carregar os rankings."
          )
        ),
      getDashboardRecentConsultations({ ...apiFilters, limit: 10 })
        .then((data) => setRecent(data.consultations))
        .catch((err) =>
          setRecentError(
            err instanceof ApiError ? err.message : "Falha ao carregar as consultas recentes."
          )
        ),
    ]);
  }, [apiFilters]);

  useEffect(() => {
    void loadAll();
  }, [loadAll]);

  useEffect(() => {
    // O filtro usa o endpoint DEDICADO /api/dashboard/users (nunca o
    // /api/users administrativo, que segue ADMIN-only).
    if (!canFilterByUser) return;
    let cancelled = false;
    (async () => {
      try {
        const collected: DashboardUserOption[] = [];
        let page = 1;
        for (;;) {
          const data = await getDashboardUserOptions({ page, limit: 100 });
          collected.push(...data.users);
          const totalPages = Math.max(1, Math.ceil(data.total / data.limit));
          if (page >= totalPages || page >= 25) break;
          page += 1;
        }
        if (!cancelled) setUserOptions(collected);
      } catch {
        if (!cancelled) setUserOptions([]);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [canFilterByUser]);

  function applyFilters() {
    setFilterError(null);
    if (draft.preset === "CUSTOM") {
      if (!draft.dateFrom || !draft.dateTo) {
        setFilterError("Período personalizado exige data inicial e data final.");
        return;
      }
      if (draft.dateFrom > draft.dateTo) {
        setFilterError("A data inicial deve ser anterior ou igual à data final.");
        return;
      }
    }
    setApplied(draft);
  }

  function clearFilters() {
    setDraft(EMPTY_DRAFT);
    setApplied(EMPTY_DRAFT);
    setFilterError(null);
  }

  async function openDetail(id: string) {
    try {
      const data = await getConsultation(id);
      setDetail(data.consultation);
    } catch (err) {
      setRecentError(err instanceof ApiError ? err.message : "Falha ao abrir os detalhes.");
    }
  }

  const inputClass = "rounded border border-ink/20 px-3 py-2 text-sm";
  const linkButton = "text-xs font-medium text-petrol-800 hover:underline disabled:opacity-50";

  const cards = summary
    ? [
        {
          label: "Consultas",
          value: numberFormat.format(summary.totals.consultations),
          hint: "Total de consultas no período",
          change: comparisonText(summary.comparison.consultationsChangePercent, "%"),
        },
        {
          label: "Viáveis preliminarmente",
          value: numberFormat.format(summary.totals.preliminarilyViable),
          hint: "Dentro de alguma mancha ativa",
          change: null,
        },
        {
          label: "Fora da cobertura",
          value: numberFormat.format(summary.totals.outsideCoverage),
          hint: "Fora de todas as manchas",
          change: null,
        },
        {
          label: "Taxa de cobertura",
          value: formatPercent(summary.rates.coverageRate),
          hint: "Viáveis / (viáveis + fora da cobertura)",
          change: comparisonText(summary.comparison.coverageRateChangePercentagePoints, "pp"),
        },
        {
          label: "Referência de rede encontrada",
          value: formatPercent(summary.rates.networkReferenceFoundRate),
          hint: "Somente quando o Voalle foi consultado",
          change: null,
        },
        {
          label: "Confirmações manuais",
          value: formatPercent(summary.rates.manualConfirmationRate),
          hint: "Marcador ajustado pelo operador",
          change: null,
        },
        {
          label: "Tempo médio",
          value: formatDurationMs(summary.performance.averageDurationMs),
          hint: `Mediana ${formatDurationMs(summary.performance.medianDurationMs)} · p95 ${formatDurationMs(summary.performance.p95DurationMs)}`,
          change: comparisonText(summary.comparison.averageDurationChangePercent, "%"),
        },
      ]
    : [];

  return (
    <div className="space-y-4">
      {/* ── Filtros ── */}
      <section className="space-y-3 rounded-lg border border-ink/10 bg-white p-4 shadow-sm">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h2 className="text-base font-semibold">Dashboard</h2>
          {summary && (
            <p className="text-xs text-ink/60">
              Período: {summary.period.dateFrom} a {summary.period.dateTo} (
              {summary.period.timeZone})
            </p>
          )}
        </div>
        <div className="flex flex-wrap items-end gap-2">
          <div className="flex flex-col">
            <label htmlFor="dash-preset" className="text-xs font-medium text-ink/60">
              Período
            </label>
            <select
              id="dash-preset"
              value={draft.preset}
              onChange={(event) =>
                setDraft({ ...draft, preset: event.target.value as DashboardPreset })
              }
              className={inputClass}
            >
              {Object.entries(PRESET_LABELS).map(([value, label]) => (
                <option key={value} value={value}>
                  {label}
                </option>
              ))}
            </select>
          </div>
          {draft.preset === "CUSTOM" && (
            <>
              <div className="flex flex-col">
                <label htmlFor="dash-from" className="text-xs font-medium text-ink/60">
                  Data inicial
                </label>
                <input
                  id="dash-from"
                  type="date"
                  value={draft.dateFrom}
                  onChange={(event) => setDraft({ ...draft, dateFrom: event.target.value })}
                  className={inputClass}
                />
              </div>
              <div className="flex flex-col">
                <label htmlFor="dash-to" className="text-xs font-medium text-ink/60">
                  Data final
                </label>
                <input
                  id="dash-to"
                  type="date"
                  value={draft.dateTo}
                  onChange={(event) => setDraft({ ...draft, dateTo: event.target.value })}
                  className={inputClass}
                />
              </div>
            </>
          )}
          <div className="flex flex-col">
            <label htmlFor="dash-status" className="text-xs font-medium text-ink/60">
              Resultado
            </label>
            <select
              id="dash-status"
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
            <label htmlFor="dash-city" className="text-xs font-medium text-ink/60">
              Cidade
            </label>
            <input
              id="dash-city"
              value={draft.city}
              onChange={(event) => setDraft({ ...draft, city: event.target.value })}
              className={inputClass}
            />
          </div>
          <div className="flex flex-col">
            <label htmlFor="dash-state" className="text-xs font-medium text-ink/60">
              UF
            </label>
            <input
              id="dash-state"
              maxLength={2}
              value={draft.state}
              onChange={(event) => setDraft({ ...draft, state: event.target.value.toUpperCase() })}
              className={`${inputClass} w-16 uppercase`}
            />
          </div>
          <div className="flex flex-col">
            <label htmlFor="dash-partner" className="text-xs font-medium text-ink/60">
              Parceiro (código)
            </label>
            <input
              id="dash-partner"
              value={draft.partnerCode}
              onChange={(event) =>
                setDraft({ ...draft, partnerCode: event.target.value.toUpperCase() })
              }
              placeholder="REDE_NEUTRA"
              className={`${inputClass} font-mono uppercase`}
            />
          </div>
          {canFilterByUser && (
            <div className="flex flex-col">
              <label htmlFor="dash-user" className="text-xs font-medium text-ink/60">
                Usuário
              </label>
              <select
                id="dash-user"
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
          <button
            type="button"
            onClick={applyFilters}
            className="rounded bg-petrol-800 px-4 py-2 text-sm font-semibold text-white transition hover:opacity-90"
          >
            Aplicar
          </button>
          <button
            type="button"
            onClick={clearFilters}
            className="rounded border border-ink/20 px-4 py-2 text-sm text-ink/70 transition hover:bg-ink/5"
          >
            Limpar filtros
          </button>
        </div>
        {filterError && (
          <p role="alert" className="text-sm text-signal-blocked">
            {filterError}
          </p>
        )}
      </section>

      {/* ── Cards principais ── */}
      <section aria-label="Análises técnicas" className="mb-3">
        {reviewsSummaryError ? (
          <p className="text-xs text-ink/50">{reviewsSummaryError}</p>
        ) : reviewsSummary ? (
          <div className="grid gap-2 sm:grid-cols-4">
            {[
              { label: "Análises abertas", value: reviewsSummary.open },
              { label: "Análises atrasadas", value: reviewsSummary.overdue },
              { label: "Sem responsável", value: reviewsSummary.unassigned },
              { label: "Atribuídas a mim", value: reviewsSummary.assignedToMe },
            ].map((card) => (
              <div key={card.label} className="rounded-lg border border-ink/10 bg-white p-3 shadow-sm">
                <p className="text-[11px] font-medium uppercase tracking-wide text-ink/50">
                  {card.label}
                </p>
                <p className="text-xl font-semibold">{card.value}</p>
              </div>
            ))}
          </div>
        ) : null}
      </section>

      <section aria-label="Indicadores principais">
        {summaryError ? (
          <div className="rounded-lg border border-signal-blocked/40 bg-white p-4 text-sm shadow-sm">
            <p role="alert" className="text-signal-blocked">
              {summaryError}
            </p>
            <button type="button" onClick={() => void loadAll()} className={`mt-2 ${linkButton}`}>
              Tentar novamente
            </button>
          </div>
        ) : summaryLoading ? (
          <p className="text-sm text-ink/60">Carregando indicadores…</p>
        ) : (
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            {cards.map((card) => (
              <div
                key={card.label}
                className="rounded-lg border border-ink/10 bg-white p-4 shadow-sm"
              >
                <p className="text-xs font-medium uppercase tracking-wide text-ink/50">
                  {card.label}
                </p>
                <p className="mt-1 text-2xl font-semibold">{card.value}</p>
                <p className="text-[11px] text-ink/50">{card.hint}</p>
                {card.change && (
                  <p className="mt-1 text-[11px] text-ink/70">
                    vs. período anterior: {card.change}
                  </p>
                )}
              </div>
            ))}
          </div>
        )}
      </section>

      {/* ── Evolução ── */}
      <section className="rounded-lg border border-ink/10 bg-white p-4 shadow-sm">
        <h3 className="text-sm font-semibold">Evolução das consultas</h3>
        {timelineError ? (
          <div>
            <p role="alert" className="mt-2 text-sm text-signal-blocked">
              {timelineError}
            </p>
            <button type="button" onClick={() => void loadAll()} className={`mt-1 ${linkButton}`}>
              Tentar novamente
            </button>
          </div>
        ) : timeline ? (
          <TimelineChart timeline={timeline} />
        ) : (
          <p className="mt-2 text-sm text-ink/60">Carregando…</p>
        )}
      </section>

      {/* ── Distribuições ── */}
      {breakdownsError ? (
        <p role="alert" className="text-sm text-signal-blocked">
          {breakdownsError}
        </p>
      ) : (
        breakdowns && (
          <section className="grid gap-3 lg:grid-cols-2" aria-label="Distribuições">
            <BreakdownList
              title="Resultados"
              items={breakdowns.byStatus.map((item) => ({
                label: STATUS_LABELS[item.status] ?? item.status,
                count: item.count,
                percentage: item.percentage,
              }))}
            />
            <BreakdownList
              title="Referência de rede (Voalle)"
              items={breakdowns.byNetworkReferenceStatus.map((item) => ({
                label: NETWORK_LABELS[item.status] ?? item.status,
                count: item.count,
                percentage: item.percentage,
              }))}
            />
            <BreakdownList
              title="Confiança da geocodificação"
              items={breakdowns.byGeocodingConfidence.map((item) => ({
                label: CONFIDENCE_LABELS[item.confidence] ?? item.confidence,
                count: item.count,
                percentage: item.percentage,
              }))}
            />
            <BreakdownList
              title="Tipo de localização"
              items={breakdowns.byGeocodingLocationType.map((item) => ({
                label: LOCATION_TYPE_LABELS[item.locationType] ?? item.locationType,
                count: item.count,
                percentage: item.percentage,
              }))}
            />
          </section>
        )
      )}

      {/* ── Rankings ── */}
      <section aria-label="Rankings">
        {rankingsError ? (
          <div className="rounded-lg border border-signal-blocked/40 bg-white p-4 text-sm shadow-sm">
            <p role="alert" className="text-signal-blocked">
              {rankingsError}
            </p>
            <button type="button" onClick={() => void loadAll()} className={`mt-2 ${linkButton}`}>
              Tentar novamente
            </button>
          </div>
        ) : (
          rankings && (
            <div className="grid gap-3 lg:grid-cols-2">
              <div className="rounded-lg border border-ink/10 bg-white p-4 shadow-sm">
                <h3 className="text-sm font-semibold">Parceiros mais encontrados</h3>
                {rankings.partners.length === 0 ? (
                  <p className="mt-2 text-xs text-ink/50">Sem dados no período.</p>
                ) : (
                  <table className="mt-2 w-full text-left text-xs">
                    <thead>
                      <tr className="text-ink/50">
                        <th className="py-1 pr-2">Parceiro</th>
                        <th className="py-1 pr-2">Código</th>
                        <th className="py-1 pr-2">Consultas</th>
                        <th className="py-1">Ocorrências</th>
                      </tr>
                    </thead>
                    <tbody>
                      {rankings.partners.map((partner) => (
                        <tr key={`${partner.partnerCode}-${partner.partnerName}`}>
                          <td className="py-1 pr-2 font-medium">{partner.partnerName}</td>
                          <td className="py-1 pr-2 font-mono">{partner.partnerCode ?? "—"}</td>
                          <td className="py-1 pr-2">{partner.consultationCount}</td>
                          <td className="py-1">{partner.matchCount}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                )}
              </div>
              <div className="rounded-lg border border-ink/10 bg-white p-4 shadow-sm">
                <h3 className="text-sm font-semibold">Camadas mais encontradas</h3>
                {rankings.layers.length === 0 ? (
                  <p className="mt-2 text-xs text-ink/50">Sem dados no período.</p>
                ) : (
                  <table className="mt-2 w-full text-left text-xs">
                    <thead>
                      <tr className="text-ink/50">
                        <th className="py-1 pr-2">Camada</th>
                        <th className="py-1 pr-2">Parceiro</th>
                        <th className="py-1 pr-2">Versão</th>
                        <th className="py-1">Consultas</th>
                      </tr>
                    </thead>
                    <tbody>
                      {rankings.layers.map((layer) => (
                        <tr key={`${layer.layerId ?? layer.layerName}-${layer.version ?? ""}`}>
                          <td className="py-1 pr-2 font-medium">{layer.layerName}</td>
                          <td className="py-1 pr-2">{layer.partnerName}</td>
                          <td className="py-1 pr-2">{layer.version ?? "—"}</td>
                          <td className="py-1">{layer.consultationCount}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                )}
              </div>
              <div className="rounded-lg border border-ink/10 bg-white p-4 shadow-sm">
                <h3 className="text-sm font-semibold">Cidades</h3>
                {rankings.cities.length === 0 ? (
                  <p className="mt-2 text-xs text-ink/50">Sem dados no período.</p>
                ) : (
                  <table className="mt-2 w-full text-left text-xs">
                    <thead>
                      <tr className="text-ink/50">
                        <th className="py-1 pr-2">Cidade/UF</th>
                        <th className="py-1 pr-2">Consultas</th>
                        <th className="py-1">Taxa de cobertura</th>
                      </tr>
                    </thead>
                    <tbody>
                      {rankings.cities.map((city) => (
                        <tr key={`${city.city}-${city.state}`}>
                          <td className="py-1 pr-2 font-medium">
                            {city.city}/{city.state}
                          </td>
                          <td className="py-1 pr-2">{city.consultationCount}</td>
                          <td className="py-1">{formatPercent(city.coverageRate)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                )}
              </div>
              {!isViewer && (
                <div className="rounded-lg border border-ink/10 bg-white p-4 shadow-sm">
                  <h3 className="text-sm font-semibold">Usuários</h3>
                  {rankings.users.length === 0 ? (
                    <p className="mt-2 text-xs text-ink/50">Sem dados no período.</p>
                  ) : (
                    <table className="mt-2 w-full text-left text-xs">
                      <thead>
                        <tr className="text-ink/50">
                          <th className="py-1 pr-2">Nome</th>
                          <th className="py-1 pr-2">E-mail</th>
                          <th className="py-1">Consultas</th>
                        </tr>
                      </thead>
                      <tbody>
                        {rankings.users.map((user) => (
                          <tr key={user.userId}>
                            <td className="py-1 pr-2 font-medium">{user.name}</td>
                            <td className="py-1 pr-2">{user.email}</td>
                            <td className="py-1">{user.consultationCount}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  )}
                </div>
              )}
            </div>
          )
        )}
      </section>

      {/* ── Consultas recentes ── */}
      <section className="rounded-lg border border-ink/10 bg-white p-4 shadow-sm">
        <h3 className="text-sm font-semibold">Consultas recentes</h3>
        {recentError ? (
          <div>
            <p role="alert" className="mt-2 text-sm text-signal-blocked">
              {recentError}
            </p>
            <button type="button" onClick={() => void loadAll()} className={`mt-1 ${linkButton}`}>
              Tentar novamente
            </button>
          </div>
        ) : recent === null ? (
          <p className="mt-2 text-sm text-ink/60">Carregando…</p>
        ) : recent.length === 0 ? (
          <p className="mt-2 text-sm text-ink/50">Nenhuma consulta no período.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="mt-2 w-full text-left text-sm">
              <thead>
                <tr className="border-b border-ink/10 text-xs uppercase tracking-wide text-ink/50">
                  <th className="py-2 pr-3">Protocolo</th>
                  <th className="py-2 pr-3">Data</th>
                  <th className="py-2 pr-3">Endereço</th>
                  <th className="py-2 pr-3">Resultado</th>
                  <th className="py-2 pr-3">Coberturas</th>
                  <th className="py-2 pr-3">Referência</th>
                  <th className="py-2 pr-3">Responsável</th>
                  <th className="py-2">Ações</th>
                </tr>
              </thead>
              <tbody>
                {recent.map((item) => (
                  <tr key={item.id} className="border-b border-ink/5">
                    <td className="py-2 pr-3 font-mono text-xs">{item.protocol}</td>
                    <td className="py-2 pr-3 text-xs text-ink/70">
                      {formatDateTime(item.createdAt)}
                    </td>
                    <td className="py-2 pr-3 text-xs">
                      {item.address.street}, {item.address.number} — {item.address.city}/
                      {item.address.state}
                    </td>
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
                        className={linkButton}
                      >
                        Ver detalhes
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      {detail && <ConsultationDetailsDialog detail={detail} onClose={() => setDetail(null)} />}
    </div>
  );
}
