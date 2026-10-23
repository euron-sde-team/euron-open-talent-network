/** /api/network: connections, invitations, suggestions, mutual connections. */
import type { Request, Response } from "express";
import { z } from "zod";
import { id, idParam, parse } from "../core/validate";
import { actorOf } from "../middleware/http";
import * as network from "../services/network.service";
import * as users from "../services/user.service";
import { page, usernameOf } from "./user.controller";

export async function connect(req: Request, res: Response) {
  const body = parse(z.object({ userId: id(), note: z.string().trim().max(300).nullable().optional() }).strict(), req.body);
  res.json(await network.connect(actorOf(req), body.userId, body.note || null));
}

export async function accept(req: Request, res: Response) {
  await network.respond(actorOf(req), parse(idParam, req.params).id, true);
  res.status(204).end();
}

export async function ignore(req: Request, res: Response) {
  await network.respond(actorOf(req), parse(idParam, req.params).id, false);
  res.status(204).end();
}

export async function withdraw(req: Request, res: Response) {
  await network.withdraw(actorOf(req), parse(idParam, req.params).id);
  res.status(204).end();
}

export async function remove(req: Request, res: Response) {
  await network.removeConnection(actorOf(req), parse(z.object({ userId: id() }), req.params).userId);
  res.status(204).end();
}

export async function invitations(req: Request, res: Response) {
  const { direction } = parse(z.object({ direction: z.enum(["received", "sent"]).default("received") }), { direction: req.query.direction });
  res.json(await network.invitations(actorOf(req), direction, page(req)));
}

export async function connectionsOf(req: Request, res: Response) {
  const user = await users.visibleUser(req.actor, { username: usernameOf(req) });
  res.json(await network.connections(req.actor, user.id, page(req)));
}

export async function myConnections(req: Request, res: Response) {
  res.json(await network.connections(actorOf(req), actorOf(req).id, page(req)));
}

export async function suggestions(req: Request, res: Response) {
  res.json(await network.suggestions(actorOf(req)));
}

export async function mutual(req: Request, res: Response) {
  res.json(await network.mutual(actorOf(req), parse(z.object({ userId: id() }), req.params).userId));
}
