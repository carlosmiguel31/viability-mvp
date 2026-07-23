import { Router } from "express";
import { postalCodeLookupHandler } from "../controllers/address.controller";
import { requireAuth } from "../middlewares/auth.middleware";

export const addressRoutes = Router();

addressRoutes.get("/postal-code/:cep", requireAuth, postalCodeLookupHandler);
