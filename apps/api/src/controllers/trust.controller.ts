/** /api/trust: engagements, ratings and complaints. */
import type { Request, Response } from "express";
import { z } from "zod";
import { id, idParam, parse, text } from "../core/validate";
import { actorOf } from "../middleware/http";
import * as trust from "../services/trust.service";

const score = z.number().int().min(1).max(5);

export async function list(req: Request, res: Response) {
  res.json(await trust.list(actorOf(req)));
}

export async function propose(req: Request, res: Response) {
  const body = parse(z.object({ approachId: id().optional(), applicationId: id().optional(), title: text(120, 2) }).strict(), req.body);
  res.status(201).json(await trust.propose(actorOf(req), body));
}

const step = (fn: typeof trust.confirm) => async (req: Request, res: Response) => void res.json(await fn(actorOf(req), parse(idParam, req.params).id));
export const confirm = step(trust.confirm);
export const cancel = step(trust.cancel);
export const complete = step(trust.complete);
export const dispute = step(trust.dispute);

export async function rate(req: Request, res: Response) {
  const body = parse(
    z.object({ score, subScores: z.object({ communication: score, quality: score, reliability: score, professionalism: score }).partial().strict().optional(), comment: z.string().trim().max(1000).nullable().optional() }).strict(),
    req.body,
  );
  res.json(await trust.rate(actorOf(req), parse(idParam, req.params).id, body));
}

export async function fileComplaint(req: Request, res: Response) {
  const body = parse(
    z
      .object({
        againstUsername: z.string().trim().min(3).max(40),
        category: z.enum(["HARASSMENT", "NON_PAYMENT", "NO_SHOW", "MISREPRESENTATION", "SPAM", "SCAM", "DISCRIMINATION", "OTHER"]),
        description: text(3000, 20),
        engagementId: id().nullable().optional(),
        approachId: id().nullable().optional(),
        applicationId: id().nullable().optional(),
        evidenceUploadIds: z.array(id()).max(10).optional(),
      })
      .strict(),
    req.body,
  );
  res.status(201).json(await trust.fileComplaint(actorOf(req), body));
}

export async function myComplaints(req: Request, res: Response) {
  res.json(await trust.myComplaints(actorOf(req)));
}
