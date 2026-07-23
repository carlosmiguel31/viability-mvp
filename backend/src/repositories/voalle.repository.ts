import { getVoallePool } from "../config/database";
import { isVoalleConfigured } from "../config/env";
import { VoalleNetworkElement } from "../types/viability.types";
import { calculateDistanceInMeters, isValidLatitude, isValidLongitude } from "../utils/haversine";
import { VoalleNotConfiguredError, VoalleUnavailableError } from "../utils/errors";
import { compareVoalleIds } from "../utils/voalle-id";
import { logger } from "../utils/logger";

/**
 * ============================================================================
 * REPOSITORIO DO VOALLE — ACESSO EXCLUSIVAMENTE DE LEITURA
 * ============================================================================
 * Elementos de rede consultados na tabela `erp.authentication_splitters`.
 * Tipos reais confirmados: id bigint · title character varying ·
 * lat character varying · lng character varying.
 *
 * Os titulos nao representam apenas splitters (existem tambem ROTA, COLETOR
 * etc.), por isso o modelo se chama VoalleNetworkElement.
 *
 * Como lat/lng sao texto, o SQL valida com regex ANTES do cast para
 * double precision — um valor invalido nunca derruba a consulta. A
 * pre-filtragem usa caixa geografica calculada na aplicacao (sem PostGIS);
 * o filtro final por distancia usa Haversine em memoria. A consulta e
 * parametrizada — coordenadas nunca sao concatenadas na string SQL.
 * ============================================================================
 */

export const VOALLE_TABLE = "erp.authentication_splitters";

const NUMERIC_TEXT_REGEX = "^[+-]?[0-9]+([.][0-9]+)?$";

export const FIND_ELEMENTS_IN_BOUNDING_BOX_SQL = `
SELECT
    id,
    title,
    street,
    number,
    neighborhood,
    city,
    postal_code,
    lat,
    lng
FROM ${VOALLE_TABLE}
WHERE
    active IS TRUE
    AND COALESCE(deleted, FALSE) = FALSE
    AND lat IS NOT NULL
    AND lng IS NOT NULL
    AND btrim(lat) ~ '${NUMERIC_TEXT_REGEX}'
    AND btrim(lng) ~ '${NUMERIC_TEXT_REGEX}'
    AND btrim(lat)::double precision BETWEEN $1 AND $2
    AND btrim(lng)::double precision BETWEEN $3 AND $4
ORDER BY id ASC
`.trim();

const FORBIDDEN_SQL = /\b(insert|update|delete|drop|alter|truncate|create|grant|revoke|copy|vacuum|merge|call|do)\b/i;

/** Garante, na aplicacao, que apenas comandos de leitura sejam executados. */
export function assertReadOnlySql(sql: string): void {
  const trimmed = sql.trim();
  if (!/^(select|with)\b/i.test(trimmed)) {
    throw new Error("READ_ONLY_VIOLATION: apenas comandos SELECT sao permitidos");
  }
  if (FORBIDDEN_SQL.test(trimmed)) {
    throw new Error("READ_ONLY_VIOLATION: comando de escrita detectado");
  }
  const withoutTrailing = trimmed.replace(/;\s*$/, "");
  if (withoutTrailing.includes(";")) {
    throw new Error("READ_ONLY_VIOLATION: multiplas instrucoes nao sao permitidas");
  }
}

export interface BoundingBox {
  minimumLatitude: number;
  maximumLatitude: number;
  minimumLongitude: number;
  maximumLongitude: number;
}

const METERS_PER_DEGREE_LATITUDE = 111_320;
/** Evita divisao por valor ~0 perto dos polos. */
const MIN_COS_LATITUDE = 0.01;

/** Caixa geografica aproximada usada apenas para reduzir os candidatos no SQL. */
export function calculateBoundingBox(
  latitude: number,
  longitude: number,
  radiusMeters: number
): BoundingBox {
  const latitudeDelta = radiusMeters / METERS_PER_DEGREE_LATITUDE;
  const cosLatitude = Math.max(Math.abs(Math.cos((latitude * Math.PI) / 180)), MIN_COS_LATITUDE);
  const longitudeDelta = radiusMeters / (METERS_PER_DEGREE_LATITUDE * cosLatitude);
  return {
    minimumLatitude: Math.max(latitude - latitudeDelta, -90),
    maximumLatitude: Math.min(latitude + latitudeDelta, 90),
    minimumLongitude: Math.max(longitude - longitudeDelta, -180),
    maximumLongitude: Math.min(longitude + longitudeDelta, 180),
  };
}

/** Ordem exigida pela consulta: [minLat, maxLat, minLng, maxLng]. */
export function buildBoundingBoxParams(box: BoundingBox): [number, number, number, number] {
  return [box.minimumLatitude, box.maximumLatitude, box.minimumLongitude, box.maximumLongitude];
}

