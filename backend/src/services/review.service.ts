import { Prisma, ReviewPriority, ReviewStatus, UserRole } from "../generated/prisma/client";
import { prisma } from "../db/prisma";
import { env } from "../config/env";
import { AppError } from "../utils/errors";
import { recordAudit, AuditAction } from "./audit.service";
import { nextCalendarDay, zonedMidnightUtc } from "../utils/timezone";

/**
 * Fila de analises tecnicas (v0.6.0). A decisao operacional
 * (APPROVED/REJECTED) e SEPARADA do resultado automatico da consulta: a
 * consulta historica permanece imutavel (protocolo, endereco, status,
 * coverageMatches, referencia Voalle e coordenadas nunca mudam).
 * Concorrencia otimista: toda mutacao exige a versao atual (409
 * REVIEW_CONFLICT quando desatualizada). Mutacao + evento da linha do tempo
 * ocorrem SEMPRE na mesma transacao; os eventos sao imutaveis.
 */

export interface ReviewActor {
  id: string;
  role: UserRole;
}

const ACTIVE_STATUSES: ReviewStatus[] = ["OPEN", "IN_PROGRESS", "WAITING_INFORMATION"];
const DONE_STATUSES: ReviewStatus[] = ["APPROVED", "REJECTED", "CANCELLED"];

/** Transicoes explicitas — qualquer outra e REVIEW_INVALID_STATUS_TRANSITION. */
const TRANSITIONS: Record<ReviewStatus, ReviewStatus[]> = {
  OPEN: ["IN_PROGRESS", "WAITING_INFORMATION", "CANCELLED"],
  IN_PROGRESS: ["WAITING_INFORMATION", "APPROVED", "REJECTED", "CANCELLED"],
  WAITING_INFORMATION: ["OPEN", "IN_PROGRESS", "CANCELLED"],
  APPROVED: ["OPEN"], // somente por reabertura autorizada (/reopen)
  REJECTED: ["OPEN"],
  CANCELLED: ["OPEN"],
};

export const RESOLUTION_CODE_PATTERN = /^[A-Z0-9_]{1,60}$/;

function notFound(): AppError {
  return new AppError("REVIEW_NOT_FOUND", "Análise não encontrada.", 404);
}

function accessDenied(): AppError {
  return new AppError("REVIEW_ACCESS_DENIED", "Você não tem permissão para esta ação.", 403);
}

function conflict(): AppError {
  return new AppError(
    "REVIEW_CONFLICT",
    "A análise foi atualizada por outra pessoa. Recarregue os dados.",
    409
  );
}

function notActive(): AppError {
  return new AppError(
    "REVIEW_NOT_ACTIVE",
    "Esta análise já foi encerrada e não aceita atribuição ou claim.",
    409
  );
}

function invalidTransition(from: ReviewStatus, to: ReviewStatus): AppError {
  return new AppError(
    "REVIEW_INVALID_STATUS_TRANSITION",
    `Transição de status não permitida (${from} → ${to}).`,
    400
  );
}

function nowUtc(): Date {
  return new Date();
}

/** Overdue e sempre CALCULADO (nunca persistido) para não ficar defasado. */
function computeSla(review: {
  dueAt: Date | null;
  status: ReviewStatus;
  resolvedAt: Date | null;
}): { overdue: boolean; remainingMinutes: number | null; resolvedWithinSla: boolean | null } {
  if (!review.dueAt) return { overdue: false, remainingMinutes: null, resolvedWithinSla: null };
  const due = review.dueAt.getTime();
  if (DONE_STATUSES.includes(review.status)) {
    const resolvedWithinSla = review.resolvedAt ? review.resolvedAt.getTime() <= due : null;
    return { overdue: resolvedWithinSla === false, remainingMinutes: null, resolvedWithinSla };
  }
  const diffMinutes = Math.floor((due - nowUtc().getTime()) / 60000);
  return {
    overdue: diffMinutes < 0,
    remainingMinutes: diffMinutes,
    resolvedWithinSla: null,
  };
}

/** Escopo de leitura: VIEWER enxerga apenas análises das PRÓPRIAS consultas. */
function scopeWhere(actor: ReviewActor): Prisma.ViabilityReviewWhereInput {
  if (actor.role === "VIEWER") {
    return { consultation: { userId: actor.id } };
  }
  return {};
}

