import { NextFunction, Request, Response } from "express";
import {
  createUserSchema,
  listAuditLogsQuerySchema,
  listUsersQuerySchema,
  resetPasswordSchema,
  setUserStatusSchema,
  updateUserSchema,
} from "../schemas/auth.schema";
import * as userService from "../services/user.service";
import { prisma } from "../db/prisma";
import { AppError } from "../utils/errors";
import { ZodError } from "zod";

function validationError(err: ZodError): AppError {
  return new AppError("VALIDATION_ERROR", err.errors[0]?.message ?? "Dados inválidos.", 400);
}

function actor(req: Request): { id: string } {
  return { id: req.user!.id };
}

function ip(req: Request): string | null {
  return req.ip ?? null;
}

export async function createUserHandler(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const parsed = createUserSchema.safeParse(req.body);
    if (!parsed.success) return next(validationError(parsed.error));
    const user = await userService.createUser(parsed.data, actor(req), ip(req));
    res.status(201).json({ user });
  } catch (err) {
    next(err);
  }
}

export async function listUsersHandler(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const parsed = listUsersQuerySchema.safeParse(req.query);
    if (!parsed.success) return next(validationError(parsed.error));
    res.status(200).json(await userService.listUsers(parsed.data));
  } catch (err) {
    next(err);
  }
}

export async function getUserHandler(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    res.status(200).json({ user: await userService.getUser(String(req.params.id)) });
  } catch (err) {
    next(err);
  }
}

export async function updateUserHandler(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const parsed = updateUserSchema.safeParse(req.body);
    if (!parsed.success) return next(validationError(parsed.error));
    const user = await userService.updateUser(String(req.params.id), parsed.data, actor(req), ip(req));
    res.status(200).json({ user });
  } catch (err) {
    next(err);
  }
}

export async function setUserStatusHandler(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const parsed = setUserStatusSchema.safeParse(req.body);
    if (!parsed.success) return next(validationError(parsed.error));
    const user = await userService.setUserStatus(
      String(req.params.id),
      parsed.data.active,
      { confirmSelfDeactivation: parsed.data.confirmSelfDeactivation },
      actor(req),
      ip(req)
    );
    res.status(200).json({ user });
  } catch (err) {
    next(err);
  }
}

export async function resetPasswordHandler(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const parsed = resetPasswordSchema.safeParse(req.body);
    if (!parsed.success) return next(validationError(parsed.error));
    await userService.resetUserPassword(String(req.params.id), parsed.data.newPassword, actor(req), ip(req));
    res.status(204).send();
  } catch (err) {
    next(err);
  }
}

export async function listAuditLogsHandler(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const parsed = listAuditLogsQuerySchema.safeParse(req.query);
    if (!parsed.success) return next(validationError(parsed.error));
    const { userId, action, from, to, page, pageSize } = parsed.data;
    const where = {
      ...(userId ? { userId } : {}),
      ...(action ? { action } : {}),
      ...(from || to
        ? { createdAt: { ...(from ? { gte: from } : {}), ...(to ? { lte: to } : {}) } }
        : {}),
    };
    const [total, logs] = await Promise.all([
      prisma.auditLog.count({ where }),
      prisma.auditLog.findMany({
        where,
        orderBy: { createdAt: "desc" },
        skip: (page - 1) * pageSize,
        take: pageSize,
        include: { user: { select: { id: true, name: true, email: true } } },
      }),
    ]);
    res.status(200).json({ logs, total, page, pageSize });
  } catch (err) {
    next(err);
  }
}
