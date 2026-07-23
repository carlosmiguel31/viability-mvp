import { CoverageArea, CoverageMemoryState } from "../types/coverage.types";

/**
 * Store singleton em memoria para as manchas de cobertura do KML/KMZ.
 * Nada e persistido em banco ou disco: ao reiniciar o backend, o arquivo
 * e reprocessado do zero. A troca de estado e atomica (replaceAll so e
 * chamado apos a validacao completa da nova carga).
 */
class CoverageMemoryStore {
  private state: CoverageMemoryState = {
    loaded: false,
    loadedAt: null,
    sourceFile: null,
    areas: [],
    totalPolygons: 0,
    ignoredPoints: 0,
    ignoredLines: 0,
    rejectedGeometries: 0,
  };

  replaceAll(input: {
    areas: CoverageArea[];
    sourceFile: string;
    totalPolygons: number;
    ignoredPoints: number;
    ignoredLines: number;
    rejectedGeometries: number;
  }): void {
    this.state = {
      loaded: true,
      loadedAt: new Date(),
      sourceFile: input.sourceFile,
      areas: input.areas,
      totalPolygons: input.totalPolygons,
      ignoredPoints: input.ignoredPoints,
      ignoredLines: input.ignoredLines,
      rejectedGeometries: input.rejectedGeometries,
    };
  }

  isLoaded(): boolean {
    return this.state.loaded;
  }

  getAreas(): ReadonlyArray<CoverageArea> {
    return this.state.areas;
  }

  getStatus(): {
    loaded: boolean;
    loadedAt: string | null;
    sourceFile: string | null;
    totalAreas: number;
    totalPolygons: number;
    ignoredPoints: number;
    ignoredLines: number;
    rejectedGeometries: number;
  } {
    return {
      loaded: this.state.loaded,
      loadedAt: this.state.loadedAt ? this.state.loadedAt.toISOString() : null,
      sourceFile: this.state.sourceFile,
      totalAreas: this.state.areas.length,
      totalPolygons: this.state.totalPolygons,
      ignoredPoints: this.state.ignoredPoints,
      ignoredLines: this.state.ignoredLines,
      rejectedGeometries: this.state.rejectedGeometries,
    };
  }

  clear(): void {
    this.state = {
      loaded: false,
      loadedAt: null,
      sourceFile: null,
      areas: [],
      totalPolygons: 0,
      ignoredPoints: 0,
      ignoredLines: 0,
      rejectedGeometries: 0,
    };
  }
}

export const coverageMemoryStore = new CoverageMemoryStore();