async function findScopedReview(id: string, actor: ReviewActor) {
  const review = await prisma.viabilityReview.findFirst({
    where: { AND: [{ id }, scopeWhere(actor)] },
    include: { consultation: { select: { id: true, protocol: true, userId: true } } },
  });
  // Análise alheia responde igual a inexistente (anti-enumeração).
  if (!review) throw notFound();
  return review;
}

async function audit(
  action: AuditAction,
  actor: ReviewActor,
  metadata: Record<string, unknown>
): Promise<void> {
  await recordAudit({
    userId: actor.id,
    action,
    entity: "viability_review",
    metadata,
    ipAddress: null,
  });
}

// ── Criação ───────────────────────────────────────────────────

export async function createReview(
  input: {
    consultationId: string;
    priority?: ReviewPriority;
    assignedToId?: string | null;
    note?: string;
  },
  actor: ReviewActor
) {
  // Criação: ADMIN e OPERATOR (TECHNICIAN atua via claim; VIEWER nunca cria).
  if (actor.role !== "ADMIN" && actor.role !== "OPERATOR") throw accessDenied();

  const consultation = await prisma.viabilityConsultation.findUnique({
    where: { id: input.consultationId },
    select: { id: true, protocol: true, userId: true },
  });
  if (!consultation) {
    throw new AppError("REVIEW_NOT_FOUND", "Consulta não encontrada.", 404);
  }

  let assignedToId: string | null = null;
  if (input.assignedToId) {
    // Atribuir responsável na criação: apenas ADMIN.
    if (actor.role !== "ADMIN") throw accessDenied();
    assignedToId = await validateAssignee(input.assignedToId);
  }

  const priority: ReviewPriority = input.priority ?? "NORMAL";
  const createdAt = nowUtc();
  const dueAt = new Date(createdAt.getTime() + env.REVIEW_DEFAULT_SLA_HOURS * 3600 * 1000);
  const note = input.note?.trim() || null;

  try {
    const review = await prisma.$transaction(async (tx) => {
      const created = await tx.viabilityReview.create({
        data: {
          consultationId: consultation.id,
          status: "OPEN",
          priority,
          openedById: actor.id, // sempre o usuário AUTENTICADO
          assignedToId,
          dueAt,
        },
      });
      await tx.viabilityReviewEvent.create({
        data: { reviewId: created.id, actorId: actor.id, type: "CREATED", toStatus: "OPEN" },
      });
      if (assignedToId) {
        await tx.viabilityReviewEvent.create({
          data: {
            reviewId: created.id,
            actorId: actor.id,
            type: "ASSIGNED",
            metadata: { assignedToId },
          },
        });
      }
      if (note) {
        await tx.viabilityReviewEvent.create({
          data: { reviewId: created.id, actorId: actor.id, type: "NOTE_ADDED", note },
        });
      }
      return created;
    });
    await audit("REVIEW_CREATED", actor, {
      reviewId: review.id,
      consultationId: consultation.id,
      protocol: consultation.protocol,
      actorId: actor.id,
      assignedToId,
      priority,
    });
    if (assignedToId) {
      await audit("REVIEW_ASSIGNED", actor, {
        reviewId: review.id,
        consultationId: consultation.id,
        protocol: consultation.protocol,
        actorId: actor.id,
        assignedToId,
      });
    }
    return review;
  } catch (err) {
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2002") {
      throw new AppError(
        "REVIEW_ALREADY_EXISTS",
        "Esta consulta já possui uma análise técnica.",
        409
      );
    }
    throw err;
  }
}

/**
 * Criacao automatica (opcional, apos a consulta ser persistida). Falhas
 * NUNCA afetam a consulta historica: sao registradas internamente (sem
 * stack na resposta) e a criacao manual permanece possivel.
 */
export async function maybeAutoCreateReview(consultation: {
  id: string;
  protocol: string;
  status: string;
  userId: string | null;
}): Promise<void> {
  if (!env.REVIEW_AUTO_CREATE_ENABLED) return;
  if (!env.REVIEW_AUTO_CREATE_STATUSES.includes(consultation.status)) return;
  if (!consultation.userId) return;
  const createdAt = nowUtc();
  const dueAt = new Date(createdAt.getTime() + env.REVIEW_DEFAULT_SLA_HOURS * 3600 * 1000);
  await prisma.$transaction(async (tx) => {
    const existing = await tx.viabilityReview.findUnique({
      where: { consultationId: consultation.id },
      select: { id: true },
    });
    if (existing) return; // idempotente
    const review = await tx.viabilityReview.create({
      data: {
        consultationId: consultation.id,
        status: "OPEN",
        priority: "NORMAL",
        openedById: consultation.userId!,
        assignedToId: null,
        dueAt,
      },
    });
    await tx.viabilityReviewEvent.create({
      data: {
        reviewId: review.id,
        actorId: null,
        type: "CREATED",
        toStatus: "OPEN",
        metadata: { auto: true, reason: consultation.status },
      },
    });
  });
}

