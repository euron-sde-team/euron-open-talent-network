/** /api/meta: public network facts (name, registration mode) for page titles and the sign-up form. */
import { Router } from "express";
import * as ctrl from "../controllers/meta.controller";

export const router = Router();

/** `NetworkMeta`: `{ networkName, registration }`. Public; cached 30 seconds. */
router.get("/", ctrl.meta);

/** Public paths for the sitemap: `?type=profiles|companies|jobs&cursor=`, 1000 per page. */
router.get("/sitemap", ctrl.sitemap);