export interface VoalleElementRow {
  id: number | string;
  /** Filtrados no proprio SQL (active IS TRUE, COALESCE(deleted, FALSE) = FALSE). */
  active?: boolean | null;
  deleted?: boolean | null;
  title: string | null;
  street: string | null;
  number: string | null;
  neighborhood: string | null;
  city: string | null;
  postal_code: string | null;
  lat: string | number | null;
  lng: string | number | null;
}

function textOrNull(value: unknown): string | null {
  if (value === null || value === undefined) return null;
  const text = String(value).trim();
  return text === "" ? null : text;
}

/**
 * Converte uma linha bruta em VoalleNetworkElement.
 * Retorna null (registro ignorado individualmente) quando: lat/lng nulos,
 * vazios, nao numericos, fora dos limites geograficos ou o par 0,0.
 */
export function parseVoalleElementRow(row: VoalleElementRow): VoalleNetworkElement | null {
  const rawLat = typeof row.lat === "string" ? row.lat.trim() : row.lat;
  const rawLng = typeof row.lng === "string" ? row.lng.trim() : row.lng;
  if (rawLat === null || rawLat === undefined || rawLat === "") return null;
  if (rawLng === null || rawLng === undefined || rawLng === "") return null;

  const latitude = Number(rawLat);
  const longitude = Number(rawLng);
  if (!isValidLatitude(latitude) || !isValidLongitude(longitude)) return null;
  if (latitude === 0 && longitude === 0) return null;

  const title = textOrNull(row.title);
  if (!title) return null;

  // id e bigint: NUNCA converter com Number (perda de precisao). O driver pg
  // ja entrega como string; validamos a existencia e mantemos como string.
  const id = row.id === null || row.id === undefined ? "" : String(row.id).trim();
  if (id === "") return null;

  return {
    id,
    title,
    street: textOrNull(row.street),
    addressNumber: textOrNull(row.number),
    neighborhood: textOrNull(row.neighborhood),
    city: textOrNull(row.city),
    postalCode: textOrNull(row.postal_code),
    latitude,
    longitude,
  };
}

/** Filtro final por distancia real (Haversine), ordenado do mais proximo. */
export function filterAndSortByDistance(
  elements: VoalleNetworkElement[],
  latitude: number,
  longitude: number,
  radiusMeters: number
): VoalleNetworkElement[] {
  return elements
    .map((element) => ({
      element,
      distance: calculateDistanceInMeters(latitude, longitude, element.latitude, element.longitude),
    }))
    .filter((item) => item.distance <= radiusMeters)
    .sort((a, b) => a.distance - b.distance || compareVoalleIds(a.element.id, b.element.id))
    .map((item) => item.element);
}

export type SelectRunner = (sql: string, params: unknown[]) => Promise<unknown[]>;

async function defaultSelectRunner(sql: string, params: unknown[]): Promise<unknown[]> {
  if (!isVoalleConfigured()) throw new VoalleNotConfiguredError();
  assertReadOnlySql(sql);
  const startedAt = Date.now();
  try {
    const result = await getVoallePool().query(sql, params);
    logger.info("Consulta ao Voalle executada", {
      rows: result.rowCount,
      durationMs: Date.now() - startedAt,
    });
    return result.rows;
  } catch (err) {
    // Mensagens internas do PostgreSQL nunca chegam ao frontend.
    const message = err instanceof Error ? err.message : "erro desconhecido";
    logger.error("Falha na consulta ao Voalle", { message });
    throw new VoalleUnavailableError();
  }
}

export interface VoalleRepository {
  isConfigured(): boolean;
  findNetworkElementsNearCoordinates(
    latitude: number,
    longitude: number,
    radiusMeters: number
  ): Promise<VoalleNetworkElement[]>;
}

export class PgVoalleRepository implements VoalleRepository {
  constructor(private readonly runSelect: SelectRunner = defaultSelectRunner) {}

  isConfigured(): boolean {
    return isVoalleConfigured();
  }

  async findNetworkElementsNearCoordinates(
    latitude: number,
    longitude: number,
    radiusMeters: number
  ): Promise<VoalleNetworkElement[]> {
    const box = calculateBoundingBox(latitude, longitude, radiusMeters);
    const rows = (await this.runSelect(
      FIND_ELEMENTS_IN_BOUNDING_BOX_SQL,
      buildBoundingBoxParams(box)
    )) as VoalleElementRow[];

    const parsed = rows
      .map((row) => parseVoalleElementRow(row))
      .filter((element): element is VoalleNetworkElement => element !== null);

    return filterAndSortByDistance(parsed, latitude, longitude, radiusMeters);
  }
}

export const voalleRepository: VoalleRepository = new PgVoalleRepository();
