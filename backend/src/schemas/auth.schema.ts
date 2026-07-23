import { z } from "zod";

export const loginSchema = z.object({
  email: z.string({ required_error: "Informe o e-mail." }).email("E-mail inválido.").max(200),
  password: z.string({ required_error: "Informe a senha." }).min(1).max(200),
});

const roleSchema = z.enum(["ADMIN", "OPERATOR", "TECHNICIAN", "VIEWER"]);

export const changePasswordSchema = z
  .object({
    currentPassword: z.string({ required_error: "Informe a senha atual." }).min(1).max(200),
    newPassword: z.string({ required_error: "Informe a nova senha." }).min(1).max(200),
    confirmPassword: z.string({ required_error: "Confirme a nova senha." }).min(1).max(200),
  })
  .refine((value) => value.newPassword === value.confirmPassword, {
    message: "A confirmação deve ser igual à nova senha.",
  });

export const createUserSchema = z.object({
  name: z.string({ required_error: "Informe o nome." }).min(2).max(120),
  email: z.string({ required_error: "Informe o e-mail." }).email("E-mail inválido.").max(200),
  password: z.string({ required_error: "Informe a senha inicial." }).min(1).max(200),
  role: roleSchema,
  active: z.boolean().optional(),
});

export const updateUserSchema = z
  .object({
    name: z.string().min(2).max(120).optional(),
    email: z.string().email("E-mail inválido.").max(200).optional(),
    role: roleSchema.optional(),
  })
  .refine((value) => Object.keys(value).length > 0, { message: "Nada para atualizar." });

export const setUserStatusSchema = z.object({
  active: z.boolean({ required_error: "Informe o novo status." }),
  confirmSelfDeactivation: z.boolean().optional(),
});

export const resetPasswordSchema = z.object({
  newPassword: z.string({ required_error: "Informe a nova senha." }).min(1).max(200),
});

export const listUsersQuerySchema = z.object({
  search: z.string().max(200).optional(),
  role: roleSchema.optional(),
  active: z
    .enum(["true", "false"])
    .optional()
    .transform((value) => (value === undefined ? undefined : value === "true")),
  page: z.coerce.number().int().positive().default(1),
  pageSize: z.coerce.number().int().positive().max(100).default(20),
});

export const listAuditLogsQuerySchema = z.object({
  userId: z.string().uuid().optional(),
  action: z.string().max(60).optional(),
  from: z.coerce.date().optional(),
  to: z.coerce.date().optional(),
  page: z.coerce.number().int().positive().default(1),
  pageSize: z.coerce.number().int().positive().max(100).default(20),
});
