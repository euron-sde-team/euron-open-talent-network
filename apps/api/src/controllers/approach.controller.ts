/** /api/approaches: recruiter outreach and consent-based contact unlock. */
import { CONTACT_CHANNELS, EMPLOYMENT_TYPES, PAY_PERIODS } from "@open-talent/types";
import type { Request, Response } from "express";
import { z } from "zod";
import { id, idParam, parse, text } from "../core/validate";
import { actorOf, meta } from "../middleware/http";
import * as approaches from "../services/approach.service";
import { page } from "./user.controller";

const STATUS = z.enum(["PENDING", "ACCEPTED", "DECLINED", "WITHDRAWN", "EXPIRED", "BLOCKED"]).optional();

const send = z
  .object({
    username: z.string().trim().min(3).max(40),
    roleTitle: text(120, 2),
    message: text(3000, 30),
    jobId: id().nullable().optional(),
    employmentType: z.enum(EMPLOYMENT_TYPES).nullable().optional(),
    salary: z.object({ min: z.number().int().min(0).nullable(), max: z.number().int().min(0).nullable(), currency: z.string().regex(/^[A-Za-z]{3}$/).nullable(), period: z.enum(PAY_PERIODS).nullable() }).nullable().optional(),
  })
  .strict();

export async function create(req: Request, res: Response) {
  res.status(201).json(await approaches.send(actorOf(req), parse(send, req.body)));
}

export async function received(req: Request, res: Response) {
  const { status } = parse(z.object({ status: STATUS }), req.query);
  res.json(await approaches.listForCandidate(actorOf(req), { status, ...page(req) }));
}

export async function sent(req: Request, res: Response) {
  const { status } = parse(z.object({ status: STATUS }), req.query);
  res.json(await approaches.listForRecruiter(actorOf(req), { status, ...page(req) }));
}

export async function get(req: Request, res: Response) {
  res.json(await approaches.get(actorOf(req), parse(idParam, req.params).id));
}

export async function viewed(req: Request, res: Response) {
  await approaches.markViewed(actorOf(req), parse(idParam, req.params).id);
  res.status(204).end();
}

export async function accept(req: Request, res: Response) {
  const { channels } = parse(z.object({ channels: z.array(z.enum(CONTACT_CHANNELS)).min(1).max(3) }).strict(), req.body);
  res.json(await approaches.accept(actorOf(req), parse(idParam, req.params).id, channels));
}

export async function decline(req: Request, res: Response) {
  const { reason } = parse(z.object({ reason: z.string().trim().max(500).nullable().optional() }).strict(), req.body ?? {});
  res.json(await approaches.decline(actorOf(req), parse(idParam, req.params).id, reason || null));
}

export async function block(req: Request, res: Response) {
  await approaches.blockFromApproach(actorOf(req), parse(idParam, req.params).id);
  res.status(204).end();
}

export async function revoke(req: Request, res: Response) {
  res.json(await approaches.revoke(actorOf(req), parse(idParam, req.params).id));
}

export async function withdraw(req: Request, res: Response) {
  res.json(await approaches.withdraw(actorOf(req), parse(idParam, req.params).id));
}

export async function contact(req: Request, res: Response) {
  res.setHeader("Cache-Control", "no-store");
  res.json(await approaches.revealContact(actorOf(req), parse(idParam, req.params).id, meta(req)));
}
