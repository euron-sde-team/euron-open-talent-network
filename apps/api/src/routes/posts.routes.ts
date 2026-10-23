/** /api/posts: the home feed, posts, reactions, bookmarks and comments on a post. */
import { Router } from "express";
import * as ctrl from "../controllers/post.controller";
import { authenticate, optionalAuth } from "../middleware/auth";
import { rateLimit } from "../middleware/rate-limit";

export const router = Router();

const postLimit = rateLimit("posts", 10, 60);
const commentLimit = rateLimit("comments", 30, 60);
const reactionLimit = rateLimit("reactions", 120, 60);

/** Your feed (`Page<Post> & { suggestedIds }`): your network (connections, follows, followed companies, your company). `sort=latest|top` (top: last 7 days). A thin first page is topped up with suggested public posts, listed in `suggestedIds`. */
router.get("/feed", authenticate, ctrl.homeFeed);
/** Create a post (201 `Post`): `{ body, kind?, visibility?, companyId?, jobId?, mediaIds?, sharedPostId? }`. `companyId` posts as a company page (page admins); `jobId` attaches an open job of your company. */
router.post("/", authenticate, postLimit, ctrl.create);
/** A post (`Post`). 404 for CONNECTIONS-only posts of people you are not connected to, and across blocks. */
router.get("/:id", optionalAuth, ctrl.get);
/** Edit your post: `{ body?, visibility? }`. */
router.patch("/:id", authenticate, postLimit, ctrl.update);
/** Delete (author or company page admin) or remove (staff) a post. 204. */
router.delete("/:id", authenticate, ctrl.remove);
/** React: `{ type }` -> `{ reactionCount, reactionCounts, viewerReaction }`. Changing type replaces your reaction. */
router.put("/:id/reaction", authenticate, reactionLimit, ctrl.react);
/** Remove your reaction. */
router.delete("/:id/reaction", authenticate, reactionLimit, ctrl.unreact);
/** Who reacted (`Page<{ user, type }>`), `type` filter. */
router.get("/:id/reactions", optionalAuth, ctrl.reactionList);
/** Bookmark. 204. */
router.post("/:id/bookmark", authenticate, ctrl.bookmark);
/** Remove the bookmark. 204. */
router.delete("/:id/bookmark", authenticate, ctrl.unbookmark);
/** Hide from your own feed. 204. */
router.post("/:id/hide", authenticate, ctrl.hide);
/** Top-level comments, oldest first (`Page<Comment>`). */
router.get("/:id/comments", optionalAuth, ctrl.listComments);
/** Comment or reply: `{ body, parentId?, mediaId? }`. 201 `Comment`. */
router.post("/:id/comments", authenticate, commentLimit, ctrl.createComment);
