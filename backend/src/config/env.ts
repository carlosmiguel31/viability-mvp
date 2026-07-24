import dotenv from "dotenv";
import { z } from "zod";
import { isValidIanaTimeZone } from "../utils/timezone";

dotenv.config();

const envSchema = z
  .object({
    PORT: z.coerce.number().int().positive().default(3001),
    NODE_ENV: z.enum(["development", "test", "production"]).default("development"),

    NETWORK_COVERAGE_PATH: z.string().default("./data/rede-neutra-mancha-demo.kml"),

    VOALLE_DB_HOST: z.string().optional().default(""),
    VOALLE_DB_PORT: z.coerce.number().int().positive().default(5432),
    VOALLE_DB_NAME: z.string().optional().default(""),
    VOALLE_DB_USER: z.string().optional().default(""),
    VOALLE_DB_PASSWORD: z.string().optional().default(""),
    VOALLE_DB_SSL: z
      .string()
      .optional()
      .default("false")
      .transform((v) => v.toLowerCase() === "true"),
    VOALLE_DB_CONNECTION_TIMEOUT_MS: z.coerce.number().int().positive().default(5000),
    VOALLE_DB_QUERY_TIMEOUT_MS: z.coerce.number().int().positive().default(8000),

    /**
     * Raio usado APENAS para procurar referencias de rede proximas no Voalle.
     * NAO determina viabilidade: a viabilidade preliminar e definida
     * exclusivamente pela mancha KML/KMZ.
     */
    NETWORK_REFERENCE_SEARCH_RADIUS_METERS: z.coerce.number().positive().default(300),
    MAX_NETWORK_ALTERNATIVES: z.coerce.number().int().positive().default(5),

    MAX_KMZ_COMPRESSED_BYTES: z.coerce.number().int().positive().default(52_428_800),
    MAX_KMZ_UNCOMPRESSED_BYTES: z.coerce.number().int().positive().default(104_857_600),
    MAX_KMZ_ENTRIES: z.coerce.number().int().positive().default(500),
    MAX_KML_BYTES: z.coerce.number().int().positive().default(52_428_800),

    CORS_ALLOWED_ORIGINS: z.string().optional().default("http://localhost:5173"),

    /** Historico de consultas (v0.4.0). */
    CONSULTATION_EXPORT_MAX_ROWS: z.coerce.number().int().positive().default(10000),
    CONSULTATION_RETENTION_DAYS: z.coerce.number().int().positive().default(365),
    /** Fuso IANA usado para interpretar dateFrom/dateTo do historico. */
    CONSULTATION_TIME_ZONE: z
      .string()
      .default("America/Sao_Paulo")
      .refine(isValidIanaTimeZone, "CONSULTATION_TIME_ZONE deve ser um fuso IANA válido."),
    /** Dashboard (v0.5.0). */
    DASHBOARD_MAX_RANGE_DAYS: z.coerce.number().int().positive().default(730),

    /** Assinatura dos tokens de confirmacao de localizacao (>= 32 chars). */
    LOCATION_CONFIRMATION_SECRET: z
      .string()
      .min(32, "LOCATION_CONFIRMATION_SECRET deve ter no mínimo 32 caracteres."),

    /** Armazenamento dos arquivos KML/KMZ das camadas (fora do banco). */
    COVERAGE_STORAGE_PATH: z.string().default("./storage/coverage"),
    COVERAGE_MAX_FILE_SIZE_MB: z.coerce.number().int().positive().max(200).default(25),

    /** Banco DA APLICACAO (leitura e escrita): usuarios, sessoes, auditoria. */
    APP_DATABASE_URL: z.string().optional().default(""),

    /**
     * Segredos JWT: obrigatorios e com tamanho minimo de 32 caracteres.
     * Nunca use valores padrao ou fracos; gere com openssl rand -hex 32.
     */
    JWT_ACCESS_SECRET: z.string().optional().default(""),
    JWT_REFRESH_SECRET: z.string().optional().default(""),
    JWT_ACCESS_EXPIRES_IN: z.string().default("15m"),
    JWT_REFRESH_EXPIRES_IN: z.string().default("7d"),
    BCRYPT_ROUNDS: z.coerce.number().int().min(4).max(15).default(12), // min 4 apenas para testes; use >= 12 em producao

    /** Cookie do refresh token: "auto" liga Secure fora de development. */
    COOKIE_SECURE: z.enum(["auto", "true", "false"]).default("auto"),

    SEED_ADMIN_NAME: z.string().optional().default(""),
    SEED_ADMIN_EMAIL: z.string().optional().default(""),
    SEED_ADMIN_PASSWORD: z.string().optional().default(""),

    /** Provider de geocodificacao: "google" (producao) ou "dev" (desenvolvimento). */
    GEOCODING_PROVIDER: z.enum(["google", "dev"]).default("google"),
    GOOGLE_GEOCODING_API_KEY: z.string().optional().default(""),
    GEOCODING_TIMEOUT_MS: z.coerce.number().int().positive().default(5000),
    /**
     * Somente para o provider "dev": coordenada fixa retornada com confianca
     * LOW e partialMatch=true, forcando a confirmacao no mapa. Nunca usado
     * silenciosamente em producao.
     */
    DEV_GEOCODING_FIXED_LAT: z.coerce.number().optional(),
    DEV_GEOCODING_FIXED_LNG: z.coerce.number().optional(),

    POSTAL_CODE_TIMEOUT_MS: z.coerce.number().int().positive().default(5000),

    /**
     * Padrao (regex) dos identificadores de rede exibidos ao operador,
     * ex.: BHZ-C0016-RT10-CT03_2780. Configuravel sem mudar o codigo.
     */
    NETWORK_IDENTIFIER_PATTERN: z
      .string()
      .optional()
      .default("^[A-Z0-9]+-C[0-9]+-RT[0-9]+-CT[0-9]+_[0-9]+$"),

    /**
     * Atras de proxy reverso (Nginx/Cloudflare), habilite explicitamente para
     * o Express e o rate limiting enxergarem o IP real. Aceita:
     * "false" (padrao, desabilitado), "true" (1 salto) ou um numero de saltos.
     * Nunca e habilitado de forma irrestrita por padrao.
     */
    TRUST_PROXY: z
      .string()
      .optional()
      .default("false")
      .transform((v): number | false => {
        const value = v.trim().toLowerCase();
        if (value === "true") return 1;
        const hops = Number(value);
        if (Number.isInteger(hops) && hops > 0) return hops;
        return false;
      }),
  });

