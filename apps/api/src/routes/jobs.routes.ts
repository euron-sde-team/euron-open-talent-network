/** /api/jobs: postings, search, saved jobs, invitations to apply, Easy Apply and the pipeline board. */
import { Router } from "express";
import * as ctrl from "../controllers/job.controller";
import { authenticate, optionalAuth } from "../middleware/auth";
import { rateLimit } from "../middleware/rate-limit";

export const router = Router();

/** Search open jobs (`Page<Job>`): `q`, `location` (remote jobs always match), `workplace`, `employment`, `seniority`, `skills` (comma separated), `company`, `salaryMin`, `postedWithinDays`, `sort=recent|relevance`. */
router.get("/", optionalAuth, rateLimit("job-search", 120, 60, "ip"), ctrl.search);
/** Open jobs that fit your skills and open-to roles (`Job[]`). */
router.get("/recommended", authenticate, ctrl.recommended);
/** Your saved jobs (`Page<Job>`). */
router.get("/saved", authenticate, ctrl.saved);
/** Invitations to apply that you received (`JobInvite[]`). */
router.get("/invites", authenticate, ctrl.myInvites);
/** Respond to an invitation `{ response: VIEWED | INTERESTED | DECLINED }` -> `{ jobId }` (INTERESTED opens Easy Apply). */
router.post("/invites/:id/respond", authenticate, ctrl.respondInvite);
/** Post a job (ACTIVE recruiters): the job fields plus `publish?` (OPEN at once, within the company's open-job cap). */
router.post("/", authenticate, rateLimit("job-create", 30, 86400), ctrl.create);
/** A job (`Job`): DRAFT and hidden jobs are visible to the company team only. */
router.get("/:id", optionalAuth, ctrl.get);
/** Edit a job (the company team). */
router.patch("/:id", authenticate, ctrl.update);
/** Open, close or mark filled: `{ status }`. Opening counts against the open-job cap. */
router.post("/:id/status", authenticate, ctrl.setStatus);
/** Save (PUT) or unsave (DELETE) a job. 204. */
router.put("/:id/save", authenticate, ctrl.save);
router.delete("/:id/save", authenticate, ctrl.save);
/** Invite someone to apply `{ username, message? }`. 204. */
router.post("/:id/invites", authenticate, rateLimit("job-invite", 100, 86400), ctrl.invite);
/** Easy Apply `{ coverNote?, answers?, resumeUploadId? }` -> 201 `MyApplication`. Your profile is snapshotted. */
router.post("/:id/apply", authenticate, rateLimit("apply", 50, 86400), ctrl.apply);
/** The pipeline board (`PipelineColumn[]`) for the company team. Live updates via the `job:subscribe` socket room. */
router.get("/:id/pipeline", authenticate, ctrl.pipeline);
/** One pipeline column, paged (`Page<Application>`). */
router.get("/:id/pipeline/:stage", authenticate, ctrl.stage);
