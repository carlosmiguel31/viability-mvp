import { NextFunction, Request, Response } from "express";
import { coverageMemoryStore } from "../stores/coverage-memory.store";
import { loadCoverageIntoMemory } from "../services/coverage-loader.service";
import { env } from "../config/env";
import { logger } from "../utils/logger";
import { recordAudit } from "../services/audit.service";

export function coverageStatusHandler(_req: Request, res: Response): void {
  res.status(200).json(coverageMemoryStore.getStatus());
}

/**
 * Retorna somente o necessario para o mapa desenhar as manchas:
 * id, nome, pasta e aneis dos poligonos. Nada de dados internos extras.
 */
export function coverageAreasHandler(_req: Request, res: Response): void {
  const areas = coverageMemoryStore.getAreas().map((area) => ({
    internalId: area.internalId,
    name: area.name,
    folderPath: area.folderPath,
    polygons: area.polygons,
  }));
  res.status(200).json({ totalAreas: areas.length, areas });
}

export async function coverageReloadHandler(
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> {
  try {
    logger.info("Recarga manual das manchas solicitada");
    // loadCoverageIntoMemory so substitui o store apos validacao completa;
    // se falhar, os dados antigos permanecem intactos.
    const summary = await loadCoverageIntoMemory(env.NETWORK_COVERAGE_PATH);
    await recordAudit({
      userId: req.user?.id ?? null,
      action: "COVERAGE_RELOADED",
      entity: "coverage",
      metadata: { totalAreas: summary.totalAreas, totalPolygons: summary.totalPolygons },
      ipAddress: req.ip ?? null,
    });
    res.status(200).json({ reloaded: true, ...summary });
  } catch (err) {
    next(err);
  }
}
