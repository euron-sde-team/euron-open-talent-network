/** /api/search: the talent directory, its facets, and the all-in-one typeahead. */
import { Router } from "express";
import * as ctrl from "../controllers/search.controller";
import { optionalAuth } from "../middleware/auth";
import { rateLimit } from "../middleware/rate-limit";

export const router = Router();

const searches = rateLimit("search", 90, 60, "ip");

/** People (`Page<TalentCard>`): `q`, `skills` (all required), `location`, `openToWork`, `employment`, `workplace`, `minYears`, `maxYears`, `sort`. Published profiles only. */
router.get("/people", optionalAuth, searches, ctrl.people);
/** The most common skills and locations (`DirectoryFacets`). */
router.get("/facets", optionalAuth, ctrl.facets);
/** Typeahead across people, jobs and companies (`SearchResults`). */
router.get("/", optionalAuth, searches, ctrl.everything);
