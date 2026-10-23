/**
 * /api/profiles: the talent page. Every body is a strict zod schema with bounded sizes
 * (the source took sections of any size and any shape), and identity always comes from
 * the session, never from the body.
 */
import { EMPLOYMENT_TYPES, LINK_KINDS, PAY_PERIODS, PROFILE_SECTIONS, WORKPLACE_TYPES } from "@open-talent/types";
import type { Request, Response } from "express";
import { z } from "zod";
import { HttpError } from "../core/errors";
import { id, parse, text } from "../core/validate";
import { actorOf, meta } from "../middleware/http";
import * as imports from "../services/import.service";
import * as profiles from "../services/profile.service";
import * as resume from "../services/resume.service";
import * as trust from "../services/trust.service";
import { usernameOf } from "./user.controller";

const opt = (max: number) =>
  z
    .string()
    .trim()
    .max(max)
    .nullable()
    .optional()
    .transform((v) => (v ? v : null));
const ym = z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/, "use YYYY-MM");
const skillList = z.array(text(60, 1)).max(20).optional();
const phone = z
  .string()
  .trim()
  .regex(/^\+[1-9][0-9]{6,14}$/, "use international format, e.g. +15551234567")
  .nullable();

const basics = z
  .object({
    headline: opt(160),
    about: opt(4000),
    currentTitle: opt(120),
    currentCompany: opt(120),
    location: opt(120),
    countryCode: z.string().regex(/^[A-Za-z]{2}$/).nullable().optional(),
    timezone: opt(64),
    yearsExperience: z.number().int().min(0).max(70).nullable().optional(),
    languages: z.array(text(40, 1)).max(15).optional(),
    rate: z.object({ min: z.number().int().min(0).nullable(), max: z.number().int().min(0).nullable(), currency: z.string().regex(/^[A-Za-z]{3}$/).nullable(), period: z.enum(PAY_PERIODS).nullable() }).nullable().optional(),
  })
  .strict();

const openToWork = z
  .object({
    mode: z.enum(["OFF", "RECRUITERS", "PUBLIC"]),
    roles: z.array(text(80, 1)).max(5).default([]),
    employmentTypes: z.array(z.enum(EMPLOYMENT_TYPES)).max(6).default([]),
    workplaceTypes: z.array(z.enum(WORKPLACE_TYPES)).max(3).default([]),
    availableFrom: z.string().date().nullable().default(null),
  })
  .strict();

const contact = z.object({ email: z.string().trim().email().max(200).nullable(), phone, whatsapp: phone }).strict();
const audience = z.enum(["PUBLIC", "CONNECTIONS", "RECRUITERS"]);
const visibility = z.object(Object.fromEntries(PROFILE_SECTIONS.map((s) => [s, audience.optional()]))).strict();

const sections = {
  experience: z
    .array(
      z
        .object({
          title: text(120, 1),
          companyName: text(120, 1),
          companySlug: z.string().max(60).nullable().optional(),
          employmentType: z.enum(EMPLOYMENT_TYPES).nullable().optional(),
          workplaceType: z.enum(WORKPLACE_TYPES).nullable().optional(),
          location: opt(120),
          startMonth: ym,
          endMonth: ym.nullable().optional(),
          description: opt(3000),
          skills: skillList,
        })
        .strict(),
    )
    .max(30),
  education: z
    .array(
      z
        .object({
          institution: text(160, 1),
          degree: opt(120),
          field: opt(120),
          startYear: z.number().int().min(1900).max(2100).nullable().optional(),
          endYear: z.number().int().min(1900).max(2100).nullable().optional(),
          grade: opt(40),
          description: opt(2000),
        })
        .strict(),
    )
    .max(15),
  projects: z
    .array(
      z
        .object({ name: text(120, 1), description: opt(3000), url: opt(500), repoUrl: opt(500), coverUploadId: id().nullable().optional(), skills: skillList, startMonth: ym.nullable().optional(), endMonth: ym.nullable().optional() })
        .strict(),
    )
    .max(20),
  skills: z.array(z.object({ name: text(60, 1), category: opt(60), years: z.number().int().min(0).max(60).nullable().optional() }).strict()).max(50),
  certifications: z
    .array(z.object({ name: text(160, 1), issuer: opt(120), issuedMonth: ym.nullable().optional(), expiresMonth: ym.nullable().optional(), credentialId: opt(120), credentialUrl: opt(500) }).strict())
    .max(30),
  links: z.array(z.object({ kind: z.enum(LINK_KINDS), url: text(500, 1), label: opt(80), featured: z.boolean().optional() }).strict()).max(15),
};

export async function mine(req: Request, res: Response) {
  res.json(await profiles.getMine(actorOf(req)));
}

export async function updateBasics(req: Request, res: Response) {
  res.json(await profiles.updateBasics(actorOf(req), parse(basics, req.body)));
}