/**
 * Localiza a análise pelo consultationId (resumo enxuto: sem eventos, notas
 * ou campos internos). VIEWER só enxerga análises das próprias consultas;
 * consulta alheia responde como inexistente.
 */
export async function getReviewByConsultation(consultationId: string, actor: ReviewActor) {
  const review = await prisma.viabilityReview.findFirst({
    where: { AND: [{ consultationId }, scopeWhere(actor)] },
    select: {
      id: true,
      consultationId: true,
      status: true,
      priority: true,
      assignedTo: { select: { id: true, name: true } },
      dueAt: true,
      version: true,
    },
  });
  if (!review) throw notFound();
  return review;
}

/**
 * Opções de responsável técnico: SOMENTE usuários ativos com perfil ADMIN ou
 * TECHNICIAN (nunca OPERATOR/VIEWER). Leitura por ADMIN, TECHNICIAN e
 * OPERATOR; VIEWER proibido.
 */
export async function listReviewAssignees(
  filters: { search?: string; limit?: number },
  actor: ReviewActor
) {
  if (actor.role === "VIEWER") throw accessDenied();
  const limit = Math.min(Math.max(filters.limit ?? 100, 1), 100);
  const where: Prisma.UserWhereInput = {
    active: true,
    role: { in: ["ADMIN", "TECHNICIAN"] },
  };
  if (filters.search) {
    where.OR = [
      { name: { contains: filters.search, mode: "insensitive" } },
      { email: { contains: filters.search, mode: "insensitive" } },
    ];
  }
  const users = await prisma.user.findMany({
    where,
    select: { id: true, name: true, email: true, role: true },
    orderBy: { name: "asc" },
    take: limit,
  });
  return { users };
}

// ── Atribuição ────────────────────────────────────────────────

async function validateAssignee(userId: string): Promise<string> {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { id: true, active: true, role: true },
  });
  // Somente usuários ATIVOS com perfil técnico (ADMIN ou TECHNICIAN).
  if (!user || !user.active || (user.role !== "ADMIN" && user.role !== "TECHNICIAN")) {
    throw new AppError(
      "REVIEW_INVALID_ASSIGNEE",
      "O responsável deve ser um usuário ativo com perfil ADMIN ou TECHNICIAN.",
      400
    );
  }
  return user.id;
}

export async function assignReview(
  id: string,
  input: { assignedToId: string | null; version: number },
  actor: ReviewActor
) {
  // Atribuir/remover responsável arbitrário: apenas ADMIN.
  if (actor.role !== "ADMIN") throw accessDenied();
  const review = await findScopedReview(id, actor);
  // Análises encerradas não aceitam mudança de responsável.
  if (!ACTIVE_STATUSES.includes(review.status)) throw notActive();
  const assignedToId = input.assignedToId ? await validateAssignee(input.assignedToId) : null;

  const updated = await prisma.$transaction(async (tx) => {
    const result = await tx.viabilityReview.updateMany({
      where: { id, version: input.version },
      data: { assignedToId, version: { increment: 1 } },
    });
    if (result.count === 0) throw conflict();
    await tx.viabilityReviewEvent.create({
      data: {
        reviewId: id,
        actorId: actor.id,
        type: assignedToId ? "ASSIGNED" : "UNASSIGNED",
        metadata: assignedToId ? { assignedToId } : { previousAssignedToId: review.assignedToId },
      },
    });
    return tx.viabilityReview.findUniqueOrThrow({ where: { id } });
  });
  await audit(assignedToId ? "REVIEW_ASSIGNED" : "REVIEW_UNASSIGNED", actor, {
    reviewId: id,
    consultationId: review.consultationId,
    protocol: review.consultation.protocol,
    actorId: actor.id,
    assignedToId,
  });
  return updated;
}

