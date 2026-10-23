/**
 * Talent fixtures shared by the integration tests, built through the public API wherever
 * the API can do it:
 *
 *   const cand = await makeProfile();                       // a PUBLISHED talent page
 *   const rec = await makeCompanyRecruiter();               // ACTIVE recruiter of a new company
 *   const job = await makeJob(rec);                         // an OPEN job
 *   const app = await apply(cand, job.id);                  // an Easy Apply application
 *   const a = await approach(rec, cand);                    // a PENDING approach
 */
import { expect } from "vitest";
import type { Approach, Job, MyApplication, MyProfile, PlatformSettings, RecruiterAccount } from "@open-talent/types";
import { db } from "../../src/db/kysely";
import { sentMail } from "../../src/integrations/mail/mailer";
import { clearSettingsCache, DEFAULT_SETTINGS, saveSettings } from "../../src/services/settings.service";
import { as, createUser, type RequestPolicy, type Role, type TestUser } from "./harness";

let n = 0;
export function uniq(prefix = "c"): string {
  n += 1;
  return `${prefix}${Date.now().toString(36)}${process.pid.toString(36)}${n}`;
}

/** Fail with the response body in the message, which is what you want to read when a fixture breaks. */
function ok(res: { status: number; body: unknown }, status = 200): void {
  expect(res.status, JSON.stringify(res.body)).toBe(status);
}

// ─── Platform staff ─────────────────────────────────────────────────────────

const staff = new Map<Role, Promise<TestUser>>();
/** One operator per role per file (created on first use). */
export function operator(role: Exclude<Role, "USER"> = "ADMIN"): Promise<TestUser> {
  let p = staff.get(role);
  if (!p) {
    p = createUser({ role, displayName: `Operator ${role.toLowerCase()}` });
    staff.set(role, p);
  }
  return p;
}

// ─── Profiles ───────────────────────────────────────────────────────────────

export interface ContactInput {
  email: string | null;
  phone: string | null;
  whatsapp: string | null;
}

export interface ProfileOptions {
  user?: TestUser;
  displayName?: string;
  requestPolicy?: RequestPolicy;
  headline?: string;
  about?: string;
  location?: string;
  skills?: string[];
  /** Contact details (all private). Defaults to a unique email and phone. */
  contact?: Partial<ContactInput>;
  /** PUBLISHED (default), UNLISTED or DRAFT (sections filled, never published). */
  status?: "PUBLISHED" | "UNLISTED" | "DRAFT";
  openToWork?: "OFF" | "RECRUITERS" | "PUBLIC";
  role?: Role;
}

export interface Talent extends TestUser {
  contact: ContactInput;
  profile: MyProfile;
}

let phoneSeq = 0;
/** A unique, valid international phone number in the fictional 555 range. */
export function uniquePhone(): string {
  phoneSeq += 1;
  return `+1555${String((Date.now() % 100000) * 100 + (phoneSeq % 100)).padStart(7, "0")}`;
}

/** Fill every section, the basics and the private contact channels, then publish (through the API). */
export async function makeProfile(o: ProfileOptions = {}): Promise<Talent> {
  const user = o.user ?? (await createUser({ displayName: o.displayName, requestPolicy: o.requestPolicy, role: o.role }));
  const c = as(user);
  ok(await c.patch("/api/profiles/me").send({ headline: o.headline ?? "Backend engineer who ships calm systems", about: o.about ?? "I build APIs, queues and the boring parts that keep a product up at night.", currentTitle: "Software Engineer", location: o.location ?? "Lisbon, Portugal", yearsExperience: 6 }));
  ok(await c.put("/api/profiles/me/sections/experience").send({ items: [{ title: "Software Engineer", companyName: "Fictional Systems", startMonth: "2019-03", endMonth: null, description: "Built the billing pipeline.", skills: ["TypeScript"] }] }));
  ok(await c.put("/api/profiles/me/sections/skills").send({ items: (o.skills ?? ["TypeScript", "PostgreSQL", "Redis"]).map((name) => ({ name })) }));
  ok(await c.put("/api/profiles/me/sections/projects").send({ items: [{ name: "Queue visualiser", description: "Shows jobs moving through a queue.", url: "https://queue-viz.example.com" }] }));
  ok(await c.put("/api/profiles/me/sections/education").send({ items: [{ institution: "Example University", degree: "BSc", field: "Computer Science", startYear: 2011, endYear: 2015 }] }));
  ok(await c.put("/api/profiles/me/sections/links").send({ items: [{ kind: "GITHUB", url: `https://github.example.com/${user.username}` }] }));
  const contact: ContactInput = { email: `private.${user.username}@contact.example.test`, phone: uniquePhone(), whatsapp: null, ...(o.contact ?? {}) };
  ok(await c.put("/api/profiles/me/contact").send(contact));
  if (o.openToWork && o.openToWork !== "OFF") ok(await c.put("/api/profiles/me/open-to-work").send({ mode: o.openToWork, roles: ["Backend Engineer"], employmentTypes: [], workplaceTypes: [] }));
  const status = o.status ?? "PUBLISHED";
  if (status !== "DRAFT") ok(await c.post("/api/profiles/me/status").send({ status }));
  const profile = (await c.get("/api/profiles/me").expect(200)).body as MyProfile;
  return { ...user, contact, profile };
}

