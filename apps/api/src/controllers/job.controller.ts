/** /api/jobs: postings, search, saved jobs, invitations, applying. */
import { APPLICATION_STAGES, EMPLOYMENT_TYPES, PAY_PERIODS, SENIORITIES, WORKPLACE_TYPES } from "@open-talent/types";
import type { Request, Response } from "express";
import { z } from "zod";
import { id, idParam, parse, text } from "../core/validate";
import { actorOf } from "../middleware/http";
import * as applications from "../services/application.service";
import * as jobs from "../services/job.service";
import { page } from "./user.controller";

const opt = (max: number) =>
  z
    .string()
    .trim()
    .max(max)
    .nullable()
    .optional()
    .transform((v) => (v ? v : null));

const jobBody = z
  .object({
    title: text(120, 3),
    description: text(12000, 30),
    employmentType: z.enum(EMPLOYMENT_TYPES),
    workplaceType: z.enum(WORKPLACE_TYPES),
    seniority: z.enum(SENIORITIES).nullable().optional(),
    location: opt(120),
    countryCode: z.string().regex(/^[A-Za-z]{2}$/).nullable().optional(),
    salary: z.object({ min: z.number().int().min(0).nullable(), max: z.number().int().min(0).nullable(), currency: z.string().regex(/^[A-Za-z]{3}$/).nullable(), period: z.enum(PAY_PERIODS).nullable() }).nullable().optional(),
    skills: z.array(text(60, 1)).max(30).optional(),
    openings: z.number().int().min(1).max(500).optional(),
    screeningQuestions: z.array(z.object({ id: id().optional(), prompt: text(300, 3), kind: z.enum(["TEXT", "YES_NO"]), required: z.boolean() }).strict()).max(10).optional(),
    closesAt: z.string().datetime({ offset: true }).nullable().optional(),
  })
  .strict();

const csv = (values: readonly string[]) =>
  z
    .union([z.string(), z.array(z.string())])
    .optional()
    .transform((v) => (v === undefined ? undefined : (Array.isArray(v) ? v : v.split(",")).map((s) => s.trim()).filter(Boolean)))
    .pipe(z.array(z.enum(values as [string, ...string[]])).optional());

const searchQuery = z.object({
  q: z.string().trim().max(100).optional(),
  location: z.string().trim().max(120).optional(),
  workplace: csv(WORKPLACE_TYPES),
  employment: csv(EMPLOYMENT_TYPES),
  seniority: csv(SENIORITIES),
  skills: z
    .string()
    .max(600)
    .optional()
    .transform((v) => (v ? v.split(",").map((s) => s.trim()).filter(Boolean).slice(0, 10) : undefined)),
  company: z.string().max(60).optional(),
  salaryMin: z.coerce.number().int().min(0).optional(),
  postedWithinDays: z.coerce.number().int().min(1).max(90).optional(),
  sort: z.enum(["recent", "relevance"]).optional(),
});

export async function search(req: Request, res: Response) {
  const q = parse(searchQuery, req.query);
  res.json(await jobs.search(req.actor, { ...(q as jobs.JobSearch), ...page(req) }));
}

export async function recommended(req: Request, res: Response) {
  res.json(await jobs.recommended(actorOf(req)));
}

export async function create(req: Request, res: Response) {
  const body = parse(jobBody.extend({ publish: z.boolean().optional() }), req.body);
  res.status(201).json(await jobs.create(actorOf(req), body));
}

export async function get(req: Request, res: Response) {
  res.json(await jobs.get(req.actor, parse(idParam, req.params).id));
}

export async function update(req: Request, res: Response) {
  res.json(await jobs.update(actorOf(req), parse(idParam, req.params).id, parse(jobBody.partial().strict(), req.body)));
}

export async function setStatus(req: Request, res: Response) {
  const { status } = parse(z.object({ status: z.enum(["OPEN", "CLOSED", "FILLED"]) }).strict(), req.body);
  res.json(await jobs.setStatus(actorOf(req), parse(idParam, req.params).id, status));
}

export async function save(req: Request, res: Response) {
  await jobs.save(actorOf(req), parse(idParam, req.params).id, req.method !== "DELETE");
  res.status(204).end();
}

export async function saved(req: Request, res: Response) {
  res.json(await jobs.saved(actorOf(req), page(req)));
}

export async function invite(req: Request, res: Response) {
  const body = parse(z.object({ username: z.string().trim().min(3).max(40), message: opt(1000) }).strict(), req.body);
  await jobs.invite(actorOf(req), parse(idParam, req.params).id, body.username, body.message ?? null);
  res.status(204).end();
}

export async function myInvites(req: Request, res: Response) {
  res.json(await jobs.myInvites(actorOf(req)));
}

export async function respondInvite(req: Request, res: Response) {
  const { response } = parse(z.object({ response: z.enum(["VIEWED", "INTERESTED", "DECLINED"]) }).strict(), req.body);
  res.json(await jobs.respondInvite(actorOf(req), parse(idParam, req.params).id, response));
}

export async function apply(req: Request, res: Response) {
  const body = parse(z.object({ coverNote: opt(3000), answers: z.array(z.object({ questionId: id(), answer: z.string().max(2000) }).strict()).max(10).optional(), resumeUploadId: id().nullable().optional() }).strict(), req.body);
  res.status(201).json(await applications.apply(actorOf(req), parse(idParam, req.params).id, body));
}

export async function pipeline(req: Request, res: Response) {
  res.json(await applications.pipeline(actorOf(req), parse(idParam, req.params).id));
}

export async function stage(req: Request, res: Response) {
  const { stage } = parse(z.object({ stage: z.enum(APPLICATION_STAGES) }), req.params);
  res.json(await applications.stagePage(actorOf(req), parse(idParam, req.params).id, stage, page(req)));
}
