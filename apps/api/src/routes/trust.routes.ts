/** /api/trust: engagements (confirmed by both sides), double-blind ratings and complaints. */
import { Router } from "express";
import * as ctrl from "../controllers/trust.controller";
import { authenticate } from "../middleware/auth";
import { rateLimit } from "../middleware/rate-limit";

export const router = Router();
router.use(authenticate);

/** Your engagements (`Engagement[]`). */
router.get("/engagements", ctrl.list);
/** Propose an engagement from an accepted approach or a hired application `{ approachId | applicationId, title }`. */
router.post("/engagements", rateLimit("engagement", 30, 86400), ctrl.propose);
/** Confirm the start. ACTIVE once both sides have. */
router.post("/engagements/:id/confirm", ctrl.confirm);
/** Cancel a proposed engagement. */
router.post("/engagements/:id/cancel", ctrl.cancel);
/** Mark complete, or confirm the other side's completion. */
router.post("/engagements/:id/complete", ctrl.complete);
/** Dispute the other side's completion. */
router.post("/engagements/:id/dispute", ctrl.dispute);
/** Rate a completed engagement `{ score, subScores?, comment? }`. Hidden until both rate or the window closes; one edit before then. */
router.post("/engagements/:id/rating", ctrl.rate);
/** File a complaint about someone you dealt with `{ againstUsername, category, description, engagementId | approachId | applicationId, evidenceUploadIds? }`. */
router.post("/complaints", rateLimit("complaints", 5, 86400), ctrl.fileComplaint);
/** Complaints you filed, with their outcome (`Complaint[]`). */
router.get("/complaints", ctrl.myComplaints);
