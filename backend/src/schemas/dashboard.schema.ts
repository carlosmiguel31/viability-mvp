import { z } from "zod";

const DATE = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Data inválida (AAAA-MM-DD).");

export const dashboardFiltersSchema = z.object({
  preset: z
    .enum(["TODAY", "LAST_7_DAYS", "LAST_30_DAYS", "CURRENT_MONTH", "PREVIOUS_MONTH", "CUSTOM"])
    .optional(),
  dateFrom: DATE.optional(),
  dateTo: DATE.optional(),
  userId: z.string().uuid().optional(),
  status: z.string().max(40).optional(),
  city: z.string().max(120).optional(),
  state: z.string().max(2).optional(),
  partnerCode: z.string().max(60).optional(),
  layerId: z.string().max(60).optional(),
});

export const dashboardTimelineSchema = dashboardFiltersSchema.extend({
  granularity: z.enum(["DAY", "WEEK", "MONTH"]).optional(),
});

export const dashboardLimitSchema = dashboardFiltersSchema.extend({
  limit: z.coerce.number().int().positive().max(25).optional(),
});

export const dashboardUsersSchema = z.object({
  search: z.string().max(120).optional(),
  page: z.coerce.number().int().positive().optional(),
  limit: z.coerce.number().int().positive().max(100).optional(),
});
