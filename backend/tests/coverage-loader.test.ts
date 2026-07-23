import { beforeEach, describe, expect, it } from "vitest";
import path from "path";
import os from "os";
import { promises as fs } from "fs";
import { zipSync, strToU8 } from "fflate";
import { loadCoverageIntoMemory, CoverageLimits } from "../src/services/coverage-loader.service";
import { coverageSnapshotStore } from "../src/stores/coverage-snapshot.store";
import {
  createInvalidKmzFile,
  createTestKmlFile,
  createTestKmzFile,
  readFixtureKml,
} from "./helpers";
import { CoverageFileNotFoundError, InvalidCoverageFileError } from "../src/utils/errors";

const LIMITS: CoverageLimits = {
  maxCompressedBytes: 50 * 1024 * 1024,
  maxUncompressedBytes: 100 * 1024 * 1024,
  maxEntries: 500,
  maxKmlBytes: 50 * 1024 * 1024,
};

describe("loadCoverageIntoMemory", () => {
  beforeEach(() => {
    coverageSnapshotStore.clear();
  });

  it("carrega um .kml direto", async () => {
    const filePath = await createTestKmlFile();
    const summary = await loadCoverageIntoMemory(filePath, LIMITS);

    expect(summary.totalAreas).toBe(3);
    expect(summary.totalPolygons).toBe(4);
    expect(summary.ignoredLines).toBe(1);
    expect(summary.ignoredPoints).toBe(1);
    expect(summary.rejectedGeometries).toBe(1);
    expect(coverageSnapshotStore.isConfigured()).toBe(true);
    expect(coverageSnapshotStore.getStatus().sourceFile).toBe("manchas.kml");
  });

  it("carrega um KML dentro de um .kmz", async () => {
    const filePath = await createTestKmzFile();
    const summary = await loadCoverageIntoMemory(filePath, LIMITS);
    expect(summary.totalAreas).toBe(3);
    expect(coverageSnapshotStore.getStatus().sourceFile).toBe("manchas.kmz");
  });

  it("rejeita .kmz que nao e ZIP valido", async () => {
    const filePath = await createInvalidKmzFile();
    await expect(loadCoverageIntoMemory(filePath, LIMITS)).rejects.toBeInstanceOf(
      InvalidCoverageFileError
    );
    expect(coverageSnapshotStore.isConfigured()).toBe(false);
  });

  it("rejeita extensao nao suportada", async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), "coverage-ext-"));
    const filePath = path.join(dir, "manchas.txt");
    await fs.writeFile(filePath, readFixtureKml());
    await expect(loadCoverageIntoMemory(filePath, LIMITS)).rejects.toThrow(/extensao/);
  });

  it("rejeita caminho inexistente", async () => {
    await expect(loadCoverageIntoMemory("/nao/existe.kml", LIMITS)).rejects.toBeInstanceOf(
      CoverageFileNotFoundError
    );
  });

  it("recarga invalida preserva os dados anteriores", async () => {
    await loadCoverageIntoMemory(await createTestKmlFile(), LIMITS);
    const before = coverageSnapshotStore.getStatus();

    await expect(
      loadCoverageIntoMemory(await createInvalidKmzFile(), LIMITS)
    ).rejects.toBeInstanceOf(InvalidCoverageFileError);

    const after = coverageSnapshotStore.getStatus();
    expect(after.loaded).toBe(true);
    expect(after.totalAreas).toBe(before.totalAreas);
    expect(after.sourceFile).toBe("manchas.kml");
  });

  it("rejeita KML acima do tamanho maximo", async () => {
    const filePath = await createTestKmlFile();
    await expect(
      loadCoverageIntoMemory(filePath, { ...LIMITS, maxKmlBytes: 100 })
    ).rejects.toThrow(/KML excede/);
  });

  it("rejeita KMZ com entradas demais", async () => {
    const files: Record<string, Uint8Array> = { "doc.kml": strToU8(readFixtureKml()) };
    for (let i = 0; i < 5; i++) files[`extra-${i}.txt`] = strToU8("x");
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), "coverage-limit-"));
    const filePath = path.join(dir, "limite.kmz");
    await fs.writeFile(filePath, Buffer.from(zipSync(files)));
    await expect(
      loadCoverageIntoMemory(filePath, { ...LIMITS, maxEntries: 3 })
    ).rejects.toThrow(/entradas demais/);
  });

  it("rejeita conteudo descompactado acima do limite", async () => {
    const files = { "doc.kml": strToU8(readFixtureKml()), "grande.txt": strToU8("a".repeat(10_000)) };
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), "coverage-limit2-"));
    const filePath = path.join(dir, "limite.kmz");
    await fs.writeFile(filePath, Buffer.from(zipSync(files)));
    await expect(
      loadCoverageIntoMemory(filePath, { ...LIMITS, maxUncompressedBytes: 5_000 })
    ).rejects.toThrow(/descompactado excede/);
  });
});
