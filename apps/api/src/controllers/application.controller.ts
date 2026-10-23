/** /api/applications: the candidate's applications and the team's pipeline moves. */
import { APPLICATION_STAGES } from "@open-talent/types";
import type { Request, Response } from "express";
import { z } from "zod";
import { id, idParam, parse } from "../core/validate";
import { actorOf } from "../middleware/http";
import * as applications from "../services/application.service";
import { page } from "./user.controller";

const move = z.object({ to: z.enum(APPLICATION_STAGES), reason: z.string().trim().max(500).nullable().optional(), note: z.string().trim().max(1000).nullable().optional() }).strict();

export async function mine(req: Request, res: Response) {
  const { open } = parse(z.object({ open: z.enum(["true", "false"]).optional() }), req.query);
  res.json(await applications.myApplications(actorOf(req), { ...page(req), open: open === "true" }));
}

export async function withdraw(req: Request, res: Response) {
  res.json(await applications.withdraw(actorOf(req), parse(idParam, req.params).id));
}

export async function get(req: Request, res: Response) {
  res.json(await applications.getForTeam(actorOf(req), parse(idParam, req.params).id));
}

export async function moveOne(req: Request, res: Response) {
  res.json(await applications.move(actorOf(req), parse(idParam, req.params).id, parse(move, req.body)));
}

export async function bulk(req: Request, res: Response) {
  const body = parse(move.extend({ ids: z.array(id()).min(1).max(100) }).strict(), req.body);
  const { ids, ...input } = body;
  res.json(await applications.bulkMove(actorOf(req), ids, input));
}

export async function thread(req: Request, res: Response) {
  res.json(await applications.openThread(actorOf(req), parse(idParam, req.params).id));
}
