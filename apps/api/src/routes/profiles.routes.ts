/** /api/profiles: the talent page, its editor, AI import, resume export, views and endorsements. */
import { Router } from "express";
import * as ctrl from "../controllers/profile.controller";
import { authenticate, optionalAuth } from "../middleware/auth";
import { rateLimit } from "../middleware/rate-limit";

export const router = Router();

const edits = rateLimit("profile-edit", 120, 600);

/** Your talent page with private fields (`MyProfile`): contact details, section visibility, open-to-work settings, what is missing. */
router.get("/me", authenticate, ctrl.mine);
/** Edit the basics: `{ headline?, about?, currentTitle?, currentCompany?, location?, countryCode?, timezone?, yearsExperience?, languages?, rate? }`. */
router.patch("/me", authenticate, edits, ctrl.updateBasics);
/** Open to work: `{ mode: OFF | RECRUITERS | PUBLIC, roles, employmentTypes, workplaceTypes, availableFrom }`. RECRUITERS shows the signal to verified recruiters only. */
router.put("/me/open-to-work", authenticate, edits, ctrl.updateOpenToWork);
/** Private contact channels: `{ email, phone, whatsapp }` (international phone format). Never public; shared per channel only when you accept an approach. */
router.put("/me/contact", authenticate, edits, ctrl.updateContact);
/** Who sees each section: `{ experience?: PUBLIC | CONNECTIONS | RECRUITERS, ... }`. */
router.put("/me/visibility", authenticate, edits, ctrl.updateVisibility);
/** Set or clear the cover image (a COVER upload id). */
router.put("/me/cover", authenticate, edits, ctrl.setCover);
/** Replace a section (`experience`, `education`, `projects`, `skills`, `certifications`, `links`) with `{ items }`, in order. Skills keep their endorsements. */
router.put("/me/sections/:section", authenticate, edits, ctrl.replaceSection);
/** Publish, unlist or return to draft: `{ status }`. Publishing needs completeness at or above the network threshold and a contact channel (422 PUBLISH_*). */
router.post("/me/status", authenticate, ctrl.setStatus);
/** Change your username (`{ username }`). Old handles keep redirecting; once per cooldown period. */
router.put("/me/username", authenticate, rateLimit("username-change", 5, 86400), ctrl.changeUsername);
/** Is a username available? `?u=` -> `{ available, reason, suggestions }`. */
router.get("/username-check", optionalAuth, rateLimit("username-check", 60, 60, "ip"), ctrl.usernameCheck);
/** Your profile analytics (`ProfileAnalytics`): views by day, recruiter companies, approaches. */
router.get("/me/analytics", authenticate, ctrl.analytics);
/** Every reveal of a contact detail you shared (`ContactAccessEntry[]`). */
router.get("/me/contact-log", authenticate, ctrl.contactLog);
/** Show or hide one of your badges: `{ visible }`. */
router.patch("/me/badges/:badgeId", authenticate, ctrl.badgeVisibility);
/** Download your resume as `pdf` or `docx`. */
router.get("/me/resume.:format", authenticate, rateLimit("resume-export", 20, 3600), ctrl.exportResume);
/** Start an AI import from `{ text?, uploadId? }` (an IMPORT upload: PDF, DOCX, image or audio). 202 `ProfileImport`; progress arrives as `import:status`. */
router.post("/me/imports", authenticate, ctrl.startImport);
/** Your most recent import (`ProfileImport | null`). */
router.get("/me/imports/latest", authenticate, ctrl.latestImport);
/** One import (`ProfileImport`): status, proposal, proposed badges, what is missing. */
router.get("/me/imports/:id", authenticate, ctrl.getImport);
/** Apply chosen parts of a READY import: `{ sections, basics, badges }`. */
router.post("/me/imports/:id/apply", authenticate, ctrl.applyImport);
/** An AI rewrite of a field: `{ field, text }` -> `{ text }` (a suggestion; nothing is saved). */
router.post("/me/polish", authenticate, ctrl.polish);
/** Endorse a connection's skill (PUT) or take it back (DELETE). Connections only. */
router.put("/skills/:skillId/endorsement", authenticate, rateLimit("endorse", 120, 3600), ctrl.endorse);
router.delete("/skills/:skillId/endorsement", authenticate, ctrl.endorse);
/** A talent page (`Profile`), sections filtered for you. 404 for drafts, suspended profiles and across blocks; 301 PROFILE_MOVED with `details.username` for a renamed handle. */
router.get("/:username", optionalAuth, ctrl.publicProfile);
/** Count a view (once per viewer per day). 204. */
router.post("/:username/view", optionalAuth, rateLimit("profile-view", 120, 60, "ip"), ctrl.view);
/** Revealed ratings from recruiters (`Rating[]`). */
router.get("/:username/ratings", optionalAuth, ctrl.ratings);
