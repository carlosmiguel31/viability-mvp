import { promises as fs } from "fs";
import path from "path";
import { unzipSync, strFromU8 } from "fflate";
import { parseCoverageKml } from "./coverage-parser.service";
import { coverageMemoryStore } from "../stores/coverage-memory.store";
import { env } from "../config/env";
import { InvalidCoverageFileError, CoverageFileNotFoundError } from "../utils/errors";
import { logger } from "../utils/logger";

const ZIP_MAGIC = Buffer.from([0x50, 0x4b, 0x03, 0x04]); // "PK\x03\x04"

export interface CoverageLimits {
  maxCompressedBytes: number;
  maxUncompressedBytes: number;
  maxEntries: number;
  maxKmlBytes: number;
}

function defaultLimits(): CoverageLimits {
  return {
    maxCompressedBytes: env.MAX_KMZ_COMPRESSED_BYTES,
    maxUncompressedBytes: env.MAX_KMZ_UNCOMPRESSED_BYTES,
    maxEntries: env.MAX_KMZ_ENTRIES,
    maxKmlBytes: env.MAX_KML_BYTES,
  };
}

export interface CoverageLoadSummary {
  totalAreas: number;
  totalPolygons: number;
  ignoredPoints: number;
  ignoredLines: number;
  rejectedGeometries: number;
  sourceFile: string;
  durationMs: number;
}

function extractKmlFromKmz(buffer: Buffer, limits: CoverageLimits): string {
  if (buffer.byteLength < 4 || !buffer.subarray(0, 4).equals(ZIP_MAGIC)) {
    throw new InvalidCoverageFileError("o conteudo nao e um ZIP/KMZ valido");
  }

  let entryCount = 0;
  let totalUncompressed = 0;
  let entries: Record<string, Uint8Array>;
  try {
    entries = unzipSync(new Uint8Array(buffer), {
      filter: (file) => {
        entryCount += 1;
        if (entryCount > limits.maxEntries) {
          throw new InvalidCoverageFileError("o KMZ possui entradas demais");
        }
        totalUncompressed += file.originalSize;
        if (totalUncompressed > limits.maxUncompressedBytes) {
          throw new InvalidCoverageFileError("o conteudo descompactado excede o limite permitido");
        }
        const name = file.name;
        // Path traversal e arquivos que nao sao KML nem chegam a ser expandidos.
        if (name.includes("..") || path.isAbsolute(name)) return false;
        if (!name.toLowerCase().endsWith(".kml")) return false;
        if (file.originalSize > limits.maxKmlBytes) {
          throw new InvalidCoverageFileError("o KML excede o tamanho maximo permitido");
        }
        return true;
      },
    });
  } catch (err) {
    if (err instanceof InvalidCoverageFileError) throw err;
    throw new InvalidCoverageFileError("falha ao descompactar o arquivo");
  }

  const kmlEntryName = Object.keys(entries).sort((a, b) => {
    const aDoc = a.toLowerCase() === "doc.kml" ? 0 : 1;
    const bDoc = b.toLowerCase() === "doc.kml" ? 0 : 1;
    return aDoc - bDoc || a.localeCompare(b);
  })[0];

  if (!kmlEntryName) {
    throw new InvalidCoverageFileError("nenhum arquivo KML encontrado dentro do KMZ");
  }
  return strFromU8(entries[kmlEntryName]);
}

/**
 * Carrega o arquivo de manchas de cobertura (.kml direto ou .kmz) e substitui
 * o estado em memoria. A troca so acontece DEPOIS que todo o arquivo foi
 * validado e interpretado; se qualquer etapa falhar, os dados antigos sao
 * preservados. Nada e extraido em disco.
 */
export async function loadCoverageIntoMemory(
  filePath: string,
  limits: CoverageLimits = defaultLimits()
): Promise<CoverageLoadSummary> {
  const startedAt = Date.now();
  logger.info("Iniciando carga das manchas de cobertura", { filePath });

  let buffer: Buffer;
  try {
    buffer = await fs.readFile(filePath);
  } catch {
    throw new CoverageFileNotFoundError(filePath);
  }

  const extension = path.extname(filePath).toLowerCase();
  let kmlContent: string;
  let source: "KML" | "KMZ";

  if (extension === ".kml") {
    if (buffer.byteLength > limits.maxKmlBytes) {
      throw new InvalidCoverageFileError("o KML excede o tamanho maximo permitido");
    }
    kmlContent = buffer.toString("utf-8");
    source = "KML";
  } else if (extension === ".kmz") {
    if (buffer.byteLength > limits.maxCompressedBytes) {
      throw new InvalidCoverageFileError("arquivo excede o tamanho maximo permitido");
    }
    kmlContent = extractKmlFromKmz(buffer, limits);
    source = "KMZ";
  } else {
    throw new InvalidCoverageFileError("extensao nao suportada (use .kml ou .kmz)");
  }

  const result = parseCoverageKml(kmlContent, source);
  if (result.areas.length === 0) {
    throw new InvalidCoverageFileError("nenhuma area de cobertura valida encontrada no arquivo");
  }

  const sourceFile = path.basename(filePath);
  coverageMemoryStore.replaceAll({ ...result, sourceFile });

  const durationMs = Date.now() - startedAt;
  logger.info("Carga das manchas concluida", {
    sourceFile,
    totalAreas: result.areas.length,
    totalPolygons: result.totalPolygons,
    ignoredPoints: result.ignoredPoints,
    ignoredLines: result.ignoredLines,
    rejectedGeometries: result.rejectedGeometries,
    durationMs,
  });

  return {
    totalAreas: result.areas.length,
    totalPolygons: result.totalPolygons,
    ignoredPoints: result.ignoredPoints,
    ignoredLines: result.ignoredLines,
    rejectedGeometries: result.rejectedGeometries,
    sourceFile,
    durationMs,
  };
}
