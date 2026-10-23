/** /api/users: your account, follows, blocks, sessions and a person's activity. Thin: parse, call the service, respond. */
import type { Request, Response } from "express";
import { z } from "zod";
import { notFound } from "../core/errors";
import { id, idParam, pageQuery, parse, text } from "../core/validate";
import { USERNAME_PATTERN } from "../domain/username";
import { actorOf, meta } from "../middleware/http";
import * as account from "../services/account.service";
import * as feed from "../services/feed.service";
import * as users from "../services/user.service";

const usernameParam = z.object({ username: z.string() });

export function usernameOf(req: Request): string {
  const { username } = parse(usernameParam, req.params);
  if (!USERNAME_PATTERN.test(username)) throw notFound("User not found");
  return username;
}

export const page = (req: Request) => {
  const q = parse(pageQuery, req.query);
  return { cursor: q.cursor, limit: q.limit ?? 20 };
};

const accountPatch = z
  .object({
    displayName: text(80, 1),
    avatarUploadId: id().nullable(),
    coverUploadId: id().nullable(),
    messageRequestPolicy: z.enum(["ANYONE", "RECRUITERS", "NOBODY"]),
    emailDigest: z.boolean(),
  })
  .partial()
  .strict();

export async function me(req: Request, res: Response) {
  res.json(await users.me(actorOf(req)));
}

export async function updateMe(req: Request, res: Response) {
  res.json(await users.updateMe(actorOf(req), parse(accountPatch, req.body)));
}

export async function deleteMe(req: Request, res: Response) {
  const body = parse(z.object({ password: z.string().min(1).max(200), totp: z.string().max(10).optional(), recoveryCode: z.string().max(40).optional() }).strict(), req.body);
  await account.deleteAccount(actorOf(req), body, meta(req));
  res.status(204).end();
}

export async function exportMe(req: Request, res: Response) {
  await account.exportAccount(actorOf(req), res);
}

export async function myBookmarks(req: Request, res: Response) {
  res.json(await feed.bookmarks(actorOf(req), page(req)));
}

export async function myBlocks(req: Request, res: Response) {
  res.json(await users.blocks(actorOf(req)));
}

export async function mySessions(req: Request, res: Response) {
  res.json(await users.sessions(actorOf(req), meta(req)));
}

export async function revokeSession(req: Request, res: Response) {
  await users.revokeSession(actorOf(req), parse(idParam, req.params).id, meta(req));
  res.status(204).end();
}

export async function posts(req: Request, res: Response) {
  const user = await users.visibleUser(req.actor, { username: usernameOf(req) });
  res.json(await feed.authorPosts(req.actor, user.id, page(req)));
}

export async function followers(req: Request, res: Response) {
  res.json(await users.follows(req.actor, usernameOf(req), "followers", page(req)));
}

export async function following(req: Request, res: Response) {
  res.json(await users.follows(req.actor, usernameOf(req), "following", page(req)));
}

export async function follow(req: Request, res: Response) {
  await users.follow(actorOf(req), parse(idParam, req.params).id);
  res.status(204).end();
}

export async function unfollow(req: Request, res: Response) {
  await users.unfollow(actorOf(req), parse(idParam, req.params).id);
  res.status(204).end();
}

export async function block(req: Request, res: Response) {
  await users.block(actorOf(req), parse(idParam, req.params).id, meta(req));
  res.status(204).end();
}

export async function unblock(req: Request, res: Response) {
  await users.unblock(actorOf(req), parse(idParam, req.params).id);
  res.status(204).end();
}
