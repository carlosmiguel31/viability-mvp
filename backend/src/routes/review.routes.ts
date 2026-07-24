import { Router } from "express";
import rateLimit from "express-rate-limit";
import {
  addReviewNoteHandler,
  assignReviewHandler,
  claimReviewHandler,
  createReviewHandler,
  getReviewByConsultationHandler,
  getReviewHandler,
  listReviewAssigneesHandler,
  listReviewsHandler,
  reopenReviewHandler,
  resolveReviewHandler,
  reviewsSummaryHandler,
  updateReviewHandler,
} from "../controllers/review.controller";
import { requireAuth } from "../middlewares/auth.middleware";

export const reviewRoutes = Router();

const reviewLimiter = rateLimit({
  windowMs: 60 * 1000,
  limit: 120,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: { code: "RATE_LIMITED", message: "Muitas requisições à fila de análises." } },
});

// Sem DELETE e sem edição/exclusão de eventos: a linha do tempo é imutável.
reviewRoutes.use(requireAuth, reviewLimiter);
reviewRoutes.post("/", createReviewHandler);
reviewRoutes.get("/", listReviewsHandler);
reviewRoutes.get("/summary", reviewsSummaryHandler); // antes de /:id
reviewRoutes.get("/assignees", listReviewAssigneesHandler); // antes de /:id
reviewRoutes.get("/by-consultation/:consultationId", getReviewByConsultationHandler); // antes de /:id
reviewRoutes.get("/:id", getReviewHandler);
reviewRoutes.patch("/:id", updateReviewHandler);
reviewRoutes.patch("/:id/assignment", assignReviewHandler);
reviewRoutes.post("/:id/claim", claimReviewHandler);
reviewRoutes.post("/:id/notes", addReviewNoteHandler);
reviewRoutes.post("/:id/resolve", resolveReviewHandler);
reviewRoutes.post("/:id/reopen", reopenReviewHandler);
