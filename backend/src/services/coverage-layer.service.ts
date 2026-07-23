import { prisma } from "../db/prisma";
import { AppError } from "../utils/errors";
import { recordAudit } from "./audit.service";
import { parseCoverageKml } from "./coverage-parser.service";
import { extractKmlFromKmz, coverageLimits } from "./coverage-loader.service";
import {
  assertFileSize,
  deleteStoredFile,
  readStoredFile,
  saveCoverageFile,
  sha256Hex,
  validateExtension,
} from "./coverage-storage.service";
import { rebuildCoverageSnapshot } from "./coverage-snapshot.service";
import { InvalidCoverageFileError } from "../utils/errors";
import type { CoverageLayer, CoveragePartner } from "../generated/prisma/client";

type LayerWithPartner = CoverageLayer & {
  partner: Pick<CoveragePartner, "id" | "name" | "code">;
};

/**
 * Visao publica da camada: NUNCA inclui storedFileName, caminho fisico ou
 * detalhes internos de armazenamento — para nenhum perfil.
 */
export interface PublicCoverageLayer {
  id: string;
  partner: { id: string; name: string; code: string };
  name: string;
  description: string | null;
  version: string | null;
  originalFileName: string;
  fileType: "KML" | "KMZ";
  fileSize: number;
  sha256: string;
  active: boolean;
  processingStatus: "PENDING" | "PROCESSING" | "READY" | "FAILED";
  polygonCount: number;
  areaCount: number;
  ignoredGeometryCount: number;
  processingError: string | null;
  createdAt: Date;
  updatedAt: Date;
}

/** Visao reduzida para perfis não administrativos. */
export interface BasicCoverageLayer {
  id: string;
  partner: { id: string; name: string };
  name: string;
  version: string | null;
  active: boolean;
}

export function toPublicLayer(layer: LayerWithPartner): PublicCoverageLayer {
  return {
    id: layer.id,
    partner: { id: layer.partner.id, name: layer.partner.name, code: layer.partner.code },
    name: layer.name,
    description: layer.description,
    version: layer.version,
    originalFileName: layer.originalFileName,
    fileType: layer.fileType,
    fileSize: layer.fileSize,
    sha256: layer.sha256,
    active: layer.active,
    processingStatus: layer.processingStatus,
    polygonCount: layer.polygonCount,
    areaCount: layer.areaCount,
    ignoredGeometryCount: layer.ignoredGeometryCount,
    processingError: layer.processingError,
    createdAt: layer.createdAt,
    updatedAt: layer.updatedAt,
  };
}

export function toBasicLayer(layer: LayerWithPartner): BasicCoverageLayer {
  return {
    id: layer.id,
    partner: { id: layer.partner.id, name: layer.partner.name },
    name: layer.name,
    version: layer.version,
    active: layer.active,
  };
}

const LAYER_INCLUDE = { partner: { select: { id: true, name: true, code: true } } } as const;

async function getLayerOrThrow(id: string): Promise<LayerWithPartner> {
  const layer = await prisma.coverageLayer.findUnique({ where: { id }, include: LAYER_INCLUDE });
  if (!layer) throw new AppError("COVERAGE_LAYER_NOT_FOUND", "Camada não encontrada.", 404);
  return layer;
}

export interface CreateLayerInput {
  partnerId: string;
  name: string;
  description?: string;
  version?: string;
  active?: boolean;
  fileBuffer: Buffer;
  originalFileName: string;
}

/**
 * Cadastro de camada (item 3 da spec):
 * PENDING → salvar arquivo → PROCESSING → interpretar/validar → READY,
 * ou FAILED com mensagem SEGURA (sem stack trace).
 */
