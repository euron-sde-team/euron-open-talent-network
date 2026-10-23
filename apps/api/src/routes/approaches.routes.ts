/** /api/approaches: a recruiter's structured outreach; the candidate shares contact channels by accepting. */
import { Router } from "express";
import * as ctrl from "../controllers/approach.controller";
import { authenticate } from "../middleware/auth";
import { rateLimit } from "../middleware/rate-limit";

export const router = Router();
router.use(authenticate);

/** Send an approach (ACTIVE recruiters): `{ username, roleTitle, message (30+), jobId?, employmentType?, salary? }`. Quota, cooldown and pending checks: 409/429 APPROACH_*. */
router.post("/", rateLimit("approach-send", 60, 3600), ctrl.create);
/** Approaches you received (`Page<Approach>`), `status` filter. */
router.get("/received", ctrl.received);
/** Approaches you sent as a recruiter (`Page<Approach>`), `status` filter. */
router.get("/sent", ctrl.sent);
/** One approach (`Approach`), for its candidate or its recruiter. */
router.get("/:id", ctrl.get);
/** Mark as seen by the candidate. 204. */
router.post("/:id/viewed", ctrl.viewed);
/** Accept, sharing `{ channels: EMAIL | PHONE | WHATSAPP }`. Opens a conversation. */
router.post("/:id/accept", ctrl.accept);
/** Decline (`{ reason? }`). The recruiter can try again after the cooldown. */
router.post("/:id/decline", ctrl.decline);
/** Decline and block the recruiter. 204. */
router.post("/:id/block", ctrl.block);
/** Take your shared details back (the conversation stays). */
router.post("/:id/revoke", ctrl.revoke);
/** Withdraw a pending approach (recruiter). */
router.post("/:id/withdraw", ctrl.withdraw);
/** Reveal the shared contact details (`ContactReveal`). Logged, and visible to the candidate. */
router.get("/:id/contact", rateLimit("contact-reveal", 120, 3600), ctrl.contact);
