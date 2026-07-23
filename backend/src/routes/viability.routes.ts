import { Router } from "express";
import {
  checkViabilityByAddressHandler,
  checkViabilityByCoordinatesHandler,
} from "../controllers/viability.controller";
import { requireAuth, requireRoles } from "../middlewares/auth.middleware";
import { env } from "../config/env";

export const viabilityRoutes = Router();

// Consulta de viabilidade: qualquer perfil autenticado
// (OPERATOR, TECHNICIAN, VIEWER e ADMIN).
viabilityRoutes.post("/check", requireAuth, checkViabilityByAddressHandler);

// Confirmacao/ajuste da localizacao no mapa: mesmo fluxo do /check com
// adjustedLocation obrigatorio no corpo (alias explicito para o frontend).
viabilityRoutes.post("/confirm-location", requireAuth, checkViabilityByAddressHandler);

// Consulta direta por coordenadas: ferramenta de desenvolvimento.
// Em development basta estar autenticado; fora dele, somente ADMIN.
const coordinateGuards =
  env.NODE_ENV === "development" ? [requireAuth] : [requireAuth, requireRoles("ADMIN")];
viabilityRoutes.post("/check-coordinates", ...coordinateGuards, checkViabilityByCoordinatesHandler);
