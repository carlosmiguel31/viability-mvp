import { CoverageArea } from "../types/coverage.types";

/**
 * Camada de cobertura carregada em memoria: areas/poligonos + metadados do
 * parceiro. O snapshot e a fonte usada pelas consultas de viabilidade.
 */
export interface CoverageSnapshotLayer {
  layerId: string;
  layerName: string;
  partnerId: string;
  partnerName: string;
  partnerCode: string;
  version: string | null;
  areas: CoverageArea[];
  polygonCount: number;
}

export interface CoverageSnapshotStatus {
  configured: boolean;
  builtAt: string | null;
  totalPartners: number;
  totalLayers: number;
  totalAreas: number;
  totalPolygons: number;
  // Campos de compatibilidade com o frontend atual (v0.2.x):
  loaded: boolean;
  sourceFile: string | null;
}

/**
 * Snapshot ATOMICO das camadas ativas: o array so e substituido inteiro
 * (replaceAll) apos a nova montagem ser validada. Consultas em andamento
 * seguem lendo a referencia anterior; nunca ha estado parcialmente
 * carregado nem intervalo sem cobertura durante a troca.
 */
class CoverageSnapshotStore {
  private layers: CoverageSnapshotLayer[] = [];
  private builtAt: Date | null = null;

  replaceAll(layers: CoverageSnapshotLayer[]): void {
    this.layers = layers;
    this.builtAt = new Date();
  }

  clear(): void {
    this.layers = [];
    this.builtAt = null;
  }

  /** Ha pelo menos uma camada ativa e pronta carregada? */
  isConfigured(): boolean {
    return this.layers.length > 0;
  }

  getLayers(): ReadonlyArray<CoverageSnapshotLayer> {
    return this.layers;
  }

  getStatus(): CoverageSnapshotStatus {
    const totalAreas = this.layers.reduce((sum, layer) => sum + layer.areas.length, 0);
    const totalPolygons = this.layers.reduce((sum, layer) => sum + layer.polygonCount, 0);
    const partnerIds = new Set(this.layers.map((layer) => layer.partnerId));
    return {
      configured: this.layers.length > 0,
      builtAt: this.builtAt ? this.builtAt.toISOString() : null,
      totalPartners: partnerIds.size,
      totalLayers: this.layers.length,
      totalAreas,
      totalPolygons,
      loaded: this.layers.length > 0,
      sourceFile:
        this.layers.length === 0
          ? null
          : this.layers.length === 1
            ? this.layers[0].layerName
            : `${this.layers.length} camadas ativas`,
    };
  }
}

export const coverageSnapshotStore = new CoverageSnapshotStore();