export async function claimReview(
  id: string,
  input: { version: number },
  actor: ReviewActor
) {
  // Claim: TECHNICIAN e ADMIN, somente quando SEM responsável e ATIVA.
  if (actor.role !== "ADMIN" && actor.role !== "TECHNICIAN") throw accessDenied();
  const review = await findScopedReview(id, actor);

  const claimed = await prisma.$transaction(async (tx) => {
    // Operação ATÔMICA com concorrência otimista completa: o where decide a
    // corrida sob os quatro critérios (id, version, sem responsável, ativa).
    const result = await tx.viabilityReview.updateMany({
      where: {
        id,
        version: input.version,
        assignedToId: null,
        status: { in: ACTIVE_STATUSES },
      },
      data: { assignedToId: actor.id, version: { increment: 1 } },
    });
    if (result.count === 0) {
      // Diferencia o motivo sem expor detalhes internos de concorrência.
      const current = await tx.viabilityReview.findUniqueOrThrow({
        where: { id },
        select: { status: true, assignedToId: true, version: true },
      });
      if (!ACTIVE_STATUSES.includes(current.status)) throw notActive();
      if (current.assignedToId) {
        throw new AppError(
          "REVIEW_ALREADY_ASSIGNED",
          "Esta análise já possui um responsável.",
          409
        );
      }
      throw conflict();
    }
    await tx.viabilityReviewEvent.create({
      data: {
        reviewId: id,
        actorId: actor.id,
        type: "ASSIGNED",
        metadata: { assignedToId: actor.id, claimed: true },
      },
    });
    return tx.viabilityReview.findUniqueOrThrow({ where: { id } });
  });
  await audit("REVIEW_CLAIMED", actor, {
    reviewId: id,
    consultationId: review.consultationId,
    protocol: review.consultation.protocol,
    actorId: actor.id,
    assignedToId: actor.id,
  });
  return claimed;
}

// ── Atualização (status / prioridade / prazo) ─────────────────

