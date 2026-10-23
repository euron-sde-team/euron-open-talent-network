/** /api/network: connections (one row per pair), invitations, people you may know. */
import { Router } from "express";
import * as ctrl from "../controllers/network.controller";
import { authenticate, optionalAuth } from "../middleware/auth";
import { rateLimit } from "../middleware/rate-limit";

export const router = Router();

/** Send a connection request `{ userId, note? }` -> `{ state, connectionId }`. If they asked you first, this accepts. */
router.post("/connections", authenticate, rateLimit("connect", 60, 3600), ctrl.connect);
/** Your connections, newest first (`Page<NetworkEntry>`). */
router.get("/connections", authenticate, ctrl.myConnections);
/** Remove a connection. 204; they are not notified. */
router.delete("/connections/:userId", authenticate, ctrl.remove);
/** Invitations: `direction=received|sent` (`Page<NetworkEntry>`). */
router.get("/invitations", authenticate, ctrl.invitations);
/** Accept an invitation. 204. */
router.post("/invitations/:id/accept", authenticate, ctrl.accept);
/** Ignore an invitation (the sender is not told). 204. */
router.post("/invitations/:id/ignore", authenticate, ctrl.ignore);
/** Withdraw an invitation you sent. 204. */
router.delete("/invitations/:id", authenticate, ctrl.withdraw);
/** People you may know (`NetworkEntry[]`): second-degree connections first, then colleagues and shared skills. */
router.get("/suggestions", authenticate, ctrl.suggestions);
/** Mutual connections with someone (`NetworkEntry[]`). */
router.get("/mutual/:userId", authenticate, ctrl.mutual);
/** A person's connections (`Page<NetworkEntry>`). */
router.get("/of/:username", optionalAuth, ctrl.connectionsOf);
