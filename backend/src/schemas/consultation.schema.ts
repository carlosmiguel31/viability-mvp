import { z } from "zod";

export const listConsultationsQuerySchema = z.object({
  search: z.string().max(120).optional(),
  protocol: z.string().max(30).optional(),
  status: z.string().max(40).optional(),
  userId: z.string().uuid().optional(),
  postalCode: z.string().max(12).optional(),
  city: z.string().max(120).optional(),
  state: z.string().max(2).optional(),
  dateFrom: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/, "Data inicial inválida (AAAA-MM-DD).")
    .optional(),
  dateTo: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/, "Data final inválida (AAAA-MM-DD).")
    .optional(),
  hasCoverage: z
    .enum(["true", "false"])
    .optional()
    .transform((value) => (value === undefined ? undefined : value === "true")),
  networkReferenceStatus: z.string().max(30).optional(),
  page: z.coerce.number().int().positive().default(1),
  limit: z.coerce.number().int().positive().max(100).default(20),
  sortOrder: z.enum(["asc", "desc"]).default("desc"),
});