export async function updateReview(
  id: string,
  input: {
    status?: ReviewStatus;
    priority?: ReviewPriority;
    dueAt?: string | null;
    version: number;
  },
  actor: ReviewActor
) {
  if (actor.role === "VIEWER" || actor.role === "OPERATOR") throw accessDenied();
  const review = await findScopedReview(id, actor);

  // TECHNICIAN só atualiza análises atribuídas a SI.
  if (actor.role === "TECHNICIAN" && review.assignedToId !== actor.id) throw accessDenied();

  if (input.status === undefined && input.priority === undefined && input.dueAt === undefined) {
    throw new AppError("REVIEW_INVALID_FILTER", "Nenhuma alteração foi informada.", 400);
  }

  const data: Prisma.ViabilityReviewUpdateManyMutationInput = { version: { increment: 1 } };
  const events: Array<Prisma.ViabilityReviewEventUncheckedCreateInput> = [];
  const audits: Array<{ action: AuditAction; metadata: Record<string, unknown> }> = [];
  const base = {
    reviewId: id,
    consultationId: review.consultationId,
    protocol: review.consultation.protocol,
    actorId: actor.id,
  };

  if (input.status && input.status !== review.status) {
    // APPROVED/REJECTED exigem o endpoint de resolução (com code + summary).
    if (input.status === "APPROVED" || input.status === "REJECTED") {
      throw new AppError(
        "REVIEW_RESOLUTION_REQUIRED",
        "Aprovação e rejeição exigem o registro da resolução.",
        400
      );
    }
    if (review.status === "APPROVED" || review.status === "REJECTED" || review.status === "CANCELLED") {
      // Sair de um estado concluído só por reabertura autorizada.
      throw invalidTransition(review.status, input.status);
    }
    if (!TRANSITIONS[review.status].includes(input.status)) {
      throw invalidTransition(review.status, input.status);
    }
    data.status = input.status;
    if (input.status === "IN_PROGRESS" && !review.startedAt) {
      data.startedAt = nowUtc(); // primeira vez em análise
    }
    if (input.status === "CANCELLED") {
      // Cancelamento encerra a análise: resolvedAt permite calcular o SLA
      // histórico (encerrada dentro/fora do prazo). A consulta segue intacta.
      data.resolvedAt = nowUtc();
    }
    events.push({
      reviewId: id,
      actorId: actor.id,
      type: "STATUS_CHANGED",
      fromStatus: review.status,
      toStatus: input.status,
    });
    audits.push({
      action: "REVIEW_STATUS_CHANGED",
      metadata: { ...base, fromStatus: review.status, toStatus: input.status },
    });
  }

  if (input.priority && input.priority !== review.priority) {
    // TECHNICIAN não eleva para URGENT (salvo se já for URGENT).
    if (actor.role === "TECHNICIAN" && input.priority === "URGENT" && review.priority !== "URGENT") {
      throw accessDenied();
    }
    data.priority = input.priority;
    events.push({
      reviewId: id,
      actorId: actor.id,
      type: "PRIORITY_CHANGED",
      metadata: { fromPriority: review.priority, toPriority: input.priority },
    });
    audits.push({
      action: "REVIEW_PRIORITY_CHANGED",
      metadata: { ...base, fromPriority: review.priority, toPriority: input.priority },
    });
  }

  if (input.dueAt !== undefined) {
    // Alterar prazo: apenas ADMIN.
    if (actor.role !== "ADMIN") throw accessDenied();
    const dueAt = input.dueAt === null ? null : new Date(input.dueAt);
    if (dueAt && Number.isNaN(dueAt.getTime())) {
      throw new AppError("REVIEW_INVALID_FILTER", "Prazo inválido.", 400);
    }
    // Prazo igual ao atual (ambos null ou o mesmo instante em ms) não é
    // mudança: nada de data.dueAt, evento, auditoria ou version++.
    const sameDueAt =
      (dueAt === null && review.dueAt === null) ||
      (dueAt !== null && review.dueAt !== null && dueAt.getTime() === review.dueAt.getTime());
    if (!sameDueAt) {
    data.dueAt = dueAt;
    events.push({
      reviewId: id,
      actorId: actor.id,
      type: "DUE_DATE_CHANGED",
      metadata: {
        fromDueAt: review.dueAt?.toISOString() ?? null,
        toDueAt: dueAt?.toISOString() ?? null,
      },
    });
    audits.push({ action: "REVIEW_DUE_DATE_CHANGED", metadata: base });
    }
  }

  if (events.length === 0) {
    // Todos os valores enviados são iguais aos atuais: nada é aplicado,
    // a versão não incrementa e nenhum evento/auditoria é criado.
    throw new AppError("REVIEW_INVALID_FILTER", "Nenhuma alteração foi informada.", 400);
  }

  const updated = await prisma.$transaction(async (tx) => {
    const result = await tx.viabilityReview.updateMany({
      where: { id, version: input.version },
      data,
    });
    if (result.count === 0) throw conflict();
    for (const event of events) {
      await tx.viabilityReviewEvent.create({ data: event });
    }
    return tx.viabilityReview.findUniqueOrThrow({ where: { id } });
  });
  for (const entry of audits) {
    await audit(entry.action, actor, entry.metadata);
  }
  return updated;
}

// ── Observações ───────────────────────────────────────────────

export async function addReviewNote(
  id: string,
  input: { note: string; version: number },
  actor: ReviewActor
) {
  if (actor.role === "VIEWER") throw accessDenied();
  const review = await findScopedReview(id, actor);
  const note = input.note.trim();
  if (!note) {
    throw new AppError("REVIEW_INVALID_FILTER", "A observação não pode ser vazia.", 400);
  }
  const updated = await prisma.$transaction(async (tx) => {
    const result = await tx.viabilityReview.updateMany({
      where: { id, version: input.version },
      data: { version: { increment: 1 } },
    });
    if (result.count === 0) throw conflict();
    await tx.viabilityReviewEvent.create({
      data: { reviewId: id, actorId: actor.id, type: "NOTE_ADDED", note },
    });
    return tx.viabilityReview.findUniqueOrThrow({ where: { id } });
  });
  // O TEXTO da observação fica só na linha do tempo — nunca na auditoria.
  await audit("REVIEW_NOTE_ADDED", actor, {
    reviewId: id,
    consultationId: review.consultationId,
    protocol: review.consultation.protocol,
    actorId: actor.id,
  });
  return updated;
}

// ── Resolução e reabertura ────────────────────────────────────

