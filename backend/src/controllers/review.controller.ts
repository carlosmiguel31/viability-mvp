import { NextFunction, Request, Response } from "express";
import { ZodSchema } from "zod";
import {
  addReviewNote,
  assignReview,
  claimReview,
  createReview,
  getReviewByConsultation,
  getReviewDetails,
  listReviewAssignees,
  listReviews,
  reopenReview,
  resolveReview,
  ReviewActor,
  reviewsSummary,
  updateReview,
} from "../services/review.service";
import {
  reviewAssigneesSchema,
  reviewAssignmentSchema,
  reviewClaimSchema,
  reviewCreateSchema,
  reviewListSchema,
  reviewNoteSchema,
  reviewReopenSchema,
  reviewResolveSchema,
  reviewUpdateSchema,
} from "../schemas/review.schema";
import { AppError } from "../utils/errors";
import { logger } from "../utils/logger";
import type { UserRole } from "../generated/prisma/client";

function actor(req: Request): ReviewActor {
  // O ator é SEMPRE o usuário autenticado — nunca um userId do corpo.
  return { id: req.user!.id, role: req.user!.role as UserRole };
}

/** Falhas inesperadas viram REVIEW_QUERY_FAILED sem detalhes internos. */
function toReviewError(err: unknown, endpoint: string): unknown {
  if (err instanceof AppError) return err;
  logger.error("Falha inesperada na fila de análises", { endpoint });
  return new AppError(
    "REVIEW_QUERY_FAILED",
    "Não foi possível processar a análise técnica.",
    500
  );
}

function parseBody<T>(schema: ZodSchema<T>, req: Request): T {
  const parsed = schema.safeParse(req.body);
  if (!parsed.success) {
    throw new AppError(
      "REVIEW_INVALID_FILTER",
      parsed.error.errors[0]?.message ?? "Dados inválidos.",
      400
    );
  }
  return parsed.data;
}

type Handler = (req: Request) => Promise<unknown>;

function wrap(endpoint: string, handler: Handler, status = 200) {
  return async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const payload = await handler(req).catch((err) => {
        throw toReviewError(err, endpoint);
      });
      res.status(status).json(payload);
    } catch (err) {
      next(err);
    }
  };
}

export const createReviewHandler = wrap(
  "create",
  async (req) => ({ review: await createReview(parseBody(reviewCreateSchema, req), actor(req)) }),
  201
);

export const listReviewsHandler = wrap("list", async (req) => {
  const parsed = reviewListSchema.safeParse(req.query);
  if (!parsed.success) {
    throw new AppError(
      "REVIEW_INVALID_FILTER",
      parsed.error.errors[0]?.message ?? "Filtros inválidos.",
      400
    );
  }
  return listReviews(parsed.data, actor(req));
});

export const reviewsSummaryHandler = wrap("summary", async (req) => reviewsSummary(actor(req)));

export const getReviewHandler = wrap("details", async (req) => ({
  review: await getReviewDetails(req.params.id, actor(req)),
}));

export const updateReviewHandler = wrap("update", async (req) => ({
  review: await updateReview(req.params.id, parseBody(reviewUpdateSchema, req), actor(req)),
}));

export const assignReviewHandler = wrap("assignment", async (req) => ({
  review: await assignReview(req.params.id, parseBody(reviewAssignmentSchema, req), actor(req)),
}));

export const claimReviewHandler = wrap("claim", async (req) => ({
  review: await claimReview(req.params.id, parseBody(reviewClaimSchema, req), actor(req)),
}));

export const getReviewByConsultationHandler = wrap("by-consultation", async (req) => ({
  review: await getReviewByConsultation(req.params.consultationId, actor(req)),
}));

export const listReviewAssigneesHandler = wrap("assignees", async (req) => {
  const parsed = reviewAssigneesSchema.safeParse(req.query);
  if (!parsed.success) {
    throw new AppError(
      "REVIEW_INVALID_FILTER",
      parsed.error.errors[0]?.message ?? "Filtros inválidos.",
      400
    );
  }
  return listReviewAssignees(parsed.data, actor(req));
});

export const addReviewNoteHandler = wrap("notes", async (req) => ({
  review: await addReviewNote(req.params.id, parseBody(reviewNoteSchema, req), actor(req)),
}));

export const resolveReviewHandler = wrap("resolve", async (req) => ({
  review: await resolveReview(req.params.id, parseBody(reviewResolveSchema, req), actor(req)),
}));

export const reopenReviewHandler = wrap("reopen", async (req) => ({
  review: await reopenReview(req.params.id, parseBody(reviewReopenSchema, req), actor(req)),
}));
