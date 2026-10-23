/** /api/recruiter: register, confirm the work email, the account, saved candidates and searches, team notes. */
import { Router } from "express";
import * as ctrl from "../controllers/recruiter.controller";
import { authenticate } from "../middleware/auth";
import { rateLimit } from "../middleware/rate-limit";

export const router = Router();
router.use(authenticate);

/** Register as a recruiter: `{ companySlug }` to join a company page, or `{ newCompany }` to create one, plus `{ workEmail, title?, note? }`. Sends a code to the work email. */
router.post("/register", rateLimit("recruiter-register", 10, 86400), ctrl.registerRecruiter);
/** Your recruiter account (`RecruiterAccount`): status, company, quota. 404 NOT_A_RECRUITER. */
router.get("/me", ctrl.me);
/** Update your title. */
router.patch("/me", ctrl.updateMe);
/** Send a new work-email code. 204. */
router.post("/me/code", rateLimit("recruiter-code", 5, 3600), ctrl.resendCode);
/** Confirm the work email with the six-digit code. Then: ACTIVE (domain auto-approval) or PENDING_REVIEW. */
router.post("/me/verify", rateLimit("recruiter-verify", 20, 3600), ctrl.verifyCode);
/** Stop recruiting for your company. Pending approaches are withdrawn, unlocks end. 204. */
router.delete("/me", ctrl.leave);
/** Saved candidates (`Page<TalentCard & { note, savedAt }>`). Unpublished profiles drop out. */
router.get("/saved", ctrl.savedCandidates);
/** Save (PUT, `{ note? }`) or unsave (DELETE) a candidate. 204. */
router.put("/saved/:username", ctrl.saveCandidate);
router.delete("/saved/:username", ctrl.saveCandidate);
/** Saved talent searches. */
router.get("/searches", ctrl.savedSearches);
/** Save a talent search `{ name, query }`. */
router.post("/searches", ctrl.saveSearch);
/** Delete a saved search. 204. */
router.delete("/searches/:id", ctrl.deleteSearch);
/** The team's private notes about a candidate (`CandidateNote[]`). */
router.get("/notes/:candidateId", ctrl.notes);
/** Add a note `{ candidateId? | applicationId?, body, rating? }` (the candidate never sees it). */
router.post("/notes", rateLimit("notes", 200, 3600), ctrl.addNote);
