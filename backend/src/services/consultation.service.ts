import { Prisma } from "../generated/prisma/client";
import { prisma } from "../db/prisma";
import { env } from "../config/env";
import { AppError } from "../utils/errors";
import { generateProtocol } from "../utils/protocol";
import { nextCalendarDay, zonedMidnightUtc } from "../utils/timezone";
import { logger } from "../utils/logger";
import { recordAudit } from "./audit.service";
import { coverageSnapshotStore } from "../stores/coverage-snapshot.store";
import {
  AddressViabilityResponse,
  PublicNetworkLocation,
} from "../types/viability.types";
import type { OriginalGeocodingSnapshot } from "./location-confirmation.service";
import type { UserRole } from "../generated/prisma/client";

/**
 * Historico IMUTAVEL das consultas de viabilidade (v0.4.0).
 * - cada consulta finalizada recebe um protocolo unico VIA-AAAAMMDD-XXXXXXXX;
 * - o registro e um SNAPSHOT do resultado apresentado (nomes de parceiro e
 *   camada preservados mesmo apos renomear/inativar/excluir camadas);
 * - nao existem endpoints de edicao ou exclusao: mudancas futuras nas
 *   camadas nunca alteram consultas antigas.
 */

export interface ConsultationRef {
  id: string;
  protocol: string;
  createdAt: Date;
}

interface PersistInput {
  result: AddressViabilityResponse;
  userId: string;
  source: "ADDRESS_CHECK" | "LOCATION_CONFIRMED";
  startedAt: number;
  requestId: string | null;
  ipAddress: string | null;
  /** Snapshot ORIGINAL da geocodificacao (do token) na confirmacao manual. */
  originalGeocoding?: OriginalGeocodingSnapshot | null;
}

/** Snapshot publico da referencia Voalle (ja filtrada pelo mapper publico). */
function publicNetworkReference(location: PublicNetworkLocation | null): Prisma.InputJsonValue | undefined {
  if (!location) return undefined;
  return {
    latitude: location.latitude,
    longitude: location.longitude,
    distanceMeters: location.distanceMeters,
    identificationStatus: location.identificationStatus,
    identifiers: location.identifiers.map((identifier) => ({
      id: identifier.id,
      code: identifier.code,
    })),
  };
}

/**
 * Persiste a consulta ANTES da resposta ser enviada. Uma requisicao gera no
 * maximo UM registro: apenas a colisao de protocolo (unique) e retentada,
 * com um novo sufixo, sem duplicar dados.
 */
