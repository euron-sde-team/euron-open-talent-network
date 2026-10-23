/** /api/admin: the control plane. Each area is gated by role (domain/admin-permissions.ts); everything is audited. */
import { Router } from "express";
import * as ctrl from "../controllers/admin.controller";
import { authenticate } from "../middleware/auth";

export const router = Router();

router.use(authenticate);

/** Your role and which /admin areas it opens (`{ role, areas }`). */
router.get("/me", ctrl.me);
/** Platform settings: quotas, windows, free-mail domains, AI import, moderation thresholds. settings area. */
router.get("/settings", ctrl.getSettings);
/** Change part of the settings (strictly validated). The audit entry records before and after. settings area. */
router.patch("/settings", ctrl.patchSettings);
/** KPIs over `from`..`to` (`AdminStats`): funnel, hiring, trust, daily series, top skills. overview area. */
router.get("/stats", ctrl.stats);
/** The daily series as CSV. overview area. */
router.get("/stats.csv", ctrl.statsCsv);
/** Accounts with search by name, username or exact email (`Page<AdminUserRow>`). people area. */
router.get("/users", ctrl.users);
/** Change an account's platform role. Not your own, never the last admin. settings area. */
router.patch("/users/:id", ctrl.patchUser);
/** Warn an account `{ reason }`. people area. */
router.post("/users/:id/warn", ctrl.warn);
/** Suspend an account `{ days, reason }`; its sockets disconnect. people area. */
router.post("/users/:id/suspend", ctrl.suspend);
/** Lift a suspension early. people area. */
router.post("/users/:id/unsuspend", ctrl.unsuspend);
/** Ban an account `{ reason }`: every session revoked. Admins only. */
router.post("/users/:id/ban", ctrl.ban);
/** Lift a ban. Admins only. */
router.post("/users/:id/unban", ctrl.unban);
/** Suspend a talent profile `{ reason }` (unlocks end). people area. */
router.post("/users/:id/profile/suspend", ctrl.suspendProfile);
/** Restore a suspended profile to UNLISTED. people area. */
router.post("/users/:id/profile/restore", ctrl.restoreProfile);
/** Grant a verification badge `{ label, rationale? }`. people area. */
router.post("/users/:id/badges", ctrl.grantBadge);
/** Revoke a badge. people area. */
router.delete("/badges/:id", ctrl.revokeBadge);
/** Erase an account (GDPR) `{ reason }`: the same anonymisation as self-deletion. settings area. */
router.post("/users/:id/erase", ctrl.erase);
/** The recruiter queue (`Page<AdminRecruiterRow>`), default `status=PENDING_REVIEW`, oldest first, with domain evidence. recruiters area. */
router.get("/recruiters", ctrl.recruiters);
/** Approve or reject `{ decision, note }` (a note is required to reject; the applicant reads it). recruiters area. */
router.post("/recruiters/:id/review", ctrl.reviewRecruiter);
/** Suspend a recruiter `{ reason }`: pending approaches withdrawn, unlocks end. recruiters area. */
router.post("/recruiters/:id/suspend", ctrl.suspendRecruiter);
/** Reinstate a suspended recruiter. recruiters area. */
router.post("/recruiters/:id/reinstate", ctrl.reinstateRecruiter);
/** Set a recruiter's daily approach quota `{ quota }` (null: the platform default). recruiters area. */
router.put("/recruiters/:id/quota", ctrl.recruiterQuota);
/** Company pages (`Page<AdminCompanyRow>`), `status` and `q` (name, slug or a domain). companies area. */
router.get("/companies", ctrl.companies);
/** Verify, unverify or suspend `{ status, reason? }`, edit `domains`, toggle `autoApproveDomain`. Suspending closes its jobs. companies area. */
router.patch("/companies/:id", ctrl.patchCompany);
/** Every job, any status (`Page<Job>`). jobs area. */
router.get("/jobs", ctrl.jobs);
/** Close an open job `{ reason }`. jobs area. */
router.post("/jobs/:id/close", ctrl.closeJob);
/** Open complaints, oldest first (`Page<AdminComplaintRow>`), or `status`. complaints area. */
router.get("/complaints", ctrl.complaints);
/** Resolve `{ status, note, action? }` (action: WARN or SUSPEND the named account). Both sides are told. complaints area. */
router.post("/complaints/:id/resolve", ctrl.resolveComplaint);
/** Hide a rating `{ reason }`; the average is recomputed. complaints area. */
router.post("/ratings/:id/hide", ctrl.hideRating);
/** The audit trail (`Page<AuditEntry>`): filter by `action` prefix, `actorId`, `entityType`, `entityId`. audit area. */
router.get("/audit", ctrl.auditLog);
