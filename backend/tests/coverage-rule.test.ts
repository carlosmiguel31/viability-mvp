import { beforeEach, describe, expect, it, vi } from "vitest";
import { readFileSync } from "fs";
import path from "path";
import { checkViability } from "../src/services/viability.service";
import { parseCoverageKml } from "../src/services/coverage-parser.service";
import { coverageMemoryStore } from "../src/stores/coverage-memory.store";
import { VoalleRepository } from "../src/repositories/voalle.repository";

/**
 * Regra operacional: TODO poligono presente no KML e mancha valida — nomes
 * como "IMPLANTAR - POP VTA" nao sao interpretados como ausencia de
 * viabilidade; o nome e apenas exibido.
 */
const IMPLANTAR_KML = `<?xml version="1.0" encoding="UTF-8"?>
<kml xmlns="http://www.opengis.net/kml/2.2">
  <Document>
    <Folder>
      <name>AREA DE ATENDIMENTO</name>
      <Placemark>
        <name>IMPLANTAR - POP VTA</name>
        <Polygon>
          <outerBoundaryIs><LinearRing><coordinates>
            -44.02,-19.99,0 -44.01,-19.99,0 -44.01,-19.98,0 -44.02,-19.98,0 -44.02,-19.99,0
          </coordinates></LinearRing></outerBoundaryIs>
        </Polygon>
      </Placemark>
    </Folder>
  </Document>
</kml>`;

const POINT_INSIDE_IMPLANTAR = { latitude: -19.985, longitude: -44.015 };

function repoWith(elements: never[]): VoalleRepository & { spy: ReturnType<typeof vi.fn> } {
  const spy = vi.fn().mockResolvedValue(elements);
  return { spy, isConfigured: () => true, findNetworkElementsNearCoordinates: spy };
}

describe("áreas com nomes como IMPLANTAR", () => {
  beforeEach(() => {
    const result = parseCoverageKml(IMPLANTAR_KML, "KML");
    coverageMemoryStore.replaceAll({ ...result, sourceFile: "implantar.kml" });
  });

  it("endereço dentro de 'IMPLANTAR - POP VTA' retorna PRELIMINARILY_VIABLE mesmo sem ponto no Voalle", async () => {
    const repo = repoWith([]);
    const result = await checkViability(POINT_INSIDE_IMPLANTAR, repo);
    expect(result.status).toBe("PRELIMINARILY_VIABLE");
    expect(result.networkReferenceStatus).toBe("NOT_FOUND");
    expect(result.coverage.primaryArea?.name).toBe("IMPLANTAR - POP VTA"); // nome original exibido
    expect(result.nearestNetworkLocation).toBeNull();
  });

  it("ausência de identificadores do Voalle não modifica a viabilidade da mancha", async () => {
    const repo: VoalleRepository = {
      isConfigured: () => true,
      findNetworkElementsNearCoordinates: vi.fn().mockRejectedValue(new Error("sem conexão")),
    };
    const result = await checkViability(POINT_INSIDE_IMPLANTAR, repo);
    expect(result.status).toBe("PRELIMINARILY_VIABLE");
    expect(result.networkReferenceStatus).toBe("VOALLE_UNAVAILABLE");
  });
});

describe("guardas do frontend (regra principal)", () => {
  const read = (relative: string): string =>
    readFileSync(path.join(__dirname, "..", "..", "frontend", "src", relative), "utf-8");

  it("frontend não mostra 'Sem rede próxima' nem status obsoletos como resultado principal", () => {
    for (const file of ["components/ResultPanel.tsx", "App.tsx", "types.ts", "components/MapView.tsx"]) {
      const content = read(file);
      expect(content, file).not.toContain("Sem rede próxima");
      expect(content, file).not.toContain("SEM REDE PRÓXIMA");
      expect(content, file).not.toContain("NO_NEARBY_NETWORK");
      expect(content, file).not.toContain("TECHNICAL_ANALYSIS");
    }
  });

  it("card vermelho (signal-blocked) aparece somente para OUTSIDE_COVERAGE no ResultPanel", () => {
    const content = read("components/ResultPanel.tsx");
    const statusMeta = content.slice(content.indexOf("STATUS_META"), content.indexOf("export default"));
    const entries = [...statusMeta.matchAll(/([A-Z_]+):\s*\{[^}]*\}/g)];
    expect(entries.length).toBeGreaterThan(0);
    for (const [entry, statusName] of entries.map((m) => [m[0], m[1]] as const)) {
      if (entry.includes("signal-blocked")) {
        expect(statusName).toBe("OUTSIDE_COVERAGE");
      }
    }
  });
});