export async function persistConsultation(input: PersistInput): Promise<ConsultationRef> {
  const { result } = input;
  const snapshotStatus = coverageSnapshotStore.getStatus();
  const searched = result.searchedAddress;

  // Snapshot da cobertura com partnerCode (dados publicos apenas).
  const layersById = new Map(
    coverageSnapshotStore.getLayers().map((layer) => [layer.layerId, layer])
  );
  const coverageMatches = result.coverageMatches.map((match) => ({
    partnerId: match.partnerId,
    partnerName: match.partnerName,
    partnerCode: layersById.get(match.layerId)?.partnerCode ?? null,
    layerId: match.layerId,
    layerName: match.layerName,
    version: match.version,
  }));

  const completedAt = new Date();
  const durationMs = Math.max(0, Date.now() - input.startedAt);

  const data = {
    userId: input.userId,
    status: result.status,
    resultMessage: result.message,
    completedAt,
    durationMs,
    postalCode: searched.input.postalCode,
    street: searched.input.street,
    number: searched.input.number,
    complement: searched.input.complement,
    neighborhood: searched.input.neighborhood,
    city: searched.input.city,
    state: searched.input.state,
    // Ajuste manual: os dados ORIGINAIS da geocodificacao vem do token de
    // confirmacao validado (nunca de campos soltos do frontend).
    geocodingProvider: input.originalGeocoding?.provider ?? env.GEOCODING_PROVIDER,
    geocodedAddress:
      input.originalGeocoding?.formattedAddress ?? result.geocoding?.formattedAddress ?? null,
    geocodingConfidence:
      input.originalGeocoding?.confidence ?? result.geocoding?.confidence ?? null,
    geocodingLocationType:
      input.originalGeocoding?.locationType ?? result.geocoding?.locationType ?? null,
    geocodingPartialMatch:
      input.originalGeocoding?.partialMatch ?? result.geocoding?.partialMatch ?? false,
    geocodedLatitude: searched.manuallyAdjusted
      ? (input.originalGeocoding?.latitude ?? null)
      : searched.latitude,
    geocodedLongitude: searched.manuallyAdjusted
      ? (input.originalGeocoding?.longitude ?? null)
      : searched.longitude,
    confirmedLatitude: searched.manuallyAdjusted ? searched.latitude : null,
    confirmedLongitude: searched.manuallyAdjusted ? searched.longitude : null,
    locationConfirmedManually: searched.manuallyAdjusted,
    confirmationRequired: result.status === "ADDRESS_AMBIGUOUS",
    coverageMatches: coverageMatches as unknown as Prisma.InputJsonValue,
    coverageMatchCount: coverageMatches.length,
    coverageConfigured: snapshotStatus.configured,
    coverageSnapshotBuiltAt: snapshotStatus.builtAt ? new Date(snapshotStatus.builtAt) : null,
    networkReferenceStatus: result.networkReferenceStatus,
    networkReference: publicNetworkReference(result.nearestNetworkLocation),
    networkAlternatives: result.alternatives.map(
      (alternative) => publicNetworkReference(alternative)!
    ) as unknown as Prisma.InputJsonValue,
    networkSearchRadiusMeters: env.NETWORK_REFERENCE_SEARCH_RADIUS_METERS,
    requestId: input.requestId,
    source: input.source,
    errorCode: null,
  };

  const MAX_PROTOCOL_ATTEMPTS = 5;
  let lastError: unknown = null;
  for (let attempt = 0; attempt < MAX_PROTOCOL_ATTEMPTS; attempt += 1) {
    const protocol = generateProtocol();
    try {
      // Consulta + projecoes relacionais dos matches na MESMA transacao:
      // uma falha nao deixa a consulta parcialmente persistida.
      const created = await prisma.$transaction(async (tx) => {
        const consultation = await tx.viabilityConsultation.create({
          data: { ...data, protocol },
          select: { id: true, protocol: true, createdAt: true },
        });
        if (coverageMatches.length > 0) {
          await tx.viabilityConsultationCoverageMatch.createMany({
            data: coverageMatches.map((match) => ({
              consultationId: consultation.id,
              partnerIdSnapshot: match.partnerId,
              partnerNameSnapshot: match.partnerName,
              partnerCodeSnapshot: match.partnerCode,
              layerIdSnapshot: match.layerId,
              layerNameSnapshot: match.layerName,
              versionSnapshot: match.version,
              createdAt: consultation.createdAt,
            })),
          });
        }
        return consultation;
      });
      await recordAudit({
        userId: input.userId,
        action: "VIABILITY_CONSULTATION_CREATED",
        entity: "viability_consultation",
        entityId: created.id,
        metadata: {
          protocol: created.protocol,
          status: result.status,
          coverageMatchCount: coverageMatches.length,
          networkReferenceStatus: result.networkReferenceStatus,
        },
        ipAddress: input.ipAddress,
      });
      return created;
    } catch (err) {
      lastError = err;
      // Colisao do unique de protocolo: tenta novamente com novo sufixo.
      const isUniqueViolation =
        err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2002";
      if (!isUniqueViolation) break;
    }
  }
  logger.error("Falha ao salvar o histórico da consulta", {
    message: lastError instanceof Error ? lastError.message : "erro desconhecido",
  });
  throw new AppError(
    "CONSULTATION_HISTORY_SAVE_FAILED",
    "A consulta foi analisada, mas o histórico não pôde ser salvo. Tente novamente.",
    500
  );
}

// ── Listagem, detalhes e permissões ───────────────────────────

export interface ConsultationListFilters {
  search?: string;
  protocol?: string;
  status?: string;
  userId?: string;
  postalCode?: string;
  city?: string;
  state?: string;
  dateFrom?: string;
  dateTo?: string;
  hasCoverage?: boolean;
  networkReferenceStatus?: string;
  page: number;
  limit: number;
  sortOrder: "asc" | "desc";
}

interface Viewer {
  id: string;
  role: UserRole;
}

/** VIEWER enxerga somente as próprias consultas; demais perfis, todas. */
function scopeForViewer(viewer: Viewer): Prisma.ViabilityConsultationWhereInput {
  return viewer.role === "VIEWER" ? { userId: viewer.id } : {};
}

