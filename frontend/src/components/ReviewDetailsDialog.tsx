import { useEffect, useState } from "react";
import {
  addReviewNote,
  ApiError,
  assignReview,
  claimReview,
  getReview,
  getReviewAssignees,
  reopenReview,
  resolveReview,
  updateReview,
} from "../api";
import { SessionUser } from "../auth";
import { STATUS_LABELS, formatDateTime, NETWORK_LABELS } from "./ConsultationDetailsDialog";
import {
  ReviewAssigneeOption,
  ReviewPriority,
  ReviewStatus,
  ViabilityReviewDetails,
} from "../types";

export const REVIEW_STATUS_LABELS: Record<ReviewStatus, string> = {
  OPEN: "Em aberto",
  IN_PROGRESS: "Em análise",
  WAITING_INFORMATION: "Aguardando informações",
  APPROVED: "Aprovada",
  REJECTED: "Rejeitada",
  CANCELLED: "Cancelada",
};

export const REVIEW_PRIORITY_LABELS: Record<ReviewPriority, string> = {
  LOW: "Baixa",
  NORMAL: "Normal",
  HIGH: "Alta",
  URGENT: "Urgente",
};

export const RESOLUTION_CODES = [
  "COVERAGE_CONFIRMED",
  "TECHNICAL_RESTRICTION",
  "ADDRESS_NOT_FOUND",
  "CAPACITY_UNAVAILABLE",
  "MANUAL_APPROVAL",
  "OTHER",
];

const EVENT_LABELS: Record<string, string> = {
  CREATED: "Análise criada",
  ASSIGNED: "Responsável atribuído",
  UNASSIGNED: "Responsável removido",
  STATUS_CHANGED: "Status alterado",
  PRIORITY_CHANGED: "Prioridade alterada",
  DUE_DATE_CHANGED: "Prazo alterado",
  NOTE_ADDED: "Observação adicionada",
  RESOLVED: "Análise resolvida",
  REOPENED: "Análise reaberta",
};

export function slaText(sla: {
  overdue: boolean;
  remainingMinutes: number | null;
  resolvedWithinSla: boolean | null;
}): string {
  if (sla.resolvedWithinSla === true) return "Concluída dentro do prazo";
  if (sla.resolvedWithinSla === false) return "Concluída fora do prazo";
  if (sla.remainingMinutes === null) return "Sem prazo";
  if (sla.overdue) return "Atrasada";
  if (sla.remainingMinutes < 60) return `Vence em ${sla.remainingMinutes} min`;
  return `Vence em ${Math.floor(sla.remainingMinutes / 60)} h`;
}

interface Props {
  reviewId: string;
  currentUser: SessionUser;
  onClose: () => void;
  onChanged?: () => void;
}

/**
 * Detalhes da análise técnica: o RESULTADO AUTOMÁTICO da consulta (imutável)
 * é sempre exibido separado da DECISÃO operacional da análise. Todo texto é
 * renderizado e escapado pelo React — nunca por injeção direta de HTML.
 */