export async function resolveReview(
  id: string,
  input: {
    decision: "APPROVED" | "REJECTED";
    resolutionCode: string;
    resolutionSummary: string;
    version: number;
  },
  actor: ReviewActor
) {
  if (actor.role !== "ADMIN" && actor.role !== "TECHNICIAN") throw accessDenied();
  const review = await findScopedReview(id, actor);
  if (actor.role === "TECHNICIAN" && review.assignedToId !== actor.id) throw accessDenied();

  if (!TRANSITIONS[review.status].includes(input.decision)) {
    throw invalidTransition(review.status, input.decision);
  }
  if (!RESOLUTION_CODE_PATTERN.test(input.resolutionCode)) {
    throw new AppError(
      "REVIEW_RESOLUTION_REQUIRED",
      "Código de resolução inválido: use letras maiúsculas, números e underscore (máx. 60).",
      400
    );
  }
  const summary = input.resolutionSummary.trim();
  if (!summary) {
    throw new AppError("REVIEW_RESOLUTION_REQUIRED", "O resumo da resolução é obrigatório.", 400);
  }

  const updated = await prisma.$transaction(async (tx) => {
    const result = await tx.viabilityReview.updateMany({
      where: { id, version: input.version },
      data: {
        status: input.decision,
        resolutionCode: input.resolutionCode,
        resolutionSummary: summary,
        resolvedAt: nowUtc(),
        version: { increment: 1 },
      },
    });
    if (result.count === 0) throw conflict();
    await tx.viabilityReviewEvent.create({
      data: {
        reviewId: id,
        actorId: actor.id,
        type: "RESOLVED",
        fromStatus: review.status,
        toStatus: input.decision,
        metadata: { resolutionCode: input.resolutionCode },
      },
    });
    return tx.viabilityReview.findUniqueOrThrow({ where: { id } });
  });
  await audit("REVIEW_RESOLVED", actor, {
    reviewId: id,
    consultationId: review.consultationId,
    protocol: review.consultation.protocol,
    actorId: actor.id,
    fromStatus: review.status,
    toStatus: input.decision,
    resolutionCode: input.resolutionCode,
  });
  return updated;
}

export async function reopenReview(
  id: string,
  input: { version: number; note?: string },
  actor: ReviewActor
) {
  // Reabertura AUTORIZADA: apenas ADMIN.
  if (actor.role !== "ADMIN") throw accessDenied();
  const review = await findScopedReview(id, actor);
  if (!DONE_STATUSES.includes(review.status)) {
    throw invalidTransition(review.status, "OPEN");
  }
  const note = input.note?.trim() || null;
  const updated = await prisma.$transaction(async (tx) => {
    const result = await tx.viabilityReview.updateMany({
      where: { id, version: input.version },
      data: {
        status: "OPEN",
        // A resolução ATUAL é limpa; a antiga permanece preservada nos
        // eventos RESOLVED existentes e no metadata do REOPENED.
        resolvedAt: null,
        resolutionCode: null,
        resolutionSummary: null,
        version: { increment: 1 },
      },
    });
    if (result.count === 0) throw conflict();
    await tx.viabilityReviewEvent.create({
      data: {
        reviewId: id,
        actorId: actor.id,
        type: "REOPENED",
        fromStatus: review.status,
        toStatus: "OPEN",
        note,
        metadata: {
          previousResolutionCode: review.resolutionCode,
          previousResolutionSummary: review.resolutionSummary,
        },
      },
    });
    return tx.viabilityReview.findUniqueOrThrow({ where: { id } });
  });
  await audit("REVIEW_REOPENED", actor, {
    reviewId: id,
    consultationId: review.consultationId,
    protocol: review.consultation.protocol,
    actorId: actor.id,
    fromStatus: review.status,
    toStatus: "OPEN",
  });
  return updated;
}

// ── Listagem, resumo e detalhes ───────────────────────────────

export interface ReviewListFilters {
  search?: string;
  protocol?: string;
  status?: ReviewStatus;
  priority?: ReviewPriority;
  assignedToId?: string;
  openedById?: string;
  city?: string;
  state?: string;
  overdue?: boolean;
  unassigned?: boolean;
  dateFrom?: string;
  dateTo?: string;
  dueFrom?: string;
  dueTo?: string;
  page?: number;
  limit?: number;
  sortBy?: "createdAt" | "updatedAt" | "dueAt" | "priority" | "status";
  sortOrder?: "asc" | "desc";
}