function parseDateRange(filters: {
  dateFrom?: string;
  dateTo?: string;
}): { gte?: Date; lt?: Date } | null {
  // dateFrom/dateTo representam DIAS no fuso configurado
  // (CONSULTATION_TIME_ZONE, padrao America/Sao_Paulo). Os limites sao
  // convertidos para UTC somente aqui, antes da consulta Prisma:
  //   dateFrom=D => >= D 00:00 no fuso; dateTo=D => < (D+1) 00:00 no fuso
  // (limite exclusivo, sem offset fixo -03:00 — o Intl resolve DST).
  const timeZone = env.CONSULTATION_TIME_ZONE;
  const range: { gte?: Date; lt?: Date } = {};
  if (filters.dateFrom) {
    try {
      range.gte = zonedMidnightUtc(filters.dateFrom, timeZone);
    } catch {
      throw new AppError("CONSULTATION_INVALID_FILTER", "Data inicial inválida.", 400);
    }
  }
  if (filters.dateTo) {
    try {
      range.lt = zonedMidnightUtc(nextCalendarDay(filters.dateTo), timeZone);
    } catch {
      throw new AppError("CONSULTATION_INVALID_FILTER", "Data final inválida.", 400);
    }
  }
  if (range.gte && range.lt && range.gte >= range.lt) {
    throw new AppError(
      "CONSULTATION_INVALID_DATE_RANGE",
      "A data inicial deve ser anterior ou igual à data final.",
      400
    );
  }
  return range.gte || range.lt ? range : null;
}

export function buildConsultationWhere(
  filters: Omit<ConsultationListFilters, "page" | "limit" | "sortOrder">,
  viewer: Viewer
): Prisma.ViabilityConsultationWhereInput {
  const dateRange = parseDateRange(filters);
  return {
    AND: [
      scopeForViewer(viewer),
      filters.protocol ? { protocol: filters.protocol.toUpperCase() } : {},
      filters.status ? { status: filters.status } : {},
      filters.userId ? { userId: filters.userId } : {},
      filters.postalCode ? { postalCode: filters.postalCode.replace(/\D/g, "") } : {},
      filters.city ? { city: { contains: filters.city, mode: "insensitive" } } : {},
      filters.state ? { state: filters.state.toUpperCase() } : {},
      filters.networkReferenceStatus
        ? { networkReferenceStatus: filters.networkReferenceStatus }
        : {},
      filters.hasCoverage === undefined
        ? {}
        : filters.hasCoverage
          ? { coverageMatchCount: { gt: 0 } }
          : { coverageMatchCount: 0 },
      dateRange ? { createdAt: dateRange } : {},
      filters.search
        ? {
            OR: [
              { protocol: { contains: filters.search.toUpperCase() } },
              { postalCode: { contains: filters.search.replace(/\D/g, "") || filters.search } },
              { street: { contains: filters.search, mode: "insensitive" } },
              { number: { contains: filters.search } },
              { neighborhood: { contains: filters.search, mode: "insensitive" } },
              { city: { contains: filters.search, mode: "insensitive" } },
              { user: { is: { name: { contains: filters.search, mode: "insensitive" } } } },
            ],
          }
        : {},
    ],
  };
}

/** Resumo da listagem: sem os JSONs detalhados (select explícito). */
const SUMMARY_SELECT = {
  id: true,
  protocol: true,
  status: true,
  postalCode: true,
  street: true,
  number: true,
  neighborhood: true,
  city: true,
  state: true,
  coverageMatchCount: true,
  networkReferenceStatus: true,
  createdAt: true,
  durationMs: true,
  user: { select: { id: true, name: true } },
} satisfies Prisma.ViabilityConsultationSelect;

export async function listConsultations(filters: ConsultationListFilters, viewer: Viewer) {
  const where = buildConsultationWhere(filters, viewer);
  const [total, rows] = await Promise.all([
    prisma.viabilityConsultation.count({ where }),
    prisma.viabilityConsultation.findMany({
      where,
      select: SUMMARY_SELECT,
      orderBy: { createdAt: filters.sortOrder },
      skip: (filters.page - 1) * filters.limit,
      take: filters.limit,
    }),
  ]);
  return {
    consultations: rows.map((row) => ({
      id: row.id,
      protocol: row.protocol,
      status: row.status,
      address: {
        postalCode: row.postalCode,
        street: row.street,
        number: row.number,
        neighborhood: row.neighborhood,
        city: row.city,
        state: row.state,
      },
      user: row.user,
      coverageMatchCount: row.coverageMatchCount,
      networkReferenceStatus: row.networkReferenceStatus,
      createdAt: row.createdAt,
      durationMs: row.durationMs,
    })),
    total,
    page: filters.page,
    limit: filters.limit,
  };
}

