import { NextFunction, Request, Response } from "express";
import { coverageSnapshotStore } from "../stores/coverage-snapshot.store";
import { rebuildCoverageSnapshot } from "../services/coverage-snapshot.service";
import { logger } from "../utils/logger";
import { recordAudit } from "../services/audit.service";

export function coverageStatusHandler(_req: Request, res: Response): void {
  res.status(200).json(coverageSnapshotStore.getStatus());
}

/**
 * Retorna somente o necessario para o mapa desenhar as manchas de TODAS as
 * camadas ativas: id, nome, pasta e aneis dos poligonos. Nenhum dado
 * interno de armazenamento.
 */
export function coverageAreasHandler(_req: Request, res: Response): void {
  const areas = coverageSnapshotStore.getLayers().flatMap((layer) =>
    layer.areas.map((area) => ({
      internalId: area.internalId,
      name: area.name,
      folderPath: area.folderPath,
      polygons: area.polygons,
    }))
  );
  res.status(200).json({ totalAreas: areas.length, areas });
}

export async function coverageReloadHandler(
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> {
  try {
    logger.info("Reconstrução manual do snapshot de cobertura solicitada");
    // O novo snapshot e montado a parte e so substitui o atual apos
    // sucesso; em falha, o snapshot anterior permanece valendo.
    const summary = await rebuildCoverageSnapshot();
    await recordAudit({
      userId: req.user?.id ?? null,
      action: "COVERAGE_RELOADED",
      entity: "coverage",
      metadata: {
        totalLayers: summary.totalLayers,
        totalAreas: summary.totalAreas,
        totalPolygons: summary.totalPolygons,
      },
      ipAddress: req.ip ?? null,
    });
    res.status(200).json({ reloaded: true, ...summary });
  } catch (err) {
    next(err);
  }
}
