/** /api/search and /api/search/people: finding people, jobs and companies. */
import { EMPLOYMENT_TYPES, WORKPLACE_TYPES } from "@open-talent/types";
import type { Request, Response } from "express";
import { z } from "zod";
import { parse } from "../core/validate";
import * as directory from "../services/directory.service";
import { page } from "./user.controller";

const list = (values: readonly string[]) =>
  z
    .string()
    .optional()
    .transform((v) => (v ? v.split(",").map((s) => s.trim()).filter(Boolean) : undefined))
    .pipe(z.array(z.enum(values as [string, ...string[]])).optional());

const query = z.object({
  q: z.string().trim().max(100).optional(),
  skills: z
    .string()
    .max(600)
    .optional()
    .transform((v) => (v ? v.split(",").map((s) => s.trim()).filter(Boolean).slice(0, 10) : undefined)),
  location: z.string().trim().max(120).optional(),
  openToWork: z
    .enum(["true", "false"])
    .optional()
    .transform((v) => v === "true"),
  employment: list(EMPLOYMENT_TYPES),
  workplace: list(WORKPLACE_TYPES),
  minYears: z.coerce.number().int().min(0).max(70).optional(),
  maxYears: z.coerce.number().int().min(0).max(70).optional(),
  sort: z.enum(["relevance", "recent", "experience"]).optional(),
});

export async function people(req: Request, res: Response) {
  const q = parse(query, req.query);
  res.json(await directory.search(req.actor, { ...(q as directory.DirectoryQuery), ...page(req) }));
}

export async function facets(_req: Request, res: Response) {
  res.setHeader("Cache-Control", "public, max-age=300");
  res.json(await directory.facets());
}

export async function everything(req: Request, res: Response) {
  const { q } = parse(z.object({ q: z.string().trim().min(1).max(100) }), req.query);
  res.json(await directory.everything(req.actor, q));
}