function toDetail(row: NonNullable<Awaited<ReturnType<typeof findDetail>>>) {
  return {
    id: row.id,
    protocol: row.protocol,
    status: row.status,
    resultMessage: row.resultMessage,
    createdAt: row.createdAt,
    completedAt: row.completedAt,
    durationMs: row.durationMs,
    user: row.user,
    address: {
      postalCode: row.postalCode,
      street: row.street,
      number: row.number,
      complement: row.complement,
      neighborhood: row.neighborhood,
      city: row.city,
      state: row.state,
    },
    geocoding: {
      provider: row.geocodingProvider,
      geocodedAddress: row.geocodedAddress,
      confidence: row.geocodingConfidence,
      locationType: row.geocodingLocationType,
      partialMatch: row.geocodingPartialMatch,
      latitude: row.geocodedLatitude,
      longitude: row.geocodedLongitude,
    },
    confirmation: {
      latitude: row.confirmedLatitude,
      longitude: row.confirmedLongitude,
      confirmedManually: row.locationConfirmedManually,
      confirmationRequired: row.confirmationRequired,
    },
    coverage: {
      matches: row.coverageMatches,
      matchCount: row.coverageMatchCount,
      configured: row.coverageConfigured,
      snapshotBuiltAt: row.coverageSnapshotBuiltAt,
    },
    network: {
      status: row.networkReferenceStatus,
      reference: row.networkReference,
      alternatives: row.networkAlternatives,
      searchRadiusMeters: row.networkSearchRadiusMeters,
    },
    source: row.source,
  };
}

function findDetail(where: Prisma.ViabilityConsultationWhereUniqueInput) {
  return prisma.viabilityConsultation.findUnique({
    where,
    include: { user: { select: { id: true, name: true, email: true } } },
  });
}

/**
 * Detalhe por id ou protocolo. Para VIEWER, consulta de outro usuario
 * responde como INEXISTENTE (mesma resposta segura de um id desconhecido),
 * impedindo enumeracao por tentativa de UUID/protocolo.
 */
export async function getConsultation(
  key: { id: string } | { protocol: string },
  viewer: Viewer
) {
  const row = await findDetail(
    "id" in key ? { id: key.id } : { protocol: key.protocol.toUpperCase() }
  );
  if (!row || (viewer.role === "VIEWER" && row.userId !== viewer.id)) {
    throw new AppError("CONSULTATION_NOT_FOUND", "Consulta não encontrada.", 404);
  }
  return toDetail(row);
}

// ── Exportação CSV (somente ADMIN) ────────────────────────────