export async function createLayer(
  input: CreateLayerInput,
  actor: { id: string } | null,
  ipAddress: string | null
): Promise<PublicCoverageLayer> {
  const partner = await prisma.coveragePartner.findUnique({ where: { id: input.partnerId } });
  if (!partner) {
    throw new AppError("COVERAGE_PARTNER_NOT_FOUND", "Parceiro não encontrado.", 404);
  }

  const extension = validateExtension(input.originalFileName);
  assertFileSize(input.fileBuffer);
  const sha256 = sha256Hex(input.fileBuffer);

  // Deduplicacao explicita por SHA-256 (tambem garantida por unique no banco).
  const duplicate = await prisma.coverageLayer.findUnique({ where: { sha256 } });
  if (duplicate) {
    throw new AppError(
      "COVERAGE_FILE_DUPLICATE",
      "Este arquivo já foi importado (mesmo SHA-256).",
      409
    );
  }

  // 1) PENDING + arquivo salvo com nome interno aleatorio.
  const storedFileName = await saveCoverageFile(input.fileBuffer, extension);
  let layer = await prisma.coverageLayer.create({
    data: {
      partnerId: partner.id,
      name: input.name.trim(),
      description: input.description?.trim() || null,
      version: input.version?.trim() || null,
      originalFileName: input.originalFileName,
      storedFileName,
      fileType: extension === ".kml" ? "KML" : "KMZ",
      fileSize: input.fileBuffer.byteLength,
      sha256,
      active: input.active ?? true,
      processingStatus: "PENDING",
      uploadedById: actor?.id ?? null,
    },
    include: LAYER_INCLUDE,
  });

  // 2) PROCESSING → parse → READY/FAILED.
  layer = await prisma.coverageLayer.update({
    where: { id: layer.id },
    data: { processingStatus: "PROCESSING" },
    include: LAYER_INCLUDE,
  });

  try {
    const kml =
      layer.fileType === "KMZ"
        ? extractKmlFromKmz(input.fileBuffer, coverageLimits())
        : input.fileBuffer.toString("utf-8");
    const parsed = parseCoverageKml(kml, layer.fileType);
    if (parsed.areas.length === 0) {
      throw new InvalidCoverageFileError(
        "nenhum polígono válido encontrado no arquivo"
      );
    }
    layer = await prisma.coverageLayer.update({
      where: { id: layer.id },
      data: {
        processingStatus: "READY",
        areaCount: parsed.areas.length,
        polygonCount: parsed.totalPolygons,
        ignoredGeometryCount:
          parsed.ignoredPoints + parsed.ignoredLines + parsed.rejectedGeometries,
        processingError: null,
      },
      include: LAYER_INCLUDE,
    });
  } catch (err) {
    // Mensagem SEGURA (sem stack trace) registrada e auditada.
    const safeMessage =
      err instanceof AppError ? err.message : "Falha ao interpretar o arquivo de cobertura.";
    layer = await prisma.coverageLayer.update({
      where: { id: layer.id },
      data: { processingStatus: "FAILED", processingError: safeMessage },
      include: LAYER_INCLUDE,
    });
    await recordAudit({
      userId: actor?.id ?? null,
      action: "COVERAGE_LAYER_PROCESSING_FAILED",
      entity: "coverage_layer",
      entityId: layer.id,
      metadata: { name: layer.name, sha256, reason: safeMessage },
      ipAddress,
    });
    throw new AppError("COVERAGE_PROCESSING_FAILED", safeMessage, 400);
  }

  await recordAudit({
    userId: actor?.id ?? null,
    action: "COVERAGE_LAYER_UPLOADED",
    entity: "coverage_layer",
    entityId: layer.id,
    metadata: {
      name: layer.name,
      partnerName: partner.name,
      version: layer.version,
      sha256,
      areaCount: layer.areaCount,
      polygonCount: layer.polygonCount,
      ignoredGeometryCount: layer.ignoredGeometryCount,
    },
    ipAddress,
  });

  if (layer.active && partner.active) {
    await rebuildCoverageSnapshot();
  }
  return toPublicLayer(layer);
}

