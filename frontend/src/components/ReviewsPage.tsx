import { useCallback, useEffect, useMemo, useState } from "react";
import {
  ApiError,
  createReview,
  claimReview,
  getDashboardUserOptions,
  getReviewAssignees,
  getReviewByConsultation,
  getReviewsSummary,
  listReviews,
} from "../api";
import { SessionUser } from "../auth";
import { STATUS_LABELS, formatDateTime } from "./ConsultationDetailsDialog";
import ReviewDetailsDialog, {
  REVIEW_PRIORITY_LABELS,
  REVIEW_STATUS_LABELS,
  slaText,
} from "./ReviewDetailsDialog";
import {
  DashboardUserOption,
  ReviewAssigneeOption,
  ReviewListParams,
  ReviewPriority,
  ReviewsSummary,
  ReviewStatus,
  ViabilityReviewListItem,
} from "../types";

interface DraftFilters {
  search: string;
  status: string;
  priority: string;
  assignedToId: string;
  openedById: string;
  city: string;
  state: string;
  overdue: boolean;
  unassigned: boolean;
  dateFrom: string;
  dateTo: string;
  dueFrom: string;
  dueTo: string;
}

const EMPTY_FILTERS: DraftFilters = {
  search: "",
  status: "",
  priority: "",
  assignedToId: "",
  openedById: "",
  city: "",
  state: "",
  overdue: false,
  unassigned: false,
  dateFrom: "",
  dateTo: "",
  dueFrom: "",
  dueTo: "",
};

function toParams(draft: DraftFilters, page: number): ReviewListParams {
  return {
    search: draft.search || undefined,
    status: (draft.status || undefined) as ReviewStatus | undefined,
    priority: (draft.priority || undefined) as ReviewPriority | undefined,
    assignedToId: draft.assignedToId || undefined,
    openedById: draft.openedById || undefined,
    city: draft.city || undefined,
    state: draft.state || undefined,
    overdue: draft.overdue || undefined,
    unassigned: draft.unassigned || undefined,
    // Datas de calendário puras (AAAA-MM-DD): o backend interpreta no fuso
    // configurado (CONSULTATION_TIME_ZONE) — nunca concatenar Z aqui.
    dateFrom: draft.dateFrom || undefined,
    dateTo: draft.dateTo || undefined,
    dueFrom: draft.dueFrom || undefined,
    dueTo: draft.dueTo || undefined,
    page,
    limit: 20,
  };
}