// ─── Network ────────────────────────────────────────────────────────────────

/** a asks, b accepts: connected. */
export async function connect(a: TestUser, b: TestUser): Promise<void> {
  const res = await as(a).post("/api/network/connections").send({ userId: b.id });
  ok(res);
  if (res.body.state === "CONNECTED") return;
  ok(await as(b).post(`/api/network/invitations/${res.body.connectionId}/accept`).send({}), 204);
}

export async function block(blocker: TestUser, blocked: TestUser): Promise<void> {
  ok(await as(blocker).post(`/api/users/${blocked.id}/block`).send({}), 204);
}

export async function follow(follower: TestUser, followed: TestUser): Promise<void> {
  ok(await as(follower).post(`/api/users/${followed.id}/follow`).send({}), 204);
}

// ─── Recruiters and companies ───────────────────────────────────────────────

/** The newest work-email code sent to this address (codes are emailed, only their HMAC is stored). */
export function lastCodeFor(email: string): string {
  const mail = [...sentMail()].reverse().find((m) => m.to.toLowerCase() === email.toLowerCase() && /work email code/.test(m.subject));
  if (!mail) throw new Error(`no work email code was sent to ${email}`);
  const code = /^(\d{6}) /.exec(mail.subject)?.[1];
  if (!code) throw new Error(`no code in "${mail.subject}"`);
  return code;
}

export interface Recruiter extends TestUser {
  workEmail: string;
  recruiterId: string;
  company: { id: string; slug: string; name: string; domain: string };
  account: RecruiterAccount;
}

export interface RecruiterOptions {
  user?: TestUser;
  displayName?: string;
  /** Join this company (by slug) instead of creating a new one. */
  companySlug?: string;
  /** The domain of a new company (and of the work email). Default: a unique *.test domain. */
  domain?: string;
  companyName?: string;
  /** Work email local part or a full address. */
  workEmail?: string;
  /** Stop after registering (EMAIL_PENDING) or after the code (PENDING_REVIEW); default ACTIVE. */
  stopAt?: "EMAIL_PENDING" | "PENDING_REVIEW" | "ACTIVE";
}

/** Register for a company (a new one by default), confirm the work email with the mailed code, then an admin approves. */
export async function makeCompanyRecruiter(o: RecruiterOptions = {}): Promise<Recruiter> {
  const user = o.user ?? (await createUser({ displayName: o.displayName ?? "Riley Recruiter" }));
  let domain = o.domain ?? `${uniq("co")}.test`;
  if (o.companySlug && !o.domain) {
    const c = await db.selectFrom("companies").select("domains").where("slug", "=", o.companySlug).executeTakeFirstOrThrow();
    domain = c.domains.length ? String(c.domains[0]) : domain;
  }
  const workEmail = o.workEmail?.includes("@") ? o.workEmail : `${o.workEmail ?? user.username}@${domain}`;
  const body = o.companySlug ? { companySlug: o.companySlug, workEmail, title: "Talent Partner" } : { newCompany: { name: o.companyName ?? `Company ${uniq("n")}`, website: `https://${domain}` }, workEmail, title: "Talent Partner" };
  const reg = await as(user).post("/api/recruiter/register").send(body);
  ok(reg, 201);
  let account = reg.body as RecruiterAccount;
  if (o.stopAt !== "EMAIL_PENDING") {
    const verified = await as(user).post("/api/recruiter/me/verify").send({ code: lastCodeFor(workEmail) });
    ok(verified);
    account = verified.body as RecruiterAccount;
    if (o.stopAt !== "PENDING_REVIEW" && account.status === "PENDING_REVIEW") {
      const admin = await operator("ADMIN");
      ok(await as(admin).post(`/api/admin/recruiters/${account.id}/review`).send({ decision: "APPROVE", note: null }), 204);
      account = (await as(user).get("/api/recruiter/me").expect(200)).body as RecruiterAccount;
    }
  }
  return { ...user, workEmail, recruiterId: account.id, company: { id: account.company.id, slug: account.company.slug, name: account.company.name, domain }, account };
}

/** Another ACTIVE recruiter joining an existing recruiter's company. */
export function teammate(of: Recruiter, o: Omit<RecruiterOptions, "companySlug"> = {}): Promise<Recruiter> {
  return makeCompanyRecruiter({ ...o, companySlug: of.company.slug, domain: of.company.domain });
}

