import { z } from "zod";
import { isValidCalendarDate } from "../utils/timezone";

const calendarDate = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, "Use o formato AAAA-MM-DD.")
  .refine(isValidCalendarDate, "Data de calendário inválida.");

const version = z.number().int().nonnegative();

export const reviewCreateSchema = z.object({
  consultationId: z.string().uuid(),
  priority: z.enum(["LOW", "NORMAL", "HIGH", "URGENT"]).optional(),
  assignedToId: z.string().uuid().nullable().optional(),
  note: z.string().max(3000).optional(),
});

export const reviewUpdateSchema = z
  .object({
    status: z.enum(["OPEN", "IN_PROGRESS", "WAITING_INFORMATION", "APPROVED", "REJECTED", "CANCELLED"]).optional(),
    priority: z.enum(["LOW", "NORMAL", "HIGH", "URGENT"]).optional(),
    dueAt: z.string().datetime().nullable().optional(),
    version,
  })
  .refine(
    (value) =>
      value.status !== undefined || value.priority !== undefined || value.dueAt !== undefined,
    "Nenhuma alteração foi informada."
  );

export const reviewClaimSchema = z.object({ version });

export const reviewAssigneesSchema = z.object({
  search: z.string().max(120).optional(),
  limit: z.coerce.number().int().positive().max(100).optional(),
});

export const reviewAssignmentSchema = z.object({
  assignedToId: z.string().uuid().nullable(),
  version,
});

export const reviewNoteSchema = z.object({
  note: z
    .string()
    .min(1)
    .max(3000)
    .refine((value) => value.trim().length > 0, "A observação não pode conter apenas espaços."),
  version,
});

export const reviewResolveSchema = z.object({
  decision: z.enum(["APPROVED", "REJECTED"]),
  resolutionCode: z
    .string()
    .min(1)
    .max(60)
    .regex(/^[A-Z0-9_]+$/, "Use letras maiúsculas, números e underscore."),
  resolutionSummary: z
    .string()
    .min(1)
    .max(2000)
    .refine((value) => value.trim().length > 0, "O resumo é obrigatório."),
  version,
});

export const reviewReopenSchema = z.object({
  version,
  note: z.string().max(3000).optional(),
});

export const reviewListSchema = z.object({
  search: z.string().max(120).optional(),
  protocol: z.string().max(30).optional(),
  status: z.enum(["OPEN", "IN_PROGRESS", "WAITING_INFORMATION", "APPROVED", "REJECTED", "CANCELLED"]).optional(),
  priority: z.enum(["LOW", "NORMAL", "HIGH", "URGENT"]).optional(),
  assignedToId: z.string().uuid().optional(),
  openedById: z.string().uuid().optional(),
  city: z.string().max(120).optional(),
  state: z.string().max(2).optional(),
  overdue: z.enum(["true", "false"]).optional().transform((value) => value === "true"),
  unassigned: z.enum(["true", "false"]).optional().transform((value) => value === "true"),
  dateFrom: calendarDate.optional(),
  dateTo: calendarDate.optional(),
  dueFrom: calendarDate.optional(),
  dueTo: calendarDate.optional(),
  page: z.coerce.number().int().positive().optional(),
  limit: z.coerce.number().int().positive().max(100).optional(),
  sortBy: z.enum(["createdAt", "updatedAt", "dueAt", "priority", "status"]).optional(),
  sortOrder: z.enum(["asc", "desc"]).optional(),
})
  // Comparação lexicográfica é suficiente em AAAA-MM-DD.
  .refine((filters) => !(filters.dateFrom && filters.dateTo && filters.dateFrom > filters.dateTo), {
    message: "O período inicial não pode ser posterior ao período final.",
  })
  .refine((filters) => !(filters.dueFrom && filters.dueTo && filters.dueFrom > filters.dueTo), {
    message: "O período inicial não pode ser posterior ao período final.",
  });