export async function listLayers(filters: {
  search?: string;
  partnerId?: string;
  active?: boolean;
  processingStatus?: "PENDING" | "PROCESSING" | "READY" | "FAILED";
  fileType?: "KML" | "KMZ";
  page: number;
  limit: number;
}): Promise<{ layers: LayerWithPartner[]; total: number; page: number; limit: number }> {
  const where = {
    ...(filters.partnerId ? { partnerId: filters.partnerId } : {}),
    ...(filters.active !== undefined ? { active: filters.active } : {}),
    ...(filters.processingStatus ? { processingStatus: filters.processingStatus } : {}),
    ...(filters.fileType ? { fileType: filters.fileType } : {}),
    ...(filters.search
      ? {
          OR: [
            { name: { contains: filters.search, mode: "insensitive" as const } },
            { version: { contains: filters.search, mode: "insensitive" as const } },
          ],
        }
      : {}),
  };
  const [total, layers] = await Promise.all([
    prisma.coverageLayer.count({ where }),
    prisma.coverageLayer.findMany({
      where,
      include: LAYER_INCLUDE,
      orderBy: { createdAt: "desc" },
      skip: (filters.page - 1) * filters.limit,
      take: filters.limit,
    }),
  ]);
  return { layers, total, page: filters.page, limit: filters.limit };
}

export async function getLayer(id: string): Promise<PublicCoverageLayer> {
  return toPublicLayer(await getLayerOrThrow(id));
}

export async function updateLayer(
  id: string,
  input: { name?: string; description?: string | null; version?: string | null },
  actor: { id: string },
  ipAddress: string | null
): Promise<PublicCoverageLayer> {
  await getLayerOrThrow(id);
  const layer = await prisma.coverageLayer.update({
    where: { id },
    data: {
      ...(input.name !== undefined ? { name: input.name.trim() } : {}),
      ...(input.description !== undefined
        ? { description: input.description?.trim() || null }
        : {}),
      ...(input.version !== undefined ? { version: input.version?.trim() || null } : {}),
    },
    include: LAYER_INCLUDE,
  });
  await recordAudit({
    userId: actor.id,
    action: "COVERAGE_LAYER_UPDATED",
    entity: "coverage_layer",
    entityId: id,
    metadata: { name: layer.name, version: layer.version },
    ipAddress,
  });
  await rebuildCoverageSnapshot().catch(() => undefined);
  return toPublicLayer(layer);
}

export async function setLayerStatus(
  id: string,
  active: boolean,
  actor: { id: string },
  ipAddress: string | null
): Promise<PublicCoverageLayer> {
  const current = await getLayerOrThrow(id);
  if (current.processingStatus === "PROCESSING") {
    throw new AppError(
      "COVERAGE_LAYER_PROCESSING",
      "A camada ainda está sendo processada.",
      409
    );
  }
  const layer = await prisma.coverageLayer.update({
    where: { id },
    data: { active },
    include: LAYER_INCLUDE,
  });
  await recordAudit({
    userId: actor.id,
    action: active ? "COVERAGE_LAYER_ACTIVATED" : "COVERAGE_LAYER_DEACTIVATED",
    entity: "coverage_layer",
    entityId: id,
    metadata: { name: layer.name },
    ipAddress,
  });
  await rebuildCoverageSnapshot();
  return toPublicLayer(layer);
}

export async function deleteLayer(
  id: string,
  actor: { id: string },
  ipAddress: string | null
): Promise<void> {
  const layer = await getLayerOrThrow(id);
  // Nao excluir durante o processamento.
  if (layer.processingStatus === "PROCESSING") {
    throw new AppError(
      "COVERAGE_LAYER_PROCESSING",
      "A camada ainda está sendo processada e não pode ser excluída.",
      409
    );
  }

  await prisma.coverageLayer.delete({ where: { id } });

  // Arquivo fisico removido SOMENTE apos as validacoes e a exclusao do
  // registro; falha na remocao e registrada (log + auditoria) sem quebrar.
  const fileRemoved = await deleteStoredFile(layer.storedFileName);

  await recordAudit({
    userId: actor.id,
    action: "COVERAGE_LAYER_DELETED",
    entity: "coverage_layer",
    entityId: id,
    metadata: {
      name: layer.name,
      partnerName: layer.partner.name,
      sha256: layer.sha256,
      fileRemoved,
    },
    ipAddress,
  });

  await rebuildCoverageSnapshot();
}

/** Reexportado para o comando coverage:import. */
export { readStoredFile };