export type Env = z.infer<typeof envSchema>;

const MIN_SECRET_LENGTH = 32;

export const env: Env = envSchema
  .superRefine((value, ctx) => {
    // Sem autenticacao segura nao ha aplicacao: falhar cedo e com clareza.
    for (const key of ["JWT_ACCESS_SECRET", "JWT_REFRESH_SECRET"] as const) {
      const secret = value[key];
      if (!secret || secret.length < MIN_SECRET_LENGTH) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: `${key} deve estar configurado com pelo menos ${MIN_SECRET_LENGTH} caracteres (ex.: openssl rand -hex 32).`,
        });
      }
    }
    if (value.JWT_ACCESS_SECRET && value.JWT_ACCESS_SECRET === value.JWT_REFRESH_SECRET) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "JWT_ACCESS_SECRET e JWT_REFRESH_SECRET devem ser diferentes.",
      });
    }
    if (!value.APP_DATABASE_URL) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "APP_DATABASE_URL deve apontar para o banco da aplicacao.",
      });
    }
  })
  .parse(process.env);

/** O Voalle so e considerado configurado quando todas as credenciais existem. */
export function isVoalleConfigured(): boolean {
  return Boolean(
    env.VOALLE_DB_HOST && env.VOALLE_DB_NAME && env.VOALLE_DB_USER && env.VOALLE_DB_PASSWORD
  );
}
