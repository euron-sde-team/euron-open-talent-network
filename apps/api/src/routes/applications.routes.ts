/** /api/applications: your applications (candidate) and pipeline moves (the hiring team). */
import { Router } from "express";
import * as ctrl from "../controllers/application.controller";
import { authenticate } from "../middleware/auth";
import { rateLimit } from "../middleware/rate-limit";

export const router = Router();
router.use(authenticate);

/** Your applications with their status timeline (`Page<MyApplication>`), `open=true` for active ones. */
router.get("/mine", ctrl.mine);
/** Move several cards at once `{ ids, to, reason?, note? }` (all or nothing). */
router.post("/bulk-move", rateLimit("pipeline-move", 600, 3600), ctrl.bulk);
/** One application, team view (`Application`). */
router.get("/:id", ctrl.get);
/** Withdraw your application. */
router.post("/:id/withdraw", ctrl.withdraw);
/** Move a card `{ to, reason? (required for REJECTED), note? (team only) }`. The candidate sees the stage change live. */
router.post("/:id/move", rateLimit("pipeline-move", 600, 3600), ctrl.moveOne);
/** Open the conversation about this application -> `{ threadId }` (team or candidate). */
router.post("/:id/thread", ctrl.thread);
