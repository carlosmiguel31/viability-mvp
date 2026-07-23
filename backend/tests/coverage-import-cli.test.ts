import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { promises as fs } from "fs";
import path from "path";
import { prisma, disconnectAppDatabase } from "../src/db/prisma";
import { runCoverageImport } from "../src/scripts/coverage-import";
import { coverageSnapshotStore } from "../src/stores/coverage-snapshot.store";
import { storageRoot } from "../src/services/coverage-storage.service";
import { readFixtureKml, resetAppDatabase } from "./helpers";

const KML_PATH = path.join("/tmp", `coverage-import-cli-${Date.now()}.kml`);

describe("comando coverage:import", () => {
  beforeAll(async () => {
    await resetAppDatabase();
    await prisma.coverageLayer.deleteMany();
    await prisma.coveragePartner.deleteMany();
    coverageSnapshotStore.clear();
    await fs.rm(storageRoot(), { recursive: true, force: true });
    await fs.writeFile(KML_PATH, readFixtureKml());
  });
  afterAll(async () => {
    await fs.rm(KML_PATH, { force: true });
    await prisma.coverageLayer.deleteMany();
    await prisma.coveragePartner.deleteMany();
    await disconnectAppDatabase();
  });

  it("cria o parceiro pelo code, importa o arquivo e alimenta o snapshot", async () => {
    await runCoverageImport([
      "--file", KML_PATH,
      "--partner", "Rede Neutra",
      "--code", "rede_neutra",
      "--layer", "Cobertura inicial",
      "--version", "2026-07",
    ]);
    const partner = await prisma.coveragePartner.findUniqueOrThrow({
      where: { code: "REDE_NEUTRA" },
    });
    const layer = await prisma.coverageLayer.findFirstOrThrow({
      where: { partnerId: partner.id },
    });
    expect(layer.processingStatus).toBe("READY");
    expect(layer.uploadedById).toBeNull(); // execução por CLI
    expect(coverageSnapshotStore.getLayers().map((l) => l.layerName)).toEqual([
      "Cobertura inicial",
    ]);
  });

  it("não duplica o mesmo SHA-256 e retorna erro claro; parceiro é reutilizado", async () => {
    await expect(
      runCoverageImport([
        "--file", KML_PATH,
        "--partner", "Rede Neutra",
        "--code", "REDE_NEUTRA",
        "--layer", "Cobertura repetida",
      ])
    ).rejects.toMatchObject({ code: "COVERAGE_FILE_DUPLICATE" });
    expect(await prisma.coveragePartner.count()).toBe(1);
    expect(await prisma.coverageLayer.count()).toBe(1);
  });
});
