/** /api/companies: company pages, team, follows, people, jobs and posts. */
import type { Request, Response } from "express";
import { z } from "zod";
import { notFound } from "../core/errors";
import { id, parse, text } from "../core/validate";
import { SLUG_PATTERN } from "../domain/slug";
import { actorOf } from "../middleware/http";
import * as companies from "../services/company.service";
import * as feed from "../services/feed.service";
import * as jobs from "../services/job.service";
import { page } from "./user.controller";

function slugOf(req: Request): string {
  const { slug } = parse(z.object({ slug: z.string() }), req.params);
  if (!SLUG_PATTERN.test(slug)) throw notFound("Company not found", "COMPANY_NOT_FOUND");
  return slug;
}

const opt = (max: number) =>
  z
    .string()
    .trim()
    .max(max)
    .nullable()
    .optional()
    .transform((v) => (v ? v : null));

const patch = z
  .object({
    name: text(120, 2),
    tagline: opt(160),
    about: opt(4000),
    website: opt(300),
    industry: opt(80),
    sizeBand: z.enum(["1-10", "11-50", "51-200", "201-500", "501-1000", "1001-5000", "5001+"]).nullable(),
    headquarters: opt(120),
    foundedYear: z.number().int().min(1800).max(2100).nullable(),
    logoUploadId: id().nullable(),
    coverUploadId: id().nullable(),
    domains: z.array(z.string().trim().max(120)).max(10),
    autoApproveDomain: z.boolean(),
  })
  .partial()
  .strict();

export async function list(req: Request, res: Response) {
  const q = parse(z.object({ q: z.string().trim().max(100).optional(), industry: z.string().trim().max(80).optional() }), req.query);
  res.json(await companies.list(req.actor, { ...q, ...page(req) }));
}

export async function get(req: Request, res: Response) {
  res.json(await companies.get(req.actor, slugOf(req)));
}

export async function update(req: Request, res: Response) {
  res.json(await companies.update(actorOf(req), slugOf(req), parse(patch, req.body)));
}

export async function team(req: Request, res: Response) {
  res.json(await companies.team(req.actor, slugOf(req)));
}

export async function setRole(req: Request, res: Response) {
  const { recruiterId } = parse(z.object({ recruiterId: id() }), req.params);
  const { role } = parse(z.object({ role: z.enum(["OWNER", "ADMIN", "RECRUITER"]) }).strict(), req.body);
  res.json(await companies.setMemberRole(actorOf(req), recruiterId, role));
}

export async function removeMember(req: Request, res: Response) {
  await companies.removeMember(actorOf(req), parse(z.object({ recruiterId: id() }), req.params).recruiterId);
  res.status(204).end();
}

export async function follow(req: Request, res: Response) {
  res.json(await companies.follow(actorOf(req), slugOf(req), req.method !== "DELETE"));
}

export async function people(req: Request, res: Response) {
  res.json(await companies.people(req.actor, slugOf(req), page(req)));
}

export async function companyJobs(req: Request, res: Response) {
  const q = parse(z.object({ status: z.enum(["DRAFT", "OPEN", "CLOSED", "FILLED"]).optional() }), req.query);
  res.json(await jobs.forCompany(req.actor, slugOf(req), { ...q, ...page(req) }));
}

export async function posts(req: Request, res: Response) {
  const c = await companies.get(req.actor, slugOf(req));
  res.json(await feed.companyPosts(req.actor, c.id, page(req)));
}
