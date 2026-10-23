/** /api/companies: company pages. Page admins (OWNER, ADMIN) edit; operators verify (/api/admin). */
import { Router } from "express";
import * as ctrl from "../controllers/company.controller";
import { authenticate, optionalAuth } from "../middleware/auth";
import { rateLimit } from "../middleware/rate-limit";

export const router = Router();

/** Companies, most followed first (`Page<CompanySummary>`): `q`, `industry`. */
router.get("/", optionalAuth, ctrl.list);
/** A company page (`Company`). Suspended companies are a 404 except to their team and staff. */
router.get("/:slug", optionalAuth, ctrl.get);
/** Edit your company page (page admins): name, tagline, about, website, industry, size, HQ, logo, cover, domains, auto-approve. Changing domains of a verified company sends it back for verification. */
router.patch("/:slug", authenticate, rateLimit("company-edit", 60, 600), ctrl.update);
/** The team (`TeamMember[]`); admins also see pending members. */
router.get("/:slug/team", optionalAuth, ctrl.team);
/** Change a teammate's role (`{ role }`). The last owner stays an owner. */
router.patch("/team/:recruiterId", authenticate, ctrl.setRole);
/** Remove a teammate. Their pending approaches are withdrawn and unlocks end. 204. */
router.delete("/team/:recruiterId", authenticate, ctrl.removeMember);
/** Follow (PUT) or unfollow (DELETE) a company page (`Company`). */
router.put("/:slug/follow", authenticate, rateLimit("follows", 60, 60), ctrl.follow);
router.delete("/:slug/follow", authenticate, ctrl.follow);
/** People whose current role is here (`Page<UserSummary>`). */
router.get("/:slug/people", optionalAuth, ctrl.people);
/** The company's jobs (`Page<Job>`): OPEN ones for everyone, every status for the team. */
router.get("/:slug/jobs", optionalAuth, ctrl.companyJobs);
/** Posts made as the company page (`Page<Post>`). */
router.get("/:slug/posts", optionalAuth, ctrl.posts);