export async function updateOpenToWork(req: Request, res: Response) {
  res.json(await profiles.updateOpenToWork(actorOf(req), parse(openToWork, req.body)));
}

export async function updateContact(req: Request, res: Response) {
  res.json(await profiles.updateContact(actorOf(req), parse(contact, req.body)));
}

export async function updateVisibility(req: Request, res: Response) {
  res.json(await profiles.updateVisibility(actorOf(req), parse(visibility, req.body)));
}

export async function setCover(req: Request, res: Response) {
  const { uploadId } = parse(z.object({ uploadId: id().nullable() }).strict(), req.body);
  res.json(await profiles.setCover(actorOf(req), uploadId));
}

export async function replaceSection(req: Request, res: Response) {
  const { section } = parse(z.object({ section: z.enum(PROFILE_SECTIONS) }), req.params);
  const { items } = parse(z.object({ items: sections[section] }).strict(), req.body);
  res.json(await profiles.replaceSection(actorOf(req), { section, items } as profiles.SectionInput));
}

export async function setStatus(req: Request, res: Response) {
  const { status } = parse(z.object({ status: z.enum(["PUBLISHED", "UNLISTED", "DRAFT"]) }).strict(), req.body);
  res.json(await profiles.setStatus(actorOf(req), status));
}

export async function usernameCheck(req: Request, res: Response) {
  const { u } = parse(z.object({ u: z.string().trim().min(1).max(60) }), req.query);
  res.json(await profiles.usernameAvailable(u, req.actor));
}

export async function changeUsername(req: Request, res: Response) {
  const { username } = parse(z.object({ username: z.string().trim().min(3).max(40) }).strict(), req.body);
  res.json(await profiles.changeUsername(actorOf(req), username));
}

export async function analytics(req: Request, res: Response) {
  res.json(await profiles.analytics(actorOf(req)));
}

export async function contactLog(req: Request, res: Response) {
  res.json(await profiles.contactLog(actorOf(req)));
}

export async function badgeVisibility(req: Request, res: Response) {
  const { badgeId } = parse(z.object({ badgeId: id() }), req.params);
  const { visible } = parse(z.object({ visible: z.boolean() }).strict(), req.body);
  res.json(await profiles.setBadgeVisibility(actorOf(req), badgeId, visible));
}

export async function exportResume(req: Request, res: Response) {
  const { format } = parse(z.object({ format: z.enum(["pdf", "docx"]) }), req.params);
  const out = await resume.exportResume(actorOf(req), format === "pdf" ? "PDF" : "DOCX");
  res.setHeader("Content-Type", out.contentType);
  res.setHeader("Content-Disposition", `attachment; filename="${out.fileName}"`);
  res.setHeader("Cache-Control", "no-store");
  res.end(out.body);
}

export async function startImport(req: Request, res: Response) {
  const body = parse(z.object({ text: z.string().max(30000).nullable().optional(), uploadId: id().nullable().optional() }).strict(), req.body);
  res.status(202).json(await imports.start(actorOf(req), body));
}

export async function latestImport(req: Request, res: Response) {
  res.json(await imports.latest(actorOf(req)));
}

export async function getImport(req: Request, res: Response) {
  res.json(await imports.get(actorOf(req), parse(z.object({ id: id() }), req.params).id));
}

export async function applyImport(req: Request, res: Response) {
  const body = parse(z.object({ sections: z.array(z.enum(PROFILE_SECTIONS)).max(6).default([]), basics: z.boolean().default(true), badges: z.boolean().default(true) }).strict(), req.body);
  res.json(await imports.apply(actorOf(req), parse(z.object({ id: id() }), req.params).id, body));
}

export async function polish(req: Request, res: Response) {
  const body = parse(z.object({ field: z.enum(["headline", "about", "experience", "project"]), text: text(4000, 3) }).strict(), req.body);
  res.json(await imports.polish(actorOf(req), body.field, body.text));
}

export async function publicProfile(req: Request, res: Response) {
  try {
    res.json(await profiles.getPublic(req.actor, usernameOf(req)));
  } catch (err) {
    // A renamed handle: tell the client where it went (the web app issues the redirect).
    if (err instanceof HttpError && err.code === "PROFILE_MOVED") {
      res.status(301).json({ error: err.message, code: err.code, details: err.details, requestId: req.requestId });
      return;
    }
    throw err;
  }
}

export async function view(req: Request, res: Response) {
  await profiles.recordView(req.actor, usernameOf(req), meta(req).ip);
  res.status(204).end();
}

export async function endorse(req: Request, res: Response) {
  const { skillId } = parse(z.object({ skillId: id() }), req.params);
  res.json(await profiles.endorse(actorOf(req), skillId, req.method !== "DELETE"));
}

export async function ratings(req: Request, res: Response) {
  res.json(await trust.ratingsFor(usernameOf(req)));
}