export default function ReviewDetailsDialog({ reviewId, currentUser, onClose, onChanged }: Props) {
  const [detail, setDetail] = useState<ViabilityReviewDetails | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [noteDraft, setNoteDraft] = useState("");
  const [resolveOpen, setResolveOpen] = useState<null | "APPROVED" | "REJECTED">(null);
  const [resolutionCode, setResolutionCode] = useState("COVERAGE_CONFIRMED");
  const [resolutionSummary, setResolutionSummary] = useState("");
  const [confirmAction, setConfirmAction] = useState<null | "CANCELLED" | "REOPEN">(null);
  const [assignSelect, setAssignSelect] = useState("");
  const [technicians, setTechnicians] = useState<ReviewAssigneeOption[]>([]);

  const role = currentUser.role;
  const isAdmin = role === "ADMIN";
  const isTechnician = role === "TECHNICIAN";
  const mine = detail?.assignedTo?.id === currentUser.id;
  const active =
    detail && ["OPEN", "IN_PROGRESS", "WAITING_INFORMATION"].includes(detail.status);
  const done = detail && ["APPROVED", "REJECTED", "CANCELLED"].includes(detail.status);

  const canClaim = Boolean(active && (isAdmin || isTechnician) && !detail?.assignedTo);
  const canAssign = Boolean(active && isAdmin);
  const canChangeStatus = Boolean(active && (isAdmin || (isTechnician && mine)));
  const canResolve = Boolean(
    detail?.status === "IN_PROGRESS" && (isAdmin || (isTechnician && mine))
  );
  const canReopen = Boolean(done && isAdmin);
  const canNote = role !== "VIEWER";

  async function load() {
    setError(null);
    try {
      const data = await getReview(reviewId);
      setDetail(data.review);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Falha ao carregar a análise.");
    }
  }

  useEffect(() => {
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [reviewId]);

  async function run(action: () => Promise<unknown>, successMessage: string) {
    if (!detail || busy) return;
    setBusy(true);
    setError(null);
    setInfo(null);
    try {
      await action();
      setInfo(successMessage);
      await load();
      onChanged?.();
    } catch (err) {
      if (err instanceof ApiError && err.code === "REVIEW_CONFLICT") {
        // Concorrência otimista: nunca sobrescrever — recarregar e avisar.
        await load();
        setError("A análise foi atualizada por outra pessoa. Os dados foram recarregados.");
      } else if (err instanceof ApiError && err.code === "REVIEW_NOT_ACTIVE") {
        await load();
        setError("Esta análise já foi encerrada. Os dados foram recarregados.");
      } else {
        setError(err instanceof ApiError ? err.message : "Falha ao executar a ação.");
      }
    } finally {
      setBusy(false);
    }
  }

  useEffect(() => {
    if (!canAssign) return;
    // Somente ADMIN e TECHNICIAN ativos podem ser responsáveis técnicos.
    getReviewAssignees({ limit: 100 })
      .then((data) => setTechnicians(data.users))
      .catch(() => setTechnicians([]));
  }, [canAssign]);

  if (!detail) {
    return (
      <div role="dialog" aria-label="Detalhes da análise técnica" className="fixed inset-0 z-40 flex items-center justify-center bg-ink/40 p-4">
        <div className="w-full max-w-lg rounded-lg bg-white p-6 shadow-lg">
          {error ? (
            <p role="alert" className="text-sm text-signal-blocked">{error}</p>
          ) : (
            <p className="text-sm text-ink/60">Carregando análise…</p>
          )}
          <button type="button" onClick={onClose} className="mt-3 text-xs font-medium text-petrol-800 hover:underline">
            Fechar
          </button>
        </div>
      </div>
    );
  }

  const version = detail.version;

  return (
    <div
      role="dialog"
      aria-label={`Detalhes da análise ${detail.consultation.protocol}`}
      className="fixed inset-0 z-40 flex items-start justify-center overflow-y-auto bg-ink/40 p-4"
      onKeyDown={(event) => {
        if (event.key === "Escape") onClose();
      }}
    >
      <div className="my-6 w-full max-w-3xl rounded-lg bg-white p-6 shadow-lg">
        <div className="flex items-start justify-between gap-3">
          <div>
            <h3 className="text-base font-semibold">Análise técnica</h3>
            <p className="font-mono text-sm text-ink/70">{detail.consultation.protocol}</p>
          </div>
          <button type="button" onClick={onClose} className="text-sm text-ink/50 hover:text-ink">
            Fechar ✕
          </button>
        </div>

        {error && (
          <p role="alert" className="mt-2 rounded bg-signal-blocked/10 p-2 text-sm text-signal-blocked">
            {error}
          </p>
        )}
        {info && <p className="mt-2 rounded bg-signal-viable/10 p-2 text-sm">{info}</p>}

        <dl className="mt-4 grid grid-cols-1 gap-x-6 gap-y-1.5 text-sm sm:grid-cols-2">
          <dt className="text-ink/60">Endereço</dt>
          <dd>
            {detail.consultation.street}, {detail.consultation.number} —{" "}
            {detail.consultation.city}/{detail.consultation.state}
          </dd>
          <dt className="text-ink/60">Resultado automático</dt>
          <dd className="font-medium">
            {STATUS_LABELS[detail.consultation.status] ?? detail.consultation.status}
          </dd>
          <dt className="text-ink/60">Decisão da análise</dt>
          <dd className="font-medium">
            {done && detail.status !== "CANCELLED"
              ? REVIEW_STATUS_LABELS[detail.status]
              : "Pendente"}
          </dd>
          <dt className="text-ink/60">Coberturas históricas</dt>
          <dd>
            {detail.consultation.coverage.matches.length === 0 ? (
              "Nenhuma correspondência"
            ) : (
              <ul className="space-y-1">
                {detail.consultation.coverage.matches.map((match, index) => (
                  <li key={index}>
                    <span className="font-medium">{match.partnerName ?? "Parceiro"}</span>
                    <br />
                    <span className="text-xs text-ink/70">
                      {match.layerName ?? "Camada"}
                      {match.version ? ` · versão ${match.version}` : ""}
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </dd>
          <dt className="text-ink/60">Referência de rede</dt>
          <dd>
            {NETWORK_LABELS[detail.consultation.network.status] ??
              detail.consultation.network.status}
            {detail.consultation.network.reference &&
              detail.consultation.network.reference.identifiers.map((identifier, index) => (
                <span key={index} className="block font-mono text-xs">
                  {identifier.code}
                  {index === 0 &&
                  typeof detail.consultation.network.reference?.distanceMeters === "number"
                    ? ` · ${Math.round(detail.consultation.network.reference.distanceMeters)} m`
                    : ""}
                </span>
              ))}
            {detail.consultation.network.alternatives.length > 0 && (
              <ul className="mt-1 space-y-0.5 text-xs text-ink/70">
                {detail.consultation.network.alternatives.map((alternative, index) => (
                  <li key={index} className="font-mono">
                    {alternative.identifiers[0]?.code ?? "Alternativa"}
                    {typeof alternative.distanceMeters === "number"
                      ? ` · ${Math.round(alternative.distanceMeters)} m`
                      : ""}
                  </li>
                ))}
              </ul>
            )}
          </dd>
          <dt className="text-ink/60">Status da análise</dt>
          <dd>{REVIEW_STATUS_LABELS[detail.status]}</dd>
          <dt className="text-ink/60">Prioridade</dt>
          <dd>{REVIEW_PRIORITY_LABELS[detail.priority]}</dd>
          <dt className="text-ink/60">Responsável</dt>
          <dd>{detail.assignedTo?.name ?? "Sem responsável"}</dd>
          <dt className="text-ink/60">Aberta por</dt>
          <dd>{detail.openedBy.name}</dd>
          <dt className="text-ink/60">Prazo</dt>
          <dd>
            {detail.dueAt ? formatDateTime(detail.dueAt) : "—"} · {slaText(detail.sla)}
          </dd>
          <dt className="text-ink/60">Início da análise</dt>
          <dd>{detail.startedAt ? formatDateTime(detail.startedAt) : "—"}</dd>
          <dt className="text-ink/60">Resolução</dt>
          <dd>{detail.resolvedAt ? formatDateTime(detail.resolvedAt) : "—"}</dd>
          {detail.resolutionCode && (
            <>
              <dt className="text-ink/60">Código da resolução</dt>
              <dd className="font-mono">{detail.resolutionCode}</dd>
              <dt className="text-ink/60">Resumo</dt>
              <dd>{detail.resolutionSummary}</dd>
            </>
          )}
        </dl>

        {/* ── Ações ── */}
        <div className="mt-4 flex flex-wrap gap-2">
          {canClaim && (
            <button type="button" disabled={busy} onClick={() => void run(() => claimReview(detail.id, { version }), "Análise assumida.")} className="rounded bg-petrol-800 px-3 py-1.5 text-xs font-semibold text-white disabled:opacity-50">
              Assumir análise
            </button>
          )}
          {canChangeStatus && detail.status !== "IN_PROGRESS" && (
            <button type="button" disabled={busy} onClick={() => void run(() => updateReview(detail.id, { status: "IN_PROGRESS", version }), "Análise iniciada.")} className="rounded bg-petrol-800 px-3 py-1.5 text-xs font-semibold text-white disabled:opacity-50">
              {detail.status === "WAITING_INFORMATION" ? "Retomar análise" : "Iniciar análise"}
            </button>
          )}
          {canChangeStatus && (detail.status === "OPEN" || detail.status === "IN_PROGRESS") && (
            <button type="button" disabled={busy} onClick={() => void run(() => updateReview(detail.id, { status: "WAITING_INFORMATION", version }), "Aguardando informações.")} className="rounded border border-ink/20 px-3 py-1.5 text-xs disabled:opacity-50">
              Aguardar informações
            </button>
          )}
          {canResolve && (
            <>
              <button type="button" disabled={busy} onClick={() => { setResolveOpen("APPROVED"); setResolutionCode("COVERAGE_CONFIRMED"); }} className="rounded bg-signal-viable px-3 py-1.5 text-xs font-semibold text-white disabled:opacity-50">
                Aprovar
              </button>
              <button type="button" disabled={busy} onClick={() => { setResolveOpen("REJECTED"); setResolutionCode("TECHNICAL_RESTRICTION"); }} className="rounded bg-signal-blocked px-3 py-1.5 text-xs font-semibold text-white disabled:opacity-50">
                Rejeitar
              </button>
            </>
          )}
          {canChangeStatus && active && (
            <button type="button" disabled={busy} onClick={() => setConfirmAction("CANCELLED")} className="rounded border border-signal-blocked/50 px-3 py-1.5 text-xs text-signal-blocked disabled:opacity-50">
              Cancelar análise
            </button>
          )}
          {canReopen && (
            <button type="button" disabled={busy} onClick={() => setConfirmAction("REOPEN")} className="rounded border border-ink/20 px-3 py-1.5 text-xs disabled:opacity-50">
              Reabrir
            </button>
          )}
          {canChangeStatus && (
            <select aria-label="Alterar prioridade" disabled={busy} value={detail.priority} onChange={(event) => {
                const nextPriority = event.target.value as ReviewPriority;
                if (nextPriority === detail.priority) return; // sem mudança: não envia PATCH
                void run(() => updateReview(detail.id, { priority: nextPriority, version }), "Prioridade alterada.");
              }} className="rounded border border-ink/20 px-2 py-1.5 text-xs">
              {Object.entries(REVIEW_PRIORITY_LABELS)
                .filter(([value]) => isAdmin || value !== "URGENT" || detail.priority === "URGENT")
                .map(([value, label]) => (
                  <option key={value} value={value}>
                    Prioridade: {label}
                  </option>
                ))}
            </select>
          )}
        </div>

        {/* ── Atribuição (ADMIN) ── */}
        {canAssign && (
          <div className="mt-3 flex flex-wrap items-center gap-2 text-xs">
            <label htmlFor="review-assign" className="text-ink/60">
              Atribuir técnico
            </label>
            <select id="review-assign" value={assignSelect} onChange={(event) => setAssignSelect(event.target.value)} className="rounded border border-ink/20 px-2 py-1.5">
              <option value="">Selecionar…</option>
              {technicians.map((user) => (
                <option key={user.id} value={user.id}>
                  {user.name}
                </option>
              ))}
            </select>
            <button type="button" disabled={busy || !assignSelect} onClick={() => void run(() => assignReview(detail.id, { assignedToId: assignSelect, version }), "Responsável atribuído.")} className="rounded bg-petrol-800 px-3 py-1.5 font-semibold text-white disabled:opacity-50">
              Atribuir
            </button>
            {detail.assignedTo && (
              <button type="button" disabled={busy} onClick={() => void run(() => assignReview(detail.id, { assignedToId: null, version }), "Responsável removido.")} className="rounded border border-ink/20 px-3 py-1.5 disabled:opacity-50">
                Remover responsável
              </button>
            )}
          </div>
        )}

        {/* ── Observação ── */}
        {canNote && (
          <div className="mt-4">
            <label htmlFor="review-note" className="text-xs font-medium text-ink/60">
              Nova observação
            </label>
            <div className="mt-1 flex gap-2">
              <textarea id="review-note" value={noteDraft} onChange={(event) => setNoteDraft(event.target.value)} maxLength={3000} rows={2} className="w-full rounded border border-ink/20 px-3 py-2 text-sm" />
              <button
                type="button"
                disabled={busy || !noteDraft.trim()}
                onClick={() =>
                  void run(async () => {
                    await addReviewNote(detail.id, { note: noteDraft.trim(), version });
                    setNoteDraft("");
                  }, "Observação adicionada.")
                }
                className="self-start rounded bg-petrol-800 px-3 py-2 text-xs font-semibold text-white disabled:opacity-50"
              >
                Adicionar
              </button>
            </div>
          </div>
        )}

        {/* ── Linha do tempo ── */}
        <h4 className="mt-5 text-sm font-semibold">Linha do tempo</h4>
        <ol className="mt-2 space-y-2 border-l border-ink/10 pl-4 text-sm">
          {detail.events.map((event) => (
            <li key={event.id}>
              <p className="text-xs text-ink/50">
                {formatDateTime(event.createdAt)} · {event.actor?.name ?? "Sistema"}
              </p>
              <p className="font-medium">{EVENT_LABELS[event.type] ?? event.type}</p>
              {event.fromStatus && event.toStatus && (
                <p className="text-xs text-ink/70">
                  {REVIEW_STATUS_LABELS[event.fromStatus]} → {REVIEW_STATUS_LABELS[event.toStatus]}
                </p>
              )}
              {event.note && <p className="text-xs text-ink/80">{event.note}</p>}
            </li>
          ))}
        </ol>

        {/* ── Modal de resolução ── */}
        {resolveOpen && (
          <div role="dialog" aria-label="Registrar resolução" className="fixed inset-0 z-50 flex items-center justify-center bg-ink/50 p-4">
            <div className="w-full max-w-md rounded-lg bg-white p-5 shadow-lg">
              <h4 className="text-sm font-semibold">
                {resolveOpen === "APPROVED" ? "Aprovar análise" : "Rejeitar análise"}
              </h4>
              <p className="mt-1 text-xs text-ink/60">
                O resultado automático da consulta não será alterado. A decisão será registrada
                separadamente e ficará na linha do tempo.
              </p>
              <label htmlFor="resolution-code" className="mt-3 block text-xs font-medium text-ink/60">
                Código da resolução
              </label>
              <select id="resolution-code" value={resolutionCode} onChange={(event) => setResolutionCode(event.target.value)} className="mt-1 w-full rounded border border-ink/20 px-3 py-2 text-sm">
                {RESOLUTION_CODES.map((code) => (
                  <option key={code} value={code}>
                    {code}
                  </option>
                ))}
              </select>
              <label htmlFor="resolution-summary" className="mt-3 block text-xs font-medium text-ink/60">
                Resumo da resolução (obrigatório)
              </label>
              <textarea id="resolution-summary" value={resolutionSummary} onChange={(event) => setResolutionSummary(event.target.value)} maxLength={2000} rows={3} className="mt-1 w-full rounded border border-ink/20 px-3 py-2 text-sm" />
              <div className="mt-4 flex justify-end gap-2">
                <button type="button" disabled={busy} onClick={() => setResolveOpen(null)} className="rounded border border-ink/20 px-3 py-1.5 text-xs">
                  Voltar
                </button>
                <button
                  type="button"
                  disabled={busy || !resolutionSummary.trim()}
                  onClick={() =>
                    void run(async () => {
                      await resolveReview(detail.id, {
                        decision: resolveOpen,
                        resolutionCode,
                        resolutionSummary: resolutionSummary.trim(),
                        version,
                      });
                      setResolveOpen(null);
                      setResolutionSummary("");
                    }, resolveOpen === "APPROVED" ? "Análise aprovada." : "Análise rejeitada.")
                  }
                  className="rounded bg-petrol-800 px-3 py-1.5 text-xs font-semibold text-white disabled:opacity-50"
                >
                  Confirmar
                </button>
              </div>
            </div>
          </div>
        )}

        {/* ── Confirmação de cancelar/reabrir ── */}
        {confirmAction && (
          <div role="dialog" aria-label="Confirmar ação" className="fixed inset-0 z-50 flex items-center justify-center bg-ink/50 p-4">
            <div className="w-full max-w-sm rounded-lg bg-white p-5 shadow-lg">
              <p className="text-sm">
                {confirmAction === "CANCELLED"
                  ? "Cancelar esta análise? A linha do tempo será preservada."
                  : "Reabrir esta análise? A resolução atual voltará a ficar pendente."}
              </p>
              <div className="mt-4 flex justify-end gap-2">
                <button type="button" onClick={() => setConfirmAction(null)} className="rounded border border-ink/20 px-3 py-1.5 text-xs">
                  Voltar
                </button>
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => {
                    const action = confirmAction;
                    setConfirmAction(null);
                    void run(
                      () =>
                        action === "CANCELLED"
                          ? updateReview(detail.id, { status: "CANCELLED", version })
                          : reopenReview(detail.id, { version }),
                      action === "CANCELLED" ? "Análise cancelada." : "Análise reaberta."
                    );
                  }}
                  className="rounded bg-petrol-800 px-3 py-1.5 text-xs font-semibold text-white disabled:opacity-50"
                >
                  Confirmar
                </button>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