/** Protege contra CSV/formula injection: prefixa células perigosas com '. */
export function csvCell(value: unknown): string {
  let text = value === null || value === undefined ? "" : String(value);
  if (/^[=+\-@\t\r]/.test(text)) text = `'${text}`;
  if (/[";\n\r]/.test(text)) text = `"${text.replace(/"/g, '""')}"`;
  return text;
}

interface CoverageMatchSnapshot {
  partnerName?: string;
  layerName?: string;
  version?: string | null;
}

export async function exportConsultationsCsv(
  filters: Omit<ConsultationListFilters, "page" | "limit">,
  viewer: Viewer
): Promise<{ csv: string; rowCount: number }> {
  const where = buildConsultationWhere(filters, viewer);
  const total = await prisma.viabilityConsultation.count({ where });
  if (total > env.CONSULTATION_EXPORT_MAX_ROWS) {
    throw new AppError(
      "CONSULTATION_EXPORT_LIMIT_EXCEEDED",
      `A exportação está limitada a ${env.CONSULTATION_EXPORT_MAX_ROWS} registros; refine os filtros.`,
      400
    );
  }

  const rows = await prisma.viabilityConsultation.findMany({
    where,
    include: { user: { select: { name: true, email: true } } },
    orderBy: { createdAt: filters.sortOrder },
  });

  const header = [
    "Protocolo",
    "Data",
    "Usuário",
    "E-mail",
    "Status",
    "CEP",
    "Logradouro",
    "Número",
    "Bairro",
    "Cidade",
    "UF",
    "Endereço localizado",
    "Confiança",
    "Confirmação manual",
    "Latitude",
    "Longitude",
    "Parceiros",
    "Camadas",
    "Referência de rede",
    "Status da referência",
    "Duração em ms",
  ];

  const lines = [header.join(";")];
  for (const row of rows) {
    const matches = (row.coverageMatches ?? []) as CoverageMatchSnapshot[];
    const partners = [...new Set(matches.map((match) => match.partnerName ?? ""))].join(", ");
    const layers = matches
      .map((match) =>
        match.version ? `${match.layerName} (${match.version})` : match.layerName ?? ""
      )
      .join(", ");
    const reference = row.networkReference as {
      distanceMeters?: number;
      identifiers?: Array<{ code?: string }>;
    } | null;
    const referenceText = reference
      ? [
          reference.identifiers?.map((identifier) => identifier.code).join(" / "),
          reference.distanceMeters !== undefined ? `${reference.distanceMeters} m` : null,
        ]
          .filter(Boolean)
          .join(" · ")
      : "";
    const latitude = row.confirmedLatitude ?? row.geocodedLatitude;
    const longitude = row.confirmedLongitude ?? row.geocodedLongitude;
    lines.push(
      [
        csvCell(row.protocol),
        csvCell(row.createdAt.toISOString()),
        csvCell(row.user?.name ?? ""),
        csvCell(row.user?.email ?? ""),
        csvCell(row.status),
        csvCell(row.postalCode ?? ""),
        csvCell(row.street),
        csvCell(row.number),
        csvCell(row.neighborhood ?? ""),
        csvCell(row.city),
        csvCell(row.state),
        csvCell(row.geocodedAddress ?? ""),
        csvCell(row.geocodingConfidence ?? ""),
        csvCell(row.locationConfirmedManually ? "Sim" : "Não"),
        csvCell(latitude ?? ""),
        csvCell(longitude ?? ""),
        csvCell(partners),
        csvCell(layers),
        csvCell(referenceText),
        csvCell(row.networkReferenceStatus),
        csvCell(row.durationMs ?? ""),
      ].join(";")
    );
  }

  // BOM UTF-8 para o Excel abrir com acentuação correta.
  return { csv: `\uFEFF${lines.join("\r\n")}`, rowCount: rows.length };
}

// ── Retenção / limpeza por lotes ──────────────────────────────

export interface CleanupResult {
  retentionDays: number;
  cutoff: string;
  expiredCount: number;
  removedCount: number;
  dryRun: boolean;
}

export async function cleanupConsultations(options: {
  dryRun: boolean;
  batchSize?: number;
}): Promise<CleanupResult> {
  const retentionDays = env.CONSULTATION_RETENTION_DAYS;
  if (!Number.isInteger(retentionDays) || retentionDays <= 0) {
    throw new AppError(
      "CONSULTATION_CLEANUP_FAILED",
      "CONSULTATION_RETENTION_DAYS deve ser um inteiro maior que zero.",
      400
    );
  }
  const cutoff = new Date(Date.now() - retentionDays * 24 * 60 * 60 * 1000);
  const batchSize = options.batchSize ?? 500;

  const expiredCount = await prisma.viabilityConsultation.count({
    where: { createdAt: { lt: cutoff } },
  });
  if (options.dryRun) {
    return {
      retentionDays,
      cutoff: cutoff.toISOString(),
      expiredCount,
      removedCount: 0,
      dryRun: true,
    };
  }

  // Remoção por LOTES: consumo de memória previsível.
  let removedCount = 0;
  for (;;) {
    const batch = await prisma.viabilityConsultation.findMany({
      where: { createdAt: { lt: cutoff } },
      select: { id: true },
      take: batchSize,
    });
    if (batch.length === 0) break;
    const result = await prisma.viabilityConsultation.deleteMany({
      where: { id: { in: batch.map((row) => row.id) } },
    });
    removedCount += result.count;
  }

  if (removedCount > 0) {
    await recordAudit({
      userId: null,
      action: "CONSULTATION_CLEANUP_EXECUTED",
      entity: "viability_consultation",
      metadata: { retentionDays, removedCount },
      ipAddress: null,
    });
  }
  return {
    retentionDays,
    cutoff: cutoff.toISOString(),
    expiredCount,
    removedCount,
    dryRun: false,
  };
}
