/** /api/recruiter: becoming a recruiter, the account, and the recruiter workspace. */
import type { Request, Response } from "express";
import { z } from "zod";
import { id, idParam, parse, text } from "../core/validate";
import { EMPLOYMENT_TYPES, WORKPLACE_TYPES } from "@open-talent/types";
import { actorOf } from "../middleware/http";
import * as applications from "../services/application.service";
import * as directory from "../services/directory.service";
import * as recruiters from "../services/recruiter.service";
import { page } from "./user.controller";

const opt = (max: number) =>
  z
    .string()
    .trim()
    .max(max)
    .nullable()
    .optional()
    .transform((v) => (v ? v : null));

const register = z
  .object({
    companySlug: z.string().max(60).optional(),
    newCompany: z
      .object({ name: text(120, 2), website: opt(300), industry: opt(80), sizeBand: z.enum(["1-10", "11-50", "51-200", "201-500", "501-1000", "1001-5000", "5001+"]).nullable().optional(), headquarters: opt(120) })
      .strict()
      .optional(),
    workEmail: z.string().trim().email().max(200),
    title: opt(120),
    note: opt(1000),
  })
  .strict();

export async function registerRecruiter(req: Request, res: Response) {
  res.status(201).json(await recruiters.register(actorOf(req), parse(register, req.body)));
}

export async function me(req: Request, res: Response) {
  res.json(await recruiters.me(actorOf(req)));
}

export async function updateMe(req: Request, res: Response) {
  res.json(await recruiters.updateMe(actorOf(req), parse(z.object({ title: opt(120) }).strict(), req.body)));
}

export async function resendCode(req: Request, res: Response) {
  await recruiters.resendCode(actorOf(req));
  res.status(204).end();
}

export async function verifyCode(req: Request, res: Response) {
  const { code } = parse(z.object({ code: z.string().trim().regex(/^\d{6}$/, "six digits") }).strict(), req.body);
  res.json(await recruiters.verifyCode(actorOf(req), code));
}

export async function leave(req: Request, res: Response) {
  await recruiters.leave(actorOf(req));
  res.status(204).end();
}

export async function savedCandidates(req: Request, res: Response) {
  res.json(await directory.savedCandidates(actorOf(req), page(req)));
}

export async function saveCandidate(req: Request, res: Response) {
  const { username } = parse(z.object({ username: z.string().max(40) }), req.params);
  const body = parse(z.object({ note: opt(500) }).strict(), req.body ?? {});
  await directory.saveCandidate(actorOf(req), username, body.note ?? null, req.method !== "DELETE");
  res.status(204).end();
}

const searchQuery = z
  .object({
    q: z.string().trim().max(100).optional(),
    skills: z.array(z.string().max(60)).max(10).optional(),
    location: z.string().trim().max(120).optional(),
    openToWork: z.boolean().optional(),
    employment: z.array(z.enum(EMPLOYMENT_TYPES)).optional(),
    workplace: z.array(z.enum(WORKPLACE_TYPES)).optional(),
    minYears: z.number().int().min(0).max(70).optional(),
    maxYears: z.number().int().min(0).max(70).optional(),
    sort: z.enum(["relevance", "recent", "experience"]).optional(),
  })
  .strict();

export async function savedSearches(req: Request, res: Response) {
  res.json(await directory.savedSearches(actorOf(req)));
}

export async function saveSearch(req: Request, res: Response) {
  const body = parse(z.object({ name: text(80, 1), query: searchQuery }).strict(), req.body);
  res.status(201).json(await directory.saveSearch(actorOf(req), body.name, body.query));
}

export async function deleteSearch(req: Request, res: Response) {
  await directory.deleteSearch(actorOf(req), parse(idParam, req.params).id);
  res.status(204).end();
}

export async function notes(req: Request, res: Response) {
  res.json(await applications.notes(actorOf(req), parse(z.object({ candidateId: id() }), req.params).candidateId));
}

export async function addNote(req: Request, res: Response) {
  const body = parse(z.object({ candidateId: id().optional(), applicationId: id().optional(), body: text(3000, 1), rating: z.number().int().min(1).max(5).nullable().optional() }).strict(), req.body);
  res.status(201).json(await applications.addNote(actorOf(req), body));
}
