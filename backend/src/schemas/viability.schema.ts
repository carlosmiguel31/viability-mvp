import { z } from "zod";

export const coordinateSchema = z.object({
  latitude: z
    .number({ invalid_type_error: "Latitude deve ser um número." })
    .min(-90, "Latitude deve estar entre -90 e 90.")
    .max(90, "Latitude deve estar entre -90 e 90."),
  longitude: z
    .number({ invalid_type_error: "Longitude deve ser um número." })
    .min(-180, "Longitude deve estar entre -180 e 180.")
    .max(180, "Longitude deve estar entre -180 e 180."),
});

/** Fluxo de desenvolvimento/administrativo: consulta direta por coordenadas. */
export const viabilityCheckCoordinatesSchema = coordinateSchema;

const optionalText = z.string().max(200).optional().nullable();

/** Fluxo principal do operador: consulta por endereco. */
export const viabilityCheckAddressSchema = z.object({
  address: z.object({
    postalCode: z.string().max(20).optional().nullable(),
    street: z.string({ required_error: "Informe a rua." }).min(1).max(200),
    number: z.string({ required_error: "Informe o número." }).min(1).max(20),
    complement: optionalText,
    neighborhood: optionalText,
    city: z.string({ required_error: "Informe a cidade." }).min(1).max(120),
    state: z.string({ required_error: "Informe a UF." }).min(2).max(2),
    country: z.string().max(60).optional(),
  }),
  /**
   * Presente somente quando o operador confirmou/ajustou o marcador no mapa.
   * Usado apenas naquela consulta; dispensa nova geocodificacao.
   */
  locationConfirmationToken: z.string().max(4096).optional(),
  adjustedLocation: coordinateSchema.optional(),
});

export type ViabilityCheckAddressInput = z.infer<typeof viabilityCheckAddressSchema>;
export type ViabilityCheckCoordinatesInput = z.infer<typeof viabilityCheckCoordinatesSchema>;
