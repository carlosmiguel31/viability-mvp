import { z } from "zod";

export const createPartnerSchema = z.object({
  name: z.string({ required_error: "Informe o nome do parceiro." }).min(2).max(120),
  code: z
    .string({ required_error: "Informe o código do parceiro." })
    .min(2)
    .max(40)
    .regex(/^[A-Za-z0-9_-]+$/, "O código aceita apenas letras, números, hífen e sublinhado."),
  description: z.string().max(500).optional(),
  active: z.boolean().optional(),
});

export const updatePartnerSchema = z
  .object({
    name: z.string().min(2).max(120).optional(),
    code: z
      .string()
      .min(2)
      .max(40)
      .regex(/^[A-Za-z0-9_-]+$/, "O código aceita apenas letras, números, hífen e sublinhado.")
      .optional(),
    description: z.string().max(500).nullable().optional(),
  })
  .refine((value) => Object.keys(value).length > 0, { message: "Nada para atualizar." });

export const statusSchema = z.object({
  active: z.boolean({ required_error: "Informe o novo status." }),
});

export const listPartnersQuerySchema = z.object({
  search: z.string().max(120).optional(),
  active: z
    .enum(["true", "false"])
    .optional()
    .transform((value) => (value === undefined ? undefined : value === "true")),
  page: z.coerce.number().int().positive().default(1),
  limit: z.coerce.number().int().positive().max(100).default(20),
});

export const createLayerFieldsSchema = z.object({
  partnerId: z.string({ required_error: "Informe o parceiro." }).uuid("partnerId inválido."),
  name: z.string({ required_error: "Informe o nome da camada." }).min(2).max(120),
  description: z.string().max(500).optional(),
  version: z.string().max(60).optional(),
  active: z
    .enum(["true", "false"])
    .optional()
    .transform((value) => (value === undefined ? undefined : value === "true")),
});

export const updateLayerSchema = z
  .object({
    name: z.string().min(2).max(120).optional(),
    description: z.string().max(500).nullable().optional(),
    version: z.string().max(60).nullable().optional(),
  })
  .refine((value) => Object.keys(value).length > 0, { message: "Nada para atualizar." });

export const listLayersQuerySchema = z.object({
  search: z.string().max(120).optional(),
  partnerId: z.string().uuid().optional(),
  active: z
    .enum(["true", "false"])
    .optional()
    .transform((value) => (value === undefined ? undefined : value === "true")),
  processingStatus: z.enum(["PENDING", "PROCESSING", "READY", "FAILED"]).optional(),
  fileType: z.enum(["KML", "KMZ"]).optional(),
  page: z.coerce.number().int().positive().default(1),
  limit: z.coerce.number().int().positive().max(100).default(20),
});