function buildListWhere(
  filters: ReviewListFilters,
  actor: ReviewActor
): Prisma.ViabilityReviewWhereInput {
  const and: Prisma.ViabilityReviewWhereInput[] = [scopeWhere(actor)];
  if (filters.status) and.push({ status: filters.status });
  if (filters.priority) and.push({ priority: filters.priority });
  if (filters.assignedToId) and.push({ assignedToId: filters.assignedToId });
  if (filters.openedById) and.push({ openedById: filters.openedById });
  if (filters.city) {
    and.push({ consultation: { city: { contains: filters.city, mode: "insensitive" } } });
  }
  if (filters.state) and.push({ consultation: { state: filters.state.toUpperCase() } });
  if (filters.protocol) and.push({ consultation: { protocol: filters.protocol } });
  if (filters.unassigned) and.push({ assignedToId: null });
  if (filters.overdue) {
    and.push({ dueAt: { lt: nowUtc() }, status: { in: ACTIVE_STATUSES } });
  }
  // Datas de calendário (YYYY-MM-DD) interpretadas em CONSULTATION_TIME_ZONE:
  // From = meia-noite do dia no fuso; To = meia-noite do dia SEGUINTE
  // (limite exclusivo), sem offsets fixos.
  const timeZone = env.CONSULTATION_TIME_ZONE;
  if (filters.dateFrom) {
    and.push({ createdAt: { gte: zonedMidnightUtc(filters.dateFrom, timeZone) } });
  }
  if (filters.dateTo) {
    and.push({ createdAt: { lt: zonedMidnightUtc(nextCalendarDay(filters.dateTo), timeZone) } });
  }
  if (filters.dueFrom) {
    and.push({ dueAt: { gte: zonedMidnightUtc(filters.dueFrom, timeZone) } });
  }
  if (filters.dueTo) {
    and.push({ dueAt: { lt: zonedMidnightUtc(nextCalendarDay(filters.dueTo), timeZone) } });
  }
  if (filters.search) {
    const term = filters.search.trim();
    and.push({
      OR: [
        { consultation: { protocol: { contains: term, mode: "insensitive" } } },
        { consultation: { street: { contains: term, mode: "insensitive" } } },
        { consultation: { neighborhood: { contains: term, mode: "insensitive" } } },
        { consultation: { city: { contains: term, mode: "insensitive" } } },
        { assignedTo: { name: { contains: term, mode: "insensitive" } } },
        { openedBy: { name: { contains: term, mode: "insensitive" } } },
        { resolutionCode: { contains: term.toUpperCase() } },
      ],
    });
  }
  return { AND: and };
}

const LIST_SELECT = {
  id: true,
  status: true,
  priority: true,
  dueAt: true,
  startedAt: true,
  resolvedAt: true,
  resolutionCode: true,
  version: true,
  createdAt: true,
  updatedAt: true,
  openedBy: { select: { id: true, name: true } },
  assignedTo: { select: { id: true, name: true } },
  consultation: {
    select: {
      id: true,
      protocol: true,
      status: true,
      street: true,
      number: true,
      neighborhood: true,
      city: true,
      state: true,
    },
  },
} satisfies Prisma.ViabilityReviewSelect;

function toListItem(review: Prisma.ViabilityReviewGetPayload<{ select: typeof LIST_SELECT }>) {
  return { ...review, sla: computeSla(review) };
}

export async function listReviews(filters: ReviewListFilters, actor: ReviewActor) {
  const limit = Math.min(Math.max(filters.limit ?? 20, 1), 100);
  const page = Math.max(filters.page ?? 1, 1);
  const where = buildListWhere(filters, actor);
  const sortBy = filters.sortBy ?? "createdAt";
  const sortOrder = filters.sortOrder ?? "desc";
  const [rows, total] = await Promise.all([
    prisma.viabilityReview.findMany({
      where,
      select: LIST_SELECT,
      orderBy: { [sortBy]: sortOrder },
      skip: (page - 1) * limit,
      take: limit,
    }),
    prisma.viabilityReview.count({ where }),
  ]);
  return { reviews: rows.map(toListItem), total, page, limit };
}

