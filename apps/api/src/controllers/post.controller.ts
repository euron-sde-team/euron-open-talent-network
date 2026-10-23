/** /api/posts: feed, create, read, edit, delete, reactions, bookmarks, comments. */
import { REACTIONS } from "@open-talent/types";
import type { Request, Response } from "express";
import { z } from "zod";
import { id, idParam, pageQuery, parse } from "../core/validate";
import { actorOf } from "../middleware/http";
import * as comments from "../services/comment.service";
import * as feed from "../services/feed.service";
import * as posts from "../services/post.service";
import * as reactions from "../services/reaction.service";

const reaction = z.enum(REACTIONS);
const createBody = z
  .object({
    body: z.string().max(6000).default(""),
    kind: z.enum(["POST", "HIRING", "OPEN_TO_WORK", "JOB", "MILESTONE"]).optional(),
    visibility: z.enum(["PUBLIC", "CONNECTIONS"]).optional(),
    companyId: id().optional(),
    jobId: id().optional(),
    mediaIds: z.array(id()).max(10).optional(),
    sharedPostId: id().optional(),
  })
  .strict();

const patchBody = z.object({ body: z.string().max(6000), visibility: z.enum(["PUBLIC", "CONNECTIONS"]) }).partial().strict();

export async function homeFeed(req: Request, res: Response) {
  const q = parse(pageQuery.extend({ sort: z.enum(["latest", "top"]).default("latest") }), req.query);
  res.json(await feed.homeFeed(actorOf(req), { sort: q.sort, cursor: q.cursor, limit: q.limit ?? 20 }));
}

export async function create(req: Request, res: Response) {
  res.status(201).json(await posts.create(actorOf(req), parse(createBody, req.body)));
}

export async function get(req: Request, res: Response) {
  res.json(await posts.get(req.actor, parse(idParam, req.params).id));
}

export async function update(req: Request, res: Response) {
  res.json(await posts.update(actorOf(req), parse(idParam, req.params).id, parse(patchBody, req.body)));
}

export async function remove(req: Request, res: Response) {
  await posts.remove(actorOf(req), parse(idParam, req.params).id);
  res.status(204).end();
}

export async function react(req: Request, res: Response) {
  const { type } = parse(z.object({ type: reaction }), req.body);
  res.json(await reactions.setPostReaction(actorOf(req), parse(idParam, req.params).id, type));
}

export async function unreact(req: Request, res: Response) {
  res.json(await reactions.setPostReaction(actorOf(req), parse(idParam, req.params).id, null));
}

export async function reactionList(req: Request, res: Response) {
  const q = parse(pageQuery.extend({ type: reaction.optional() }), req.query);
  res.json(await reactions.listPostReactions(req.actor, parse(idParam, req.params).id, { type: q.type, cursor: q.cursor, limit: q.limit ?? 20 }));
}

export async function bookmark(req: Request, res: Response) {
  await posts.bookmark(actorOf(req), parse(idParam, req.params).id);
  res.status(204).end();
}

export async function unbookmark(req: Request, res: Response) {
  await posts.unbookmark(actorOf(req), parse(idParam, req.params).id);
  res.status(204).end();
}

export async function hide(req: Request, res: Response) {
  await posts.hide(actorOf(req), parse(idParam, req.params).id);
  res.status(204).end();
}

export async function listComments(req: Request, res: Response) {
  const q = parse(pageQuery, req.query);
  res.json(await comments.listForPost(req.actor, parse(idParam, req.params).id, { cursor: q.cursor, limit: q.limit ?? 20 }));
}

export async function createComment(req: Request, res: Response) {
  const body = parse(z.object({ body: z.string().max(4000).default(""), parentId: id().optional(), mediaId: id().optional() }).strict(), req.body);
  res.status(201).json(await comments.create(actorOf(req), parse(idParam, req.params).id, body));
}
