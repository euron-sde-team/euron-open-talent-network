/** /api/dms: 1:1 conversations, message requests, reactions, read state, archive and contacts. */
import { Router } from "express";
import * as ctrl from "../controllers/dm.controller";
import { authenticate } from "../middleware/auth";
import { rateLimit } from "../middleware/rate-limit";

export const router = Router();
router.use(authenticate);

const send = rateLimit("dm-send", 30, 60);

/** Your conversations: `folder=inbox` (accepted), `folder=requests` (message requests) or `folder=archived`. */
router.get("/threads", ctrl.listThreads);
/** Find or create the 1:1 conversation with a user. 403 DM_NOT_ALLOWED with `details.reason`. */
router.post("/threads", ctrl.openDirect);
/** One conversation, from your side. */
router.get("/threads/:id", ctrl.getThread);
/** Mute a conversation until a time (null unmutes), or archive it (`archived: true`). */
router.patch("/threads/:id", ctrl.updateThread);
/** Messages, newest first. */
router.get("/threads/:id/messages", ctrl.listMessages);
/** Send a message (body and/or upload ids). Rate limited to 30 a minute. */
router.post("/threads/:id/messages", send, ctrl.sendMessage);
/** Mark everything up to now as read. */
router.post("/threads/:id/read", ctrl.markRead);
/** Accept a message request. */
router.post("/threads/:id/accept", ctrl.accept);
/** Decline a message request. */
router.post("/threads/:id/decline", ctrl.decline);
/** Every attachment in the conversation, newest first. */
router.get("/threads/:id/media", ctrl.threadMedia);
/** Full-text search within one conversation. */
router.get("/threads/:id/search", ctrl.search);
/** Edit your message. */
router.patch("/messages/:id", ctrl.editMessage);
/** Delete your message (leaves a tombstone). */
router.delete("/messages/:id", ctrl.deleteMessage);
/** React with an emoji (idempotent). */
router.put("/messages/:id/reactions/:emoji", ctrl.addReaction);
/** Remove your emoji reaction. */
router.delete("/messages/:id/reactions/:emoji", ctrl.removeReaction);
/** Unread badge: messages in your inbox, and pending requests. */
router.get("/unread", ctrl.unread);
/** Whether you may message a user right now (or only send a request), and why not. */
router.get("/eligibility/:userId", ctrl.eligibility);
/** Your connections, online first: the messaging rail. */
router.get("/contacts", ctrl.contacts);