export async function reviewsSummary(actor: ReviewActor) {
  const where = scopeWhere(actor);
  const now = nowUtc();
  const [byStatus, byPriority, overdue, unassigned, assignedToMe] = await Promise.all([
    prisma.viabilityReview.groupBy({ by: ["status"], where, _count: { _all: true } }),
    prisma.viabilityReview.groupBy({ by: ["priority"], where, _count: { _all: true } }),
    prisma.viabilityReview.count({
      where: { AND: [where, { dueAt: { lt: now }, status: { in: ACTIVE_STATUSES } }] },
    }),
    prisma.viabilityReview.count({
      where: { AND: [where, { assignedToId: null, status: { in: ACTIVE_STATUSES } }] },
    }),
    prisma.viabilityReview.count({
      where: { AND: [where, { assignedToId: actor.id, status: { in: ACTIVE_STATUSES } }] },
    }),
  ]);
  const statusOf = (status: ReviewStatus) =>
    byStatus.find((group) => group.status === status)?._count._all ?? 0;
  const priorityOf = (priority: ReviewPriority) =>
    byPriority.find((group) => group.priority === priority)?._count._all ?? 0;
  return {
    total: byStatus.reduce((sum, group) => sum + group._count._all, 0),
    open: statusOf("OPEN"),
    inProgress: statusOf("IN_PROGRESS"),
    waitingInformation: statusOf("WAITING_INFORMATION"),
    approved: statusOf("APPROVED"),
    rejected: statusOf("REJECTED"),
    cancelled: statusOf("CANCELLED"),
    overdue,
    unassigned,
    assignedToMe,
    byPriority: {
      low: priorityOf("LOW"),
      normal: priorityOf("NORMAL"),
      high: priorityOf("HIGH"),
      urgent: priorityOf("URGENT"),
    },
  };
}

export async function getReviewDetails(id: string, actor: ReviewActor) {
  const review = await prisma.viabilityReview.findFirst({
    where: { AND: [{ id }, scopeWhere(actor)] },
    include: {
      openedBy: { select: { id: true, name: true, email: true } },
      assignedTo: { select: { id: true, name: true, email: true } },
      consultation: {
        select: {
          id: true,
          protocol: true,
          status: true,
          resultMessage: true,
          street: true,
          number: true,
          neighborhood: true,
          city: true,
          state: true,
          coverageMatches: true,
          coverageMatchCount: true,
          networkReferenceStatus: true,
          networkReference: true,
          networkAlternatives: true,
          createdAt: true,
          userId: true,
        },
      },
      events: {
        orderBy: { createdAt: "asc" },
        select: {
          id: true,
          type: true,
          fromStatus: true,
          toStatus: true,
          note: true,
          metadata: true,
          createdAt: true,
          actor: { select: { id: true, name: true } },
        },
      },
    },
  });
  if (!review) throw notFound();
  const { consultation, ...rest } = review;
  // Os snapshots persistidos JÁ são sanitizados na escrita (títulos privados,
  // SPLITTER/ROTA/COLETOR, host do Voalle, storedFileName e resposta bruta do
  // Google nunca chegam ao banco da consulta); aqui apenas selecionamos os
  // campos públicos e omitimos IDs técnicos e coordenadas desnecessárias.
  const matches = (consultation.coverageMatches as Array<Record<string, unknown>> | null) ?? [];
  const toPublicReference = (value: unknown) => {
    if (!value || typeof value !== "object") return null;
    const location = value as Record<string, unknown>;
    return {
      distanceMeters:
        typeof location.distanceMeters === "number" ? location.distanceMeters : null,
      identificationStatus: (location.identificationStatus as string) ?? null,
      identifiers: Array.isArray(location.identifiers)
        ? (location.identifiers as Array<Record<string, unknown>>).map((identifier) => ({
            id: (identifier.id as string) ?? null,
            code: (identifier.code as string) ?? null,
          }))
        : [],
    };
  };
  return {
    ...rest,
    sla: computeSla(review),
    consultation: {
      id: consultation.id,
      protocol: consultation.protocol,
      status: consultation.status,
      resultMessage: consultation.resultMessage,
      street: consultation.street,
      number: consultation.number,
      neighborhood: consultation.neighborhood,
      city: consultation.city,
      state: consultation.state,
      createdAt: consultation.createdAt,
      coverageMatchCount: consultation.coverageMatchCount,
      networkReferenceStatus: consultation.networkReferenceStatus,
      coverage: {
        matches: matches.map((match) => ({
          partnerName: (match.partnerName as string) ?? null,
          partnerCode: (match.partnerCode as string) ?? null,
          layerName: (match.layerName as string) ?? null,
          version: (match.version as string) ?? null,
        })),
        matchCount: consultation.coverageMatchCount,
      },
      network: {
        status: consultation.networkReferenceStatus,
        reference: toPublicReference(consultation.networkReference),
        alternatives: Array.isArray(consultation.networkAlternatives)
          ? (consultation.networkAlternatives as unknown[])
              .map(toPublicReference)
              .filter((item): item is NonNullable<typeof item> => item !== null)
          : [],
      },
    },
  };
}