/** Fila operacional de análises técnicas (v0.6.0). Filtros só em estado React. */
export default function ReviewsPage({
  currentUser,
  openConsultationHistory,
}: {
  currentUser: SessionUser;
  openConsultationHistory?: (protocol: string) => void;
}) {
  const role = currentUser.role;
  const isViewer = role === "VIEWER";
  const canClaim = role === "ADMIN" || role === "TECHNICIAN";

  const [summary, setSummary] = useState<ReviewsSummary | null>(null);
  const [summaryError, setSummaryError] = useState<string | null>(null);
  const [rows, setRows] = useState<ViabilityReviewListItem[] | null>(null);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [listError, setListError] = useState<string | null>(null);
  const [draft, setDraft] = useState<DraftFilters>(EMPTY_FILTERS);
  const [applied, setApplied] = useState<DraftFilters>(EMPTY_FILTERS);
  const [detailId, setDetailId] = useState<string | null>(null);
  const [userOptions, setUserOptions] = useState<DashboardUserOption[]>([]);
  const [assigneeOptions, setAssigneeOptions] = useState<ReviewAssigneeOption[]>([]);
  const [actionError, setActionError] = useState<string | null>(null);

  const params = useMemo(() => toParams(applied, page), [applied, page]);

  const loadSummary = useCallback(async () => {
    setSummaryError(null);
    try {
      setSummary(await getReviewsSummary());
    } catch (err) {
      setSummaryError(err instanceof ApiError ? err.message : "Falha ao carregar o resumo.");
    }
  }, []);

  const loadList = useCallback(async () => {
    setListError(null);
    setRows(null);
    try {
      const data = await listReviews(params);
      setRows(data.reviews);
      setTotal(data.total);
    } catch (err) {
      setListError(err instanceof ApiError ? err.message : "Falha ao carregar a fila.");
    }
  }, [params]);

  useEffect(() => {
    void loadSummary();
  }, [loadSummary]);
  useEffect(() => {
    void loadList();
  }, [loadList]);

  useEffect(() => {
    if (isViewer) return; // VIEWER não recebe opções de outros usuários
    // "Aberta por": qualquer perfil pode ter aberto → opções do dashboard.
    getDashboardUserOptions({ limit: 100 })
      .then((data) => setUserOptions(data.users))
      .catch(() => setUserOptions([]));
    // "Responsável": somente ADMIN/TECHNICIAN ativos (endpoint dedicado).
    getReviewAssignees({ limit: 100 })
      .then((data) => setAssigneeOptions(data.users))
      .catch(() => setAssigneeOptions([]));
  }, [isViewer]);

  function applyFilters() {
    setPage(1);
    setApplied(draft);
  }
  function clearFilters() {
    setDraft(EMPTY_FILTERS);
    setApplied(EMPTY_FILTERS);
    setPage(1);
  }

  async function handleClaim(id: string, version: number) {
    setActionError(null);
    try {
      await claimReview(id, { version });
      await Promise.all([loadList(), loadSummary()]);
    } catch (err) {
      if (err instanceof ApiError && (err.code === "REVIEW_NOT_ACTIVE" || err.code === "REVIEW_CONFLICT" || err.code === "REVIEW_ALREADY_ASSIGNED")) {
        setActionError(`${err.message} A fila foi recarregada.`);
      } else {
        setActionError(err instanceof ApiError ? err.message : "Falha ao assumir a análise.");
      }
      await loadList();
    }
  }

  const totalPages = Math.max(1, Math.ceil(total / 20));
  const inputClass = "rounded border border-ink/20 px-3 py-2 text-sm";
  const cards = summary
    ? [
        { label: "Em aberto", value: summary.open },
        { label: "Em análise", value: summary.inProgress },
        { label: "Aguardando informações", value: summary.waitingInformation },
        { label: "Atrasadas", value: summary.overdue },
        { label: "Sem responsável", value: summary.unassigned },
        { label: "Atribuídas a mim", value: summary.assignedToMe },
        { label: "Aprovadas", value: summary.approved },
        { label: "Rejeitadas", value: summary.rejected },
      ]
    : [];

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="text-base font-semibold">Análises técnicas</h2>
      </div>

      {/* ── Cards de resumo ── */}
      {summaryError ? (
        <p role="alert" className="text-sm text-signal-blocked">
          {summaryError}
        </p>
      ) : summary ? (
        <div className="grid gap-2 sm:grid-cols-4">
          {cards.map((card) => (
            <div key={card.label} className="rounded-lg border border-ink/10 bg-white p-3 shadow-sm">
              <p className="text-[11px] font-medium uppercase tracking-wide text-ink/50">
                {card.label}
              </p>
              <p className="text-xl font-semibold">{card.value}</p>
            </div>
          ))}
        </div>
      ) : (
        <p className="text-sm text-ink/60">Carregando resumo…</p>
      )}

      {/* ── Filtros ── */}
      <section className="space-y-2 rounded-lg border border-ink/10 bg-white p-4 shadow-sm">
        <div className="flex flex-wrap items-end gap-2">
          <div className="flex flex-col">
            <label htmlFor="rv-search" className="text-xs font-medium text-ink/60">
              Busca
            </label>
            <input id="rv-search" value={draft.search} onChange={(event) => setDraft({ ...draft, search: event.target.value })} placeholder="Protocolo, endereço, responsável…" className={`${inputClass} w-56`} />
          </div>
          <div className="flex flex-col">
            <label htmlFor="rv-status" className="text-xs font-medium text-ink/60">
              Status
            </label>
            <select id="rv-status" value={draft.status} onChange={(event) => setDraft({ ...draft, status: event.target.value })} className={inputClass}>
              <option value="">Todos</option>
              {Object.entries(REVIEW_STATUS_LABELS).map(([value, label]) => (
                <option key={value} value={value}>
                  {label}
                </option>
              ))}
            </select>
          </div>
          <div className="flex flex-col">
            <label htmlFor="rv-priority" className="text-xs font-medium text-ink/60">
              Prioridade
            </label>
            <select id="rv-priority" value={draft.priority} onChange={(event) => setDraft({ ...draft, priority: event.target.value })} className={inputClass}>
              <option value="">Todas</option>
              {Object.entries(REVIEW_PRIORITY_LABELS).map(([value, label]) => (
                <option key={value} value={value}>
                  {label}
                </option>
              ))}
            </select>
          </div>
          {!isViewer && (
            <>
              <div className="flex flex-col">
                <label htmlFor="rv-assignee" className="text-xs font-medium text-ink/60">
                  Responsável
                </label>
                <select id="rv-assignee" value={draft.assignedToId} onChange={(event) => setDraft({ ...draft, assignedToId: event.target.value })} className={inputClass}>
                  <option value="">Todos</option>
                  {assigneeOptions.map((user) => (
                    <option key={user.id} value={user.id}>
                      {user.name}
                    </option>
                  ))}
                </select>
              </div>
              <div className="flex flex-col">
                <label htmlFor="rv-opened" className="text-xs font-medium text-ink/60">
                  Aberta por
                </label>
                <select id="rv-opened" value={draft.openedById} onChange={(event) => setDraft({ ...draft, openedById: event.target.value })} className={inputClass}>
                  <option value="">Todos</option>
                  {userOptions.map((user) => (
                    <option key={user.id} value={user.id}>
                      {user.name}
                    </option>
                  ))}
                </select>
              </div>
            </>
          )}
          <div className="flex flex-col">
            <label htmlFor="rv-city" className="text-xs font-medium text-ink/60">
              Cidade
            </label>
            <input id="rv-city" value={draft.city} onChange={(event) => setDraft({ ...draft, city: event.target.value })} className={`${inputClass} w-36`} />
          </div>
          <div className="flex flex-col">
            <label htmlFor="rv-state" className="text-xs font-medium text-ink/60">
              UF
            </label>
            <input id="rv-state" maxLength={2} value={draft.state} onChange={(event) => setDraft({ ...draft, state: event.target.value.toUpperCase() })} className={`${inputClass} w-14 uppercase`} />
          </div>
          <div className="flex flex-col">
            <label htmlFor="rv-from" className="text-xs font-medium text-ink/60">
              Criadas de
            </label>
            <input id="rv-from" type="date" value={draft.dateFrom} onChange={(event) => setDraft({ ...draft, dateFrom: event.target.value })} className={inputClass} />
          </div>
          <div className="flex flex-col">
            <label htmlFor="rv-to" className="text-xs font-medium text-ink/60">
              até
            </label>
            <input id="rv-to" type="date" value={draft.dateTo} onChange={(event) => setDraft({ ...draft, dateTo: event.target.value })} className={inputClass} />
          </div>
          <div className="flex flex-col">
            <label htmlFor="rv-duefrom" className="text-xs font-medium text-ink/60">
              Prazo de
            </label>
            <input id="rv-duefrom" type="date" value={draft.dueFrom} onChange={(event) => setDraft({ ...draft, dueFrom: event.target.value })} className={inputClass} />
          </div>
          <div className="flex flex-col">
            <label htmlFor="rv-dueto" className="text-xs font-medium text-ink/60">
              até
            </label>
            <input id="rv-dueto" type="date" value={draft.dueTo} onChange={(event) => setDraft({ ...draft, dueTo: event.target.value })} className={inputClass} />
          </div>
          <label className="flex items-center gap-1.5 text-xs">
            <input type="checkbox" checked={draft.overdue} onChange={(event) => setDraft({ ...draft, overdue: event.target.checked })} />
            Atrasadas
          </label>
          <label className="flex items-center gap-1.5 text-xs">
            <input type="checkbox" checked={draft.unassigned} onChange={(event) => setDraft({ ...draft, unassigned: event.target.checked })} />
            Sem responsável
          </label>
          <button type="button" onClick={applyFilters} className="rounded bg-petrol-800 px-4 py-2 text-sm font-semibold text-white">
            Aplicar
          </button>
          <button type="button" onClick={clearFilters} className="rounded border border-ink/20 px-4 py-2 text-sm text-ink/70">
            Limpar
          </button>
        </div>
      </section>

      {actionError && (
        <p role="alert" className="text-sm text-signal-blocked">
          {actionError}
        </p>
      )}

      {/* ── Tabela da fila ── */}
      <section className="rounded-lg border border-ink/10 bg-white p-4 shadow-sm">
        {listError ? (
          <div>
            <p role="alert" className="text-sm text-signal-blocked">
              {listError}
            </p>
            <button type="button" onClick={() => void loadList()} className="mt-1 text-xs font-medium text-petrol-800 hover:underline">
              Tentar novamente
            </button>
          </div>
        ) : rows === null ? (
          <p className="text-sm text-ink/60">Carregando fila…</p>
        ) : rows.length === 0 ? (
          <p className="text-sm text-ink/50">Nenhuma análise encontrada com os filtros atuais.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm">
              <thead>
                <tr className="border-b border-ink/10 text-xs uppercase tracking-wide text-ink/50">
                  <th className="py-2 pr-3">Protocolo</th>
                  <th className="py-2 pr-3">Abertura</th>
                  <th className="py-2 pr-3">Endereço</th>
                  <th className="py-2 pr-3">Resultado automático</th>
                  <th className="py-2 pr-3">Status da análise</th>
                  <th className="py-2 pr-3">Prioridade</th>
                  <th className="py-2 pr-3">Responsável</th>
                  <th className="py-2 pr-3">Prazo</th>
                  <th className="py-2 pr-3">SLA</th>
                  <th className="py-2">Ações</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((row) => (
                  <tr key={row.id} className="border-b border-ink/5 align-top">
                    <td className="py-2 pr-3 font-mono text-xs">{row.consultation.protocol}</td>
                    <td className="py-2 pr-3 text-xs text-ink/70">{formatDateTime(row.createdAt)}</td>
                    <td className="py-2 pr-3 text-xs">
                      {row.consultation.street}, {row.consultation.number} —{" "}
                      {row.consultation.city}/{row.consultation.state}
                    </td>
                    <td className="py-2 pr-3 text-xs">
                      {STATUS_LABELS[row.consultation.status] ?? row.consultation.status}
                    </td>
                    <td className="py-2 pr-3 text-xs font-medium">
                      {REVIEW_STATUS_LABELS[row.status]}
                    </td>
                    <td className="py-2 pr-3 text-xs">{REVIEW_PRIORITY_LABELS[row.priority]}</td>
                    <td className="py-2 pr-3 text-xs">
                      {row.assignedTo?.name ?? "Sem responsável"}
                    </td>
                    <td className="py-2 pr-3 text-xs">
                      {row.dueAt ? formatDateTime(row.dueAt) : "—"}
                    </td>
                    <td className="py-2 pr-3 text-xs">{slaText(row.sla)}</td>
                    <td className="py-2 text-xs">
                      <div className="flex flex-col gap-1">
                        <button type="button" onClick={() => setDetailId(row.id)} className="text-left font-medium text-petrol-800 hover:underline">
                          Ver detalhes
                        </button>
                        {canClaim && !row.assignedTo &&
                          ["OPEN", "IN_PROGRESS", "WAITING_INFORMATION"].includes(row.status) && (
                            <button type="button" onClick={() => void handleClaim(row.id, row.version)} className="text-left font-medium text-petrol-800 hover:underline">
                              Assumir
                            </button>
                          )}
                        {row.assignedTo?.id === currentUser.id && row.status !== "APPROVED" && row.status !== "REJECTED" && row.status !== "CANCELLED" && (
                          <button type="button" onClick={() => setDetailId(row.id)} className="text-left font-medium text-petrol-800 hover:underline">
                            Continuar análise
                          </button>
                        )}
                        {openConsultationHistory && (
                          <button type="button" onClick={() => openConsultationHistory(row.consultation.protocol)} className="text-left text-ink/60 hover:underline">
                            Abrir consulta histórica
                          </button>
                        )}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        {rows !== null && total > 20 && (
          <div className="mt-3 flex items-center justify-between text-xs">
            <button type="button" disabled={page <= 1} onClick={() => setPage(page - 1)} className="rounded border border-ink/20 px-3 py-1.5 disabled:opacity-40">
              Anterior
            </button>
            <span>
              Página {page} de {totalPages} · {total} análise(s)
            </span>
            <button type="button" disabled={page >= totalPages} onClick={() => setPage(page + 1)} className="rounded border border-ink/20 px-3 py-1.5 disabled:opacity-40">
              Próxima
            </button>
          </div>
        )}
      </section>

      {detailId && (
        <ReviewDetailsDialog
          reviewId={detailId}
          currentUser={currentUser}
          onClose={() => setDetailId(null)}
          onChanged={() => {
            void loadList();
            void loadSummary();
          }}
        />
      )}
    </div>
  );
}

/** Formulário compartilhado "Encaminhar para análise" (histórico e resultado). */
export function ReviewCreateDialog({
  consultationId,
  protocol,
  addressText,
  currentUser,
  onClose,
  onCreated,
  onOpenReview,
}: {
  consultationId: string;
  protocol: string;
  addressText: string;
  currentUser: SessionUser;
  onClose: () => void;
  onCreated?: (reviewId: string) => void;
  /** Abre o ReviewDetailsDialog da análise (criada agora ou já existente). */
  onOpenReview?: (reviewId: string) => void;
}) {
  const [priority, setPriority] = useState<ReviewPriority>("NORMAL");
  const [assignedToId, setAssignedToId] = useState("");
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [createdId, setCreatedId] = useState<string | null>(null);
  const [technicians, setTechnicians] = useState<ReviewAssigneeOption[]>([]);
  const [existingReviewId, setExistingReviewId] = useState<string | null>(null);
  const canAssign = currentUser.role === "ADMIN";

  useEffect(() => {
    if (!canAssign) return;
    getReviewAssignees({ limit: 100 })
      .then((data) => setTechnicians(data.users))
      .catch(() => setTechnicians([]));
  }, [canAssign]);

  async function submit() {
    if (busy) return; // impede envio duplo
    setBusy(true);
    setError(null);
    try {
      const data = await createReview({
        consultationId,
        priority,
        assignedToId: canAssign && assignedToId ? assignedToId : null,
        note: note.trim() || undefined,
      });
      setCreatedId(data.review.id);
      onCreated?.(data.review.id);
    } catch (err) {
      if (err instanceof ApiError && err.code === "REVIEW_ALREADY_EXISTS") {
        setError("Esta consulta já possui uma análise técnica.");
        // Não deixar o usuário preso na duplicidade: localizar a existente
        // e oferecer "Abrir análise".
        try {
          const existing = await getReviewByConsultation(consultationId);
          setExistingReviewId(existing.review.id);
        } catch {
          setExistingReviewId(null);
        }
      } else {
        setError(err instanceof ApiError ? err.message : "Falha ao criar a análise.");
      }
    } finally {
      setBusy(false);
    }
  }

  return (
    <div role="dialog" aria-label="Encaminhar para análise" className="fixed inset-0 z-40 flex items-center justify-center bg-ink/40 p-4">
      <div className="w-full max-w-md rounded-lg bg-white p-5 shadow-lg">
        <h4 className="text-sm font-semibold">Encaminhar para análise técnica</h4>
        <p className="mt-1 font-mono text-xs text-ink/70">{protocol}</p>
        <p className="text-xs text-ink/60">{addressText}</p>
        {createdId ? (
          <div className="mt-3">
            <p className="rounded bg-signal-viable/10 p-2 text-sm">Análise criada com sucesso.</p>
            <div className="mt-3 flex justify-end gap-2">
              <button type="button" onClick={onClose} className="rounded border border-ink/20 px-3 py-1.5 text-xs">
                Fechar
              </button>
              {onOpenReview && (
                <button type="button" onClick={() => onOpenReview(createdId)} className="rounded bg-petrol-800 px-3 py-1.5 text-xs font-semibold text-white">
                  Abrir análise
                </button>
              )}
            </div>
          </div>
        ) : (
          <>
            {error && (
              <p role="alert" className="mt-2 rounded bg-signal-blocked/10 p-2 text-sm text-signal-blocked">
                {error}
              </p>
            )}
            {existingReviewId && onOpenReview && (
              <button type="button" onClick={() => onOpenReview(existingReviewId)} className="mt-2 rounded bg-petrol-800 px-3 py-1.5 text-xs font-semibold text-white">
                Abrir análise
              </button>
            )}
            <label htmlFor="create-priority" className="mt-3 block text-xs font-medium text-ink/60">
              Prioridade
            </label>
            <select id="create-priority" value={priority} onChange={(event) => setPriority(event.target.value as ReviewPriority)} className="mt-1 w-full rounded border border-ink/20 px-3 py-2 text-sm">
              {Object.entries(REVIEW_PRIORITY_LABELS).map(([value, label]) => (
                <option key={value} value={value}>
                  {label}
                </option>
              ))}
            </select>
            {canAssign && (
              <>
                <label htmlFor="create-assignee" className="mt-3 block text-xs font-medium text-ink/60">
                  Técnico responsável (opcional)
                </label>
                <select id="create-assignee" value={assignedToId} onChange={(event) => setAssignedToId(event.target.value)} className="mt-1 w-full rounded border border-ink/20 px-3 py-2 text-sm">
                  <option value="">Sem responsável</option>
                  {technicians.map((user) => (
                    <option key={user.id} value={user.id}>
                      {user.name}
                    </option>
                  ))}
                </select>
              </>
            )}
            <label htmlFor="create-note" className="mt-3 block text-xs font-medium text-ink/60">
              Observação inicial (opcional)
            </label>
            <textarea id="create-note" value={note} onChange={(event) => setNote(event.target.value)} maxLength={3000} rows={2} className="mt-1 w-full rounded border border-ink/20 px-3 py-2 text-sm" />
            <div className="mt-4 flex justify-end gap-2">
              <button type="button" disabled={busy} onClick={onClose} className="rounded border border-ink/20 px-3 py-1.5 text-xs">
                Cancelar
              </button>
              <button type="button" disabled={busy} onClick={() => void submit()} className="rounded bg-petrol-800 px-3 py-1.5 text-xs font-semibold text-white disabled:opacity-50">
                Encaminhar
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