/** Mark a company VERIFIED (and optionally allow domain auto-approval) through the admin API. */
export async function verifyCompany(companyId: string, autoApproveDomain = true): Promise<void> {
  const admin = await operator("ADMIN");
  ok(await as(admin).patch(`/api/admin/companies/${companyId}`).send({ status: "VERIFIED", autoApproveDomain }));
}

// ─── Jobs and applications ──────────────────────────────────────────────────

export interface JobOptions {
  title?: string;
  description?: string;
  skills?: string[];
  publish?: boolean;
  workplaceType?: "ONSITE" | "HYBRID" | "REMOTE";
  employmentType?: "FULL_TIME" | "PART_TIME" | "CONTRACT" | "FREELANCE" | "INTERNSHIP" | "TEMPORARY";
  location?: string | null;
  screeningQuestions?: { prompt: string; kind: "TEXT" | "YES_NO"; required: boolean }[];
  [extra: string]: unknown;
}

export async function makeJob(r: TestUser, o: JobOptions = {}): Promise<Job> {
  const { title, description, skills, publish, workplaceType, employmentType, ...rest } = o;
  const res = await as(r)
    .post("/api/jobs")
    .send({
      title: title ?? `Backend Engineer ${uniq("j")}`,
      description: description ?? "Build and run the services behind a calm, well tested product. You will own APIs and queues.",
      employmentType: employmentType ?? "FULL_TIME",
      workplaceType: workplaceType ?? "REMOTE",
      skills: skills ?? ["TypeScript", "PostgreSQL"],
      publish: publish ?? true,
      ...rest,
    });
  ok(res, 201);
  return res.body as Job;
}

export async function apply(candidate: TestUser, jobId: string, body: Record<string, unknown> = {}): Promise<MyApplication> {
  const res = await as(candidate).post(`/api/jobs/${jobId}/apply`).send(body);
  ok(res, 201);
  return res.body as MyApplication;
}

// ─── Approaches ─────────────────────────────────────────────────────────────

export const APPROACH_MESSAGE = "Hello, we are building a small platform team and your queue work caught our eye.";

export async function approach(r: TestUser, candidate: TestUser, over: Record<string, unknown> = {}): Promise<Approach> {
  const res = await as(r)
    .post("/api/approaches")
    .send({ username: candidate.username, roleTitle: "Platform Engineer", message: APPROACH_MESSAGE, ...over });
  ok(res, 201);
  return res.body as Approach;
}

/** A recruiter, a published candidate and an approach the candidate accepted, sharing `channels`. */
export async function acceptedApproach(channels: ("EMAIL" | "PHONE" | "WHATSAPP")[] = ["EMAIL"], o: { recruiter?: Recruiter; candidate?: Talent } = {}) {
  const recruiter = o.recruiter ?? (await makeCompanyRecruiter());
  const candidate = o.candidate ?? (await makeProfile({ contact: { whatsapp: uniquePhone() } }));
  const a = await approach(recruiter, candidate);
  const res = await as(candidate).post(`/api/approaches/${a.id}/accept`).send({ channels });
  ok(res);
  return { recruiter, candidate, approach: res.body as Approach };
}

// ─── Settings ───────────────────────────────────────────────────────────────

type SettingsPatch = { [K in keyof PlatformSettings]?: PlatformSettings[K] extends object ? Partial<PlatformSettings[K]> : PlatformSettings[K] };

/** Merge a patch into the platform settings (group by group), bypassing the HTTP validator. */
export async function setSettings(patch: SettingsPatch): Promise<void> {
  const admin = await operator("ADMIN");
  await saveSettings(patch as Partial<PlatformSettings>, admin.id);
  clearSettingsCache();
}

export async function resetSettings(): Promise<void> {
  await db.deleteFrom("settings").where("key", "=", "platform").execute();
  clearSettingsCache();
}

export { DEFAULT_SETTINGS };

// ─── Reading back ───────────────────────────────────────────────────────────

/** Walk every page of a list endpoint and return all items. */
export async function allPages<T = any>(fetchPage: (cursor: string | null) => Promise<{ items: T[]; nextCursor: string | null } | any>, maxPages = 50): Promise<T[]> {
  const out: T[] = [];
  let cursor: string | null = null;
  for (let i = 0; i < maxPages; i++) {
    const page = (await fetchPage(cursor)) as { items: T[]; nextCursor: string | null };
    out.push(...page.items);
    if (!page.nextCursor) return out;
    cursor = page.nextCursor;
  }
  throw new Error("too many pages");
}

export async function notificationsOf(userId: string) {
  return db.selectFrom("notifications").selectAll().where("recipient_id", "=", userId).orderBy("created_at", "desc").execute();
}

/** Poll until `check` passes (for work that finishes after the response, like inline jobs). */
export async function waitFor(check: () => boolean | Promise<boolean>, timeoutMs = 3000): Promise<void> {
  const until = Date.now() + timeoutMs;
  while (Date.now() < until) {
    if (await check()) return;
    await new Promise((r) => setTimeout(r, 25));
  }
  throw new Error("timed out waiting");
}
