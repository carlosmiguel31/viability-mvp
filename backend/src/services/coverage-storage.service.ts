import { createHash, randomUUID } from "crypto";
import { promises as fs } from "fs";
import path from "path";
import { env } from "../config/env";
import { AppError } from "../utils/errors";
import { logger } from "../utils/logger";

/**
 * Armazena os arquivos KML/KMZ das camadas em um diretorio controlado pelo
 * backend (COVERAGE_STORAGE_PATH), NUNCA publicado como conteudo estatico.
 * O nome enviado pelo usuario jamais vira caminho: o nome interno e
 * aleatorio (uuid + extensao validada), o que tambem elimina path traversal
 * e colisoes. Arquivos nunca sao sobrescritos (flag "wx").
 */

export type CoverageFileExtension = ".kml" | ".kmz";

export function maxCoverageFileBytes(): number {
  return env.COVERAGE_MAX_FILE_SIZE_MB * 1024 * 1024;
}

export function storageRoot(): string {
  return path.resolve(env.COVERAGE_STORAGE_PATH);
}

export function sha256Hex(buffer: Buffer): string {
  return createHash("sha256").update(buffer).digest("hex");
}

/** Extrai e valida a extensao do nome ORIGINAL (apenas .kml/.kmz). */
export function validateExtension(originalFileName: string): CoverageFileExtension {
  const extension = path.extname(originalFileName).toLowerCase();
  if (extension !== ".kml" && extension !== ".kmz") {
    throw new AppError(
      "COVERAGE_FILE_INVALID",
      "Extensão não suportada: envie um arquivo .kml ou .kmz.",
      400
    );
  }
  return extension;
}

export function assertFileSize(buffer: Buffer): void {
  if (buffer.byteLength === 0) {
    throw new AppError("COVERAGE_FILE_INVALID", "O arquivo enviado está vazio.", 400);
  }
  if (buffer.byteLength > maxCoverageFileBytes()) {
    throw new AppError(
      "COVERAGE_FILE_TOO_LARGE",
      `O arquivo excede o limite de ${env.COVERAGE_MAX_FILE_SIZE_MB} MB.`,
      400
    );
  }
}

/**
 * Salva o buffer com nome interno seguro e aleatorio dentro do diretorio de
 * armazenamento. Retorna somente o nome interno (relativo).
 */
export async function saveCoverageFile(
  buffer: Buffer,
  extension: CoverageFileExtension
): Promise<string> {
  const root = storageRoot();
  await fs.mkdir(root, { recursive: true });
  const storedFileName = `${randomUUID()}${extension}`;
  const absolutePath = path.join(root, storedFileName);
  // "wx": falha se ja existir — nunca sobrescreve.
  await fs.writeFile(absolutePath, buffer, { flag: "wx" });
  return storedFileName;
}

const STORED_NAME_PATTERN = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}\.(kml|kmz)$/i;

/**
 * Resolve o caminho absoluto de um nome interno. Dupla protecao contra path
 * traversal: o nome precisa ter o formato estrito gerado pelo backend
 * (uuid + extensao — sem "/", "\" ou "..") E o caminho resolvido precisa
 * permanecer DENTRO do diretorio de armazenamento.
 */
export function resolveStoredFile(storedFileName: string): string {
  if (!STORED_NAME_PATTERN.test(storedFileName)) {
    throw new AppError("COVERAGE_FILE_INVALID", "Nome de arquivo inválido.", 400);
  }
  const root = storageRoot();
  const absolutePath = path.resolve(root, storedFileName);
  if (!absolutePath.startsWith(root + path.sep)) {
    throw new AppError("COVERAGE_FILE_INVALID", "Nome de arquivo inválido.", 400);
  }
  return absolutePath;
}

export async function readStoredFile(storedFileName: string): Promise<Buffer> {
  return fs.readFile(resolveStoredFile(storedFileName));
}

/** Remocao best-effort: falha e registrada e reportada, sem stack ao cliente. */
export async function deleteStoredFile(storedFileName: string): Promise<boolean> {
  try {
    await fs.unlink(resolveStoredFile(storedFileName));
    return true;
  } catch (err) {
    logger.warn("Falha ao remover arquivo fisico de cobertura", {
      storedFileName,
      message: err instanceof Error ? err.message : "erro desconhecido",
    });
    return false;
  }
}
