import { prisma } from "../db/prisma";
import { parseCoverageKml } from "./coverage-parser.service";
import { extractKmlFromKmz, coverageLimits } from "./coverage-loader.service";
import { readStoredFile } from "./coverage-storage.service";
import {
  coverageSnapshotStore,
  CoverageSnapshotLayer,
} from "../stores/coverage-snapshot.store";
import { AppError } from "../utils/errors";
import { logger } from "../utils/logger";

/**
 * Servico CENTRAL do snapshot de cobertura (v0.3.0).
 *
 * Reconstroi o indice em memoria a partir de todas as CoverageLayer com
 * active=true, processingStatus=READY e parceiro active=true.
 *
 * Garantias de consistencia:
 * - o novo snapshot e montado SEPARADO e so substitui o atual apos sucesso
 *   completo (replaceAll); em falha, o snapshot anterior segue valendo e
 *   COVERAGE_SNAPSHOT_REBUILD_FAILED e lancado;
 * - reconstrucoes sao SERIALIZADAS por uma fila de promessas: duas
 *   importacoes simultaneas nunca corrompem o snapshot;
 * - consultas em andamento continuam lendo a referencia anterior do array —
 *   a troca nao gera intervalo sem cobertura.
 */
let rebuildQueue: Promise<unknown> = Promise.resolve();

async function buildSnapshotLayers(): Promise<CoverageSnapshotLayer[]> {
  const layers = await prisma.coverageLayer.findMany({
    where: {
      active: true,
      processingStatus: "READY",
      partner: { active: true },
    },
    include: { partner: { select: { id: true, name: true } } },
    orderBy: { createdAt: "asc" },
  });

  const snapshot: CoverageSnapshotLayer[] = [];
  for (const layer of layers) {
    const buffer = await readStoredFile(layer.storedFileName);
    const kml =
      layer.fileType === "KMZ"
        ? extractKmlFromKmz(buffer, coverageLimits())
        : buffer.toString("utf-8");
    const parsed = parseCoverageKml(kml, layer.fileType);
    if (parsed.areas.length === 0) {
      throw new AppError(
        "COVERAGE_SNAPSHOT_REBUILD_FAILED",
        `A camada ${layer.name} não possui polígonos válidos.`,
        500
      );
    }
    snapshot.push({
      layerId: layer.id,
      layerName: layer.name,
      partnerId: layer.partner.id,
      partnerName: layer.partner.name,
      version: layer.version,
      areas: parsed.areas.map((area) => ({
        ...area,
        internalId: `${layer.id}:${area.internalId}`,
      })),
      polygonCount: parsed.totalPolygons,
    });
  }
  return snapshot;
}

export interface SnapshotRebuildSummary {
  totalPartners: number;
  totalLayers: number;
  totalAreas: number;
  totalPolygons: number;
  durationMs: number;
}

export async function rebuildCoverageSnapshot(): Promise<SnapshotRebuildSummary> {
  const task = rebuildQueue.then(
    async (): Promise<SnapshotRebuildSummary> => {
      const startedAt = Date.now();
      let layers: CoverageSnapshotLayer[];
      try {
        layers = await buildSnapshotLayers();
      } catch (err) {
        // Snapshot anterior permanece intacto e funcionando.
        const message = err instanceof Error ? err.message : "erro desconhecido";
        logger.error("Falha na reconstrução do snapshot de cobertura; snapshot anterior mantido", {
          message,
        });
        if (err instanceof AppError) throw err;
        throw new AppError(
          "COVERAGE_SNAPSHOT_REBUILD_FAILED",
          "Não foi possível reconstruir o índice de cobertura.",
          500
        );
      }

      coverageSnapshotStore.replaceAll(layers);
      const status = coverageSnapshotStore.getStatus();
      const summary: SnapshotRebuildSummary = {
        totalPartners: status.totalPartners,
        totalLayers: status.totalLayers,
        totalAreas: status.totalAreas,
        totalPolygons: status.totalPolygons,
        durationMs: Date.now() - startedAt,
      };
      logger.info("Snapshot de cobertura reconstruído", { ...summary });
      return summary;
    }
  );
  // A fila nunca quebra: erros são absorvidos para a próxima reconstrução.
  rebuildQueue = task.catch(() => undefined);
  return task;
}

/** Boot: carrega camadas ativas sem impedir a subida do backend em falha. */
export async function initializeCoverageSnapshot(): Promise<void> {
  try {
    const summary = await rebuildCoverageSnapshot();
    if (summary.totalLayers === 0) {
      logger.warn(
        "Nenhuma camada de cobertura ativa cadastrada — as consultas responderão COVERAGE_NOT_CONFIGURED. Importe com: npm run coverage:import"
      );
    }
  } catch (err) {
    logger.error("Snapshot de cobertura não pôde ser carregado na inicialização", {
      message: err instanceof Error ? err.message : "erro desconhecido",
    });
  }
}
