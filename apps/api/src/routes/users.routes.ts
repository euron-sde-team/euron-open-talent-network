/** /api/users: your account, follows, blocks, sessions and a person's activity. Talent pages are under /api/profiles. */
import { Router } from "express";
import * as ctrl from "../controllers/user.controller";
import { authenticate, optionalAuth } from "../middleware/auth";
import { rateLimit } from "../middleware/rate-limit";

export const router = Router();

const follows = rateLimit("follows", 60, 60);

/** Your account (`Me`): identity, status, recruiter record, profile status and completeness. */
router.get("/me", authenticate, ctrl.me);
/** Edit your account: `{ displayName?, avatarUploadId?, coverUploadId?, messageRequestPolicy?, emailDigest? }`. Names are cleaned (no emails or phone numbers). Returns `Me`. */
router.patch("/me", authenticate, ctrl.updateMe);
/**
 * Delete your account: `{ password, totp? }` (or `recoveryCode`). Anonymises it and wipes the talent profile and contact
 * details; content stays as "Deleted user". 204. 409 OWNER_MUST_TRANSFER while you are the only owner of a company team,
 * 409 LAST_ADMIN.
 */
router.delete("/me", authenticate, rateLimit("account-delete", 5, 3600), ctrl.deleteMe);
/** Download your data (account, profile and every section, posts, comments, messages you sent, connections, approaches, applications, ratings, complaints) as JSON. 3 per day. */
router.get("/me/export", authenticate, rateLimit("account-export", 3, 86400), ctrl.exportMe);
/** Your saved posts, newest first (`Page<Post>`). Posts you can no longer see drop out. */
router.get("/me/bookmarks", authenticate, ctrl.myBookmarks);
/** People you have blocked (`UserSummary[]`). */
router.get("/me/blocks", authenticate, ctrl.myBlocks);
/** Your signed-in sessions. */
router.get("/me/sessions", authenticate, ctrl.mySessions);
/** Sign out one session (and every rotation of it). 204. */
router.delete("/me/sessions/:id", authenticate, ctrl.revokeSession);
/** A person's activity (`Page<Post>`); you also see your own pending and hidden posts. CONNECTIONS-only posts need a connection. */
router.get("/:username/posts", optionalAuth, ctrl.posts);
/** Followers (`Page<FollowEntry>`). */
router.get("/:username/followers", optionalAuth, ctrl.followers);
/** Accounts the person follows (`Page<FollowEntry>`). */
router.get("/:username/following", optionalAuth, ctrl.following);
/** Follow someone (their posts appear in your feed without connecting). 204; notifies them. */
router.post("/:id/follow", authenticate, follows, ctrl.follow);
/** Unfollow. 204. */
router.delete("/:id/follow", authenticate, follows, ctrl.unfollow);
/** Block someone. 204. Ends follows, the connection, contact unlocks and pending approaches between you. */
router.post("/:id/block", authenticate, ctrl.block);
/** Unblock. 204. */
router.delete("/:id/block", authenticate, ctrl.unblock);
