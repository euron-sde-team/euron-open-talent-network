/**
 * Demo data: a fictional hiring network so a fresh install has something to look at.
 * Run with `pnpm demo:seed` (or `node dist/cli.js demo:seed`).
 *
 *   - 8 invented companies on reserved .example domains, most verified, with logos,
 *     covers, recruiter teams and open jobs (one of them waits in the review queue)
 *   - about 40 people with full talent pages: experience, education, skills (with
 *     endorsements), projects, links, open-to-work signals and private contact details
 *   - a connection graph, follows, a feed of posts (personal, company and hiring posts)
 *     with reactions and comments
 *   - applications at every pipeline stage, recruiter approaches (pending, accepted
 *     with shared channels, declined), conversations, engagements with revealed
 *     double-blind ratings, open complaints and recruiter applications for /admin
 *
 * Avatars are initials on a gradient and logos are geometric marks, rendered in code
 * with sharp: no stock photos, no faces. Everything that has a service goes through it,
 * so counters, notifications and moderation records are what real use would produce.
 *
 * Refuses to run with NODE_ENV=production. If the demo admin already exists it only
 * prints the logins and exits.
 */
import crypto from "node:crypto";
import sharp from "sharp";
import type { Actor } from "../core/context";
import { config } from "../core/config";
import { newId } from "../core/ids";
import { db } from "../db/kysely";
import { pairKey } from "../domain/can-message";
import { readQuestions } from "../domain/screening";
import { storage } from "../integrations/storage";
import { closeRedis } from "../integrations/redis";
import { closeQueues } from "../jobs/registry";
import { hashPassword } from "../security/passwords";
import * as applications from "../services/application.service";
import * as approaches from "../services/approach.service";
import * as comments from "../services/comment.service";
import { reconcileCounters } from "../services/counters.service";
import * as dms from "../services/dm.service";
import * as jobs from "../services/job.service";
import * as network from "../services/network.service";
import * as posts from "../services/post.service";
import * as profiles from "../services/profile.service";
import * as reactions from "../services/reaction.service";
import * as directory from "../services/directory.service";
import { createReport } from "../services/moderation/reports.service";
import { getSettings, saveSettings } from "../services/settings.service";
import * as trust from "../services/trust.service";
import * as users from "../services/user.service";

const ADMIN_EMAIL = "admin@example.com";

// ─── Deterministic randomness ───────────────────────────────────────────────

function mulberry32(seed: number) {
  let a = seed;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const rand = mulberry32(20261023);
const int = (min: number, max: number) => Math.floor(rand() * (max - min + 1)) + min;
const pick = <T>(xs: readonly T[]): T => xs[Math.floor(rand() * xs.length)] as T;
function sample<T>(xs: readonly T[], n: number): T[] {
  const copy = [...xs];
  for (let i = copy.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    [copy[i], copy[j]] = [copy[j] as T, copy[i] as T];
  }
  return copy.slice(0, Math.max(0, Math.min(n, copy.length)));
}

// ─── Images ─────────────────────────────────────────────────────────────────

const PALETTES = [
  ["#1e3a8a", "#3b82f6"],
  ["#0f766e", "#14b8a6"],
  ["#7c2d12", "#ea580c"],
  ["#581c87", "#9333ea"],
  ["#14532d", "#16a34a"],
  ["#831843", "#db2777"],
  ["#713f12", "#ca8a04"],
  ["#0c4a6e", "#0284c7"],
  ["#334155", "#64748b"],
] as const;

function initials(name: string): string {
  const parts = name.split(/\s+/).filter(Boolean);
  return ((parts[0]?.[0] ?? "") + (parts[parts.length - 1]?.[0] ?? "")).toUpperCase();
}

function avatarSvg(name: string, variant: number): string {
  const [dark, mid] = PALETTES[variant % PALETTES.length]!;
  return `<svg xmlns="http://www.w3.org/2000/svg" width="320" height="320" viewBox="0 0 320 320">
  <defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="${mid}"/><stop offset="1" stop-color="${dark}"/></linearGradient></defs>
  <rect width="320" height="320" fill="url(#g)"/>
  <circle cx="250" cy="70" r="90" fill="#ffffff" fill-opacity="0.08"/>
  <text x="160" y="160" dy="0.35em" text-anchor="middle" font-family="DejaVu Sans, Helvetica, Arial, sans-serif" font-size="128" font-weight="700" fill="#ffffff" letter-spacing="2">${initials(name)}</text>
</svg>`;
}

function logoSvg(name: string, variant: number): string {
  const [dark, mid] = PALETTES[variant % PALETTES.length]!;
  const letter = name[0]!.toUpperCase();
  const shape = variant % 3 === 0 ? `<rect x="40" y="40" width="240" height="240" rx="56" fill="${mid}"/>` : variant % 3 === 1 ? `<circle cx="160" cy="160" r="122" fill="${mid}"/>` : `<path d="M160 34 L286 160 L160 286 L34 160 Z" fill="${mid}"/>`;
  return `<svg xmlns="http://www.w3.org/2000/svg" width="320" height="320" viewBox="0 0 320 320">
  <rect width="320" height="320" fill="#ffffff"/>
  ${shape}
  <rect x="96" y="210" width="128" height="14" rx="7" fill="${dark}" fill-opacity="0.45"/>
  <text x="160" y="150" dy="0.35em" text-anchor="middle" font-family="DejaVu Sans, Helvetica, Arial, sans-serif" font-size="118" font-weight="800" fill="#ffffff">${letter}</text>
</svg>`;
}

function bannerSvg(width: number, height: number, variant: number): string {
  const [dark, mid] = PALETTES[variant % PALETTES.length]!;
  const lines: string[] = [];
  for (let i = 0; i < 9; i++) {
    const y = Math.round((height / 9) * i + rand() * 20);
    lines.push(`<path d="M0 ${y} C ${width * 0.3} ${y - 40}, ${width * 0.6} ${y + 50}, ${width} ${y - 10}" stroke="#ffffff" stroke-opacity="${(0.05 + rand() * 0.1).toFixed(2)}" stroke-width="${int(2, 6)}" fill="none"/>`);
  }
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">
  <defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="0.4"><stop offset="0" stop-color="${dark}"/><stop offset="1" stop-color="${mid}"/></linearGradient></defs>
  <rect width="100%" height="100%" fill="url(#g)"/>
  ${lines.join("\n  ")}
</svg>`;
}

/** A simple "chart" or "board" picture for posts: bars and cards, no text. */
function postSvg(width: number, height: number, variant: number): string {
  const [dark, mid] = PALETTES[variant % PALETTES.length]!;
  const bars: string[] = [];
  const n = 7;
  for (let i = 0; i < n; i++) {
    const h = Math.round(height * (0.2 + rand() * 0.55));
    const x = Math.round(width * 0.1 + (width * 0.8 * i) / n);
    bars.push(`<rect x="${x}" y="${height - h - 40}" width="${Math.round((width * 0.8) / n - 16)}" height="${h}" rx="10" fill="${i % 2 ? mid : "#ffffff"}" fill-opacity="${i % 2 ? 0.95 : 0.85}"/>`);
  }
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">
  <rect width="100%" height="100%" fill="${dark}"/>
  <rect x="${width * 0.06}" y="${height * 0.08}" width="${width * 0.88}" height="${height * 0.84}" rx="24" fill="#ffffff" fill-opacity="0.07"/>
  ${bars.join("\n  ")}
</svg>`;
}

let imageCounter = 0;
async function storeImage(ownerId: string, purpose: "AVATAR" | "COVER" | "POST" | "COMPANY_LOGO" | "COMPANY_COVER", svg: string, width: number, height: number): Promise<string> {
  imageCounter += 1;
  const png = await sharp(Buffer.from(svg)).png({ compressionLevel: 9 }).toBuffer();
  const id = newId();
  const key = `demo/${purpose.toLowerCase()}/${id}.png`;
  await storage().put(key, png, "image/png");
  const thumb = await sharp(png).resize({ width: 640, withoutEnlargement: true }).webp({ quality: 80 }).toBuffer();
  await storage().put(`${key}.thumb.webp`, thumb, "image/webp");
  await db
    .insertInto("media_uploads")
    .values({ id, owner_id: ownerId, purpose, kind: "IMAGE", mime_type: "image/png", file_name: `${purpose.toLowerCase()}-${imageCounter}.png`, declared_size: png.length, size_bytes: png.length, storage_key: key, thumb_key: `${key}.thumb.webp`, width, height, status: "READY", moderation_state: "CLEAN", completed_at: new Date() })
    .execute();
  return id;
}

// ─── The cast ───────────────────────────────────────────────────────────────

interface CompanySpec {
  name: string;
  slug: string;
  domain: string;
  tagline: string;
  industry: string;
  size: "11-50" | "51-200" | "201-500" | "501-1000" | "1001-5000";
  hq: string;
  founded: number;
  verified: boolean;
  about: string;
}

const COMPANIES: CompanySpec[] = [
  { name: "Northwind Labs", slug: "northwind-labs", domain: "northwind.example", tagline: "Developer tools for teams that ship daily", industry: "Software", size: "201-500", hq: "Harbour City", founded: 2014, verified: true, about: "We build the build system, the review bot and the deploy pipeline that 4,000 engineering teams use every day. Small teams, written decisions, and a strong bias for boring technology." },
  { name: "Brightwater Robotics", slug: "brightwater-robotics", domain: "brightwater.example", tagline: "Warehouse robots that work alongside people", industry: "Robotics", size: "501-1000", hq: "Riverside", founded: 2016, verified: true, about: "Autonomous mobile robots for logistics. Our fleet software coordinates thousands of robots in real time, and our hardware team builds everything from motor controllers to chassis." },
  { name: "Cedar Health", slug: "cedar-health", domain: "cedarhealth.example", tagline: "Primary care, rebuilt around the patient", industry: "Healthcare", size: "1001-5000", hq: "Lakeside", founded: 2012, verified: true, about: "Clinics, a care app and a scheduling platform used by 300 practices. We hire clinicians, engineers and designers who care about getting the basics right for patients." },
  { name: "Lumen Studio", slug: "lumen-studio", domain: "lumenstudio.example", tagline: "A design studio for product teams", industry: "Design", size: "11-50", hq: "Old Town", founded: 2019, verified: true, about: "Brand, product and research for early-stage teams. We work in small pods and we write everything down." },
  { name: "Harbor Finance", slug: "harbor-finance", domain: "harborfinance.example", tagline: "Payments infrastructure for marketplaces", industry: "Fintech", size: "201-500", hq: "Harbour City", founded: 2017, verified: true, about: "Payouts, ledgers and compliance tooling for marketplaces in 30 countries. We take correctness seriously: every change to money movement is reviewed twice." },
  { name: "Quarry Analytics", slug: "quarry-analytics", domain: "quarry.example", tagline: "Analytics your whole company can read", industry: "Data", size: "51-200", hq: "Remote first", founded: 2020, verified: true, about: "A semantic layer and a notebook that turn messy warehouses into numbers people trust. Fully remote across six time zones." },
  { name: "Atlas Mobility", slug: "atlas-mobility", domain: "atlasmobility.example", tagline: "Shared e-bikes for mid-sized cities", industry: "Transportation", size: "51-200", hq: "Riverside", founded: 2021, verified: false, about: "E-bike fleets, a rider app and the operations software that keeps 9,000 bikes charged and where people need them." },
  { name: "Pinecone Games", slug: "pinecone-games", domain: "pinecone.example", tagline: "Cozy games, made by a small team", industry: "Games", size: "11-50", hq: "Old Town", founded: 2018, verified: false, about: "An independent studio making relaxed, beautiful games for PC and consoles." },
];

interface Role {
  title: string;
  company: string;
  companySlug?: string;
  start: string;
  end?: string;
  location?: string;
  description: string;
  skills: string[];
}

interface PersonSpec {
  name: string;
  headline: string;
  location: string;
  years: number;
  about: string;
  skills: string[];
  roles: Role[];
  school: { institution: string; degree: string; field: string; end: number };
  project?: { name: string; description: string; url: string; repo?: string; skills: string[] };
  otw?: "PUBLIC" | "RECRUITERS";
  otwRoles?: string[];
  draft?: boolean;
  /** Recruiter at this company slug, with this team role. */
  recruits?: { slug: string; role: "OWNER" | "ADMIN" | "RECRUITER"; title: string };
  platformRole?: "ADMIN" | "MODERATOR" | "RECRUITER_OPS";
}

const PEOPLE: PersonSpec[] = [
  { name: "Morgan Ellery", headline: "Network administrator", location: "Harbour City", years: 11, about: "I run this network. If something looks wrong, tell me.", skills: ["Operations", "Trust and safety", "Policy"], roles: [{ title: "Head of Trust", company: "Open Talent", start: "2022-01", description: "Policy, moderation and recruiter verification.", skills: ["Policy"] }], school: { institution: "State University", degree: "BA", field: "Sociology", end: 2012 }, platformRole: "ADMIN" },
  { name: "Quinn Avery", headline: "Community moderator", location: "Remote", years: 7, about: "I look after the moderation queue and the people in it.", skills: ["Moderation", "Community management"], roles: [{ title: "Senior Moderator", company: "Open Talent", start: "2023-03", description: "Case reviews and appeals.", skills: ["Moderation"] }], school: { institution: "Lakeside University", degree: "BA", field: "Communication", end: 2016 }, platformRole: "MODERATOR" },
  { name: "Rowan Pike", headline: "Recruiter operations", location: "Riverside", years: 6, about: "I review recruiter applications and company pages.", skills: ["Recruiting operations", "Compliance"], roles: [{ title: "Recruiter Operations Lead", company: "Open Talent", start: "2022-09", description: "Verification of recruiters and companies.", skills: ["Compliance"] }], school: { institution: "Riverside College", degree: "BSc", field: "Business", end: 2017 }, platformRole: "RECRUITER_OPS" },
  // Recruiters.
  { name: "Harper Lindqvist", headline: "Head of Talent at Northwind Labs", location: "Harbour City", years: 12, about: "I hire engineers who like writing things down. Ask me about our interview loop: it is short and we share the questions in advance.", skills: ["Technical recruiting", "Employer branding", "Interviewing"], roles: [{ title: "Head of Talent", company: "Northwind Labs", companySlug: "northwind-labs", start: "2019-02", description: "Built the recruiting team from one to six; time to hire down from 52 to 24 days.", skills: ["Technical recruiting"] }], school: { institution: "State University", degree: "BA", field: "Psychology", end: 2012 }, recruits: { slug: "northwind-labs", role: "OWNER", title: "Head of Talent" } },
  { name: "Dev Okafor", headline: "Technical Recruiter, Northwind Labs", location: "Remote", years: 5, about: "Engineering and product hiring. I answer every message, even when the answer is no.", skills: ["Technical recruiting", "Sourcing"], roles: [{ title: "Technical Recruiter", company: "Northwind Labs", companySlug: "northwind-labs", start: "2022-05", description: "Platform and developer experience teams.", skills: ["Sourcing"] }], school: { institution: "Riverside College", degree: "BA", field: "Economics", end: 2018 }, recruits: { slug: "northwind-labs", role: "RECRUITER", title: "Technical Recruiter" } },
  { name: "Sienna Marsh", headline: "Talent Partner at Brightwater Robotics", location: "Riverside", years: 8, about: "Hiring for robotics software, controls and hardware.", skills: ["Technical recruiting", "Hardware hiring"], roles: [{ title: "Talent Partner", company: "Brightwater Robotics", companySlug: "brightwater-robotics", start: "2020-08", description: "Robotics software and controls.", skills: ["Technical recruiting"] }], school: { institution: "Lakeside University", degree: "BSc", field: "Business", end: 2015 }, recruits: { slug: "brightwater-robotics", role: "OWNER", title: "Talent Partner" } },
  { name: "Aurelio Banks", headline: "Recruiting Lead, Cedar Health", location: "Lakeside", years: 9, about: "Clinical and tech hiring for a primary care network.", skills: ["Healthcare recruiting", "Technical recruiting"], roles: [{ title: "Recruiting Lead", company: "Cedar Health", companySlug: "cedar-health", start: "2018-11", description: "Clinicians, engineers and designers.", skills: ["Healthcare recruiting"] }], school: { institution: "Lakeside University", degree: "BA", field: "Human Resources", end: 2014 }, recruits: { slug: "cedar-health", role: "OWNER", title: "Recruiting Lead" } },
  { name: "Noor Haddad", headline: "Studio Lead at Lumen Studio", location: "Old Town", years: 13, about: "I run a small design studio and I hire slowly and carefully.", skills: ["Design leadership", "Brand strategy"], roles: [{ title: "Studio Lead", company: "Lumen Studio", companySlug: "lumen-studio", start: "2019-01", description: "Founded the studio; 14 people across brand, product and research.", skills: ["Design leadership"] }], school: { institution: "Old Town School of Design", degree: "MFA", field: "Communication Design", end: 2011 }, recruits: { slug: "lumen-studio", role: "OWNER", title: "Studio Lead" } },
  { name: "Ezra Whitlock", headline: "Engineering Recruiter, Harbor Finance", location: "Harbour City", years: 6, about: "Payments and platform engineering hiring.", skills: ["Technical recruiting", "Fintech"], roles: [{ title: "Engineering Recruiter", company: "Harbor Finance", companySlug: "harbor-finance", start: "2021-04", description: "Ledger, payouts and risk teams.", skills: ["Technical recruiting"] }], school: { institution: "City Polytechnic", degree: "BA", field: "Finance", end: 2017 }, recruits: { slug: "harbor-finance", role: "OWNER", title: "Engineering Recruiter" } },
  { name: "Imani Castell", headline: "People and Talent, Quarry Analytics", location: "Remote", years: 7, about: "Remote-first hiring across six time zones.", skills: ["Remote hiring", "Data team hiring"], roles: [{ title: "People and Talent Lead", company: "Quarry Analytics", companySlug: "quarry-analytics", start: "2021-01", description: "Data engineering, analytics and go-to-market.", skills: ["Remote hiring"] }], school: { institution: "State University", degree: "BA", field: "Sociology", end: 2016 }, recruits: { slug: "quarry-analytics", role: "OWNER", title: "People and Talent Lead" } },
  { name: "Callum Reyes", headline: "Operations Lead at Atlas Mobility", location: "Riverside", years: 10, about: "Hiring operations and software people for our e-bike fleet.", skills: ["Operations", "Hiring"], roles: [{ title: "Operations Lead", company: "Atlas Mobility", companySlug: "atlas-mobility", start: "2021-06", description: "Fleet operations and hiring.", skills: ["Operations"] }], school: { institution: "Riverside College", degree: "BSc", field: "Logistics", end: 2014 }, recruits: { slug: "atlas-mobility", role: "OWNER", title: "Operations Lead" } },
  // Candidates.
  { name: "Juniper Vale", headline: "Staff Engineer, build and developer experience", location: "Harbour City", years: 11, about: "I make builds fast and deploys boring. Most recently I cut CI time by 60% for a 400-engineer monorepo by caching per lockfile hash and splitting test shards by history.\n\nI like small teams, written proposals and on-call that does not hurt.", skills: ["TypeScript", "Go", "Bazel", "Kubernetes", "CI/CD", "PostgreSQL", "Developer experience"], roles: [{ title: "Staff Engineer", company: "Northwind Labs", companySlug: "northwind-labs", start: "2020-03", description: "Tech lead for build and CI. Led the move to remote caching; p50 CI time from 41 to 16 minutes.", skills: ["Bazel", "Go"] }, { title: "Senior Engineer", company: "Kestrel Systems", start: "2016-01", end: "2020-02", description: "Deployment tooling and the internal platform.", skills: ["Kubernetes", "TypeScript"] }, { title: "Software Engineer", company: "Lark Digital", start: "2013-07", end: "2015-12", description: "Web and API development.", skills: ["TypeScript"] }], school: { institution: "Harbour Institute of Technology", degree: "BSc", field: "Computer Science", end: 2013 }, project: { name: "lockfile-cache", description: "A CI cache keyed by lockfile hash that works with any package manager.", url: "https://lockfile-cache.example", repo: "https://github.com/example/lockfile-cache", skills: ["Go", "CI/CD"] }, otw: "RECRUITERS", otwRoles: ["Principal Engineer", "Staff Engineer"] },
  { name: "Orrin Featherstone", headline: "Senior Product Designer, design systems", location: "Old Town", years: 8, about: "I design systems that make product teams faster: tokens, components and the documentation that keeps them honest. I care about accessibility from the first sketch.", skills: ["Figma", "Design systems", "Accessibility", "Prototyping", "User research"], roles: [{ title: "Senior Product Designer", company: "Lumen Studio", companySlug: "lumen-studio", start: "2021-02", description: "Design systems for three client product teams.", skills: ["Design systems", "Figma"] }, { title: "Product Designer", company: "Cedar Health", companySlug: "cedar-health", start: "2017-06", end: "2021-01", description: "Scheduling and the patient app; ran the accessibility audit.", skills: ["Accessibility"] }], school: { institution: "Old Town School of Design", degree: "BA", field: "Interaction Design", end: 2016 }, project: { name: "Tokens to code", description: "A plugin that turns design tokens into CSS variables and docs.", url: "https://tokens.example", skills: ["Design systems"] }, otw: "PUBLIC", otwRoles: ["Lead Product Designer", "Design Systems Lead"] },
  { name: "Saffron Quill", headline: "Data Scientist, experimentation and causal inference", location: "Remote", years: 6, about: "I help teams decide with data they trust: experiment design, guardrail metrics and honest dashboards.", skills: ["Python", "SQL", "Experimentation", "Statistics", "dbt", "Machine Learning"], roles: [{ title: "Data Scientist", company: "Quarry Analytics", companySlug: "quarry-analytics", start: "2021-09", description: "Experimentation platform and the metric layer.", skills: ["Experimentation", "dbt"] }, { title: "Analyst", company: "Harbor Finance", companySlug: "harbor-finance", start: "2019-01", end: "2021-08", description: "Risk analytics and fraud models.", skills: ["Python", "SQL"] }], school: { institution: "Lakeside University", degree: "MSc", field: "Statistics", end: 2018 }, otw: "PUBLIC", otwRoles: ["Senior Data Scientist"] },
  { name: "Bramble Okoro", headline: "Engineering Manager, payments platform", location: "Harbour City", years: 12, about: "I lead teams that move money: ledgers, payouts and reconciliation. Calm on-call, clear ownership, and code reviews that teach.", skills: ["Engineering management", "Payments", "Java", "Kotlin", "PostgreSQL", "Distributed systems"], roles: [{ title: "Engineering Manager", company: "Harbor Finance", companySlug: "harbor-finance", start: "2019-05", description: "Two teams, 14 engineers; ledger rewrite with zero balance drift.", skills: ["Payments", "Engineering management"] }, { title: "Senior Engineer", company: "Tern Bank", start: "2013-02", end: "2019-04", description: "Core banking integrations.", skills: ["Java"] }], school: { institution: "City Polytechnic", degree: "BEng", field: "Software Engineering", end: 2012 } },
  { name: "Tamsin Wren", headline: "Frontend Engineer, React and accessibility", location: "Riverside", years: 4, about: "I build interfaces that work for everyone, with a keyboard, a screen reader or a slow phone.", skills: ["React", "TypeScript", "Accessibility", "Next.js", "CSS"], roles: [{ title: "Frontend Engineer", company: "Cedar Health", companySlug: "cedar-health", start: "2022-01", description: "Patient app web client; WCAG AA across every screen.", skills: ["React", "Accessibility"] }, { title: "Junior Developer", company: "Pebble Web", start: "2020-06", end: "2021-12", description: "Agency web projects.", skills: ["CSS"] }], school: { institution: "Riverside College", degree: "BSc", field: "Computer Science", end: 2020 }, project: { name: "Focus rings", description: "A tiny library of accessible focus styles.", url: "https://focus.example", repo: "https://github.com/example/focus-rings", skills: ["CSS", "Accessibility"] }, otw: "PUBLIC", otwRoles: ["Senior Frontend Engineer"] },
  { name: "Caspian Holloway", headline: "Head of Product, B2B SaaS", location: "Harbour City", years: 14, about: "Product leader for developer tools and data products. I like problems with clear users and messy constraints.", skills: ["Product management", "Product strategy", "Discovery", "Pricing"], roles: [{ title: "Head of Product", company: "Quarry Analytics", companySlug: "quarry-analytics", start: "2021-03", description: "Product for the semantic layer; grew paid seats 4x.", skills: ["Product strategy"] }, { title: "Group Product Manager", company: "Northwind Labs", companySlug: "northwind-labs", start: "2015-09", end: "2021-02", description: "CI and review products.", skills: ["Discovery"] }], school: { institution: "State University", degree: "MBA", field: "Business", end: 2012 } },
  { name: "Marigold Ashby", headline: "UX Researcher, mixed methods", location: "Lakeside", years: 7, about: "I run research that changes decisions: interviews, diary studies and surveys that are designed to be read.", skills: ["User research", "Usability testing", "Survey design", "Service design"], roles: [{ title: "Senior UX Researcher", company: "Cedar Health", companySlug: "cedar-health", start: "2020-04", description: "Research lead for scheduling and care navigation.", skills: ["User research"] }], school: { institution: "Lakeside University", degree: "MSc", field: "Human Computer Interaction", end: 2017 }, otw: "RECRUITERS", otwRoles: ["Lead UX Researcher"] },
  { name: "Thaddeus Grant", headline: "Site Reliability Engineer", location: "Remote", years: 9, about: "SLOs, incident response and the runbooks you write before you need them.", skills: ["Kubernetes", "Terraform", "AWS", "Observability", "Go", "Incident response"], roles: [{ title: "Senior SRE", company: "Brightwater Robotics", companySlug: "brightwater-robotics", start: "2020-01", description: "Fleet platform reliability; 99.95% availability across 40 sites.", skills: ["Kubernetes", "Observability"] }, { title: "Systems Engineer", company: "Kestrel Systems", start: "2015-03", end: "2019-12", description: "Infrastructure automation.", skills: ["Terraform"] }], school: { institution: "Harbour Institute of Technology", degree: "BSc", field: "Computer Engineering", end: 2015 }, otw: "RECRUITERS", otwRoles: ["Staff SRE", "Platform Engineer"] },
  { name: "Liesel Moreau", headline: "Robotics Software Engineer, motion planning", location: "Riverside", years: 5, about: "Motion planning and fleet coordination for warehouse robots.", skills: ["C++", "ROS", "Python", "Motion planning", "Linux"], roles: [{ title: "Robotics Software Engineer", company: "Brightwater Robotics", companySlug: "brightwater-robotics", start: "2021-02", description: "Path planning for 2,000 robots per site.", skills: ["C++", "Motion planning"] }], school: { institution: "Harbour Institute of Technology", degree: "MSc", field: "Robotics", end: 2020 }, project: { name: "Gridwalk", description: "A small multi-agent path planner for grids.", url: "https://gridwalk.example", repo: "https://github.com/example/gridwalk", skills: ["C++"] } },
  { name: "Felix Andersson", headline: "Backend Engineer, Go and Postgres", location: "Harbour City", years: 3, about: "APIs that are pleasant to use and queries that use their indexes.", skills: ["Go", "PostgreSQL", "gRPC", "Redis", "Docker"], roles: [{ title: "Backend Engineer", company: "Atlas Mobility", companySlug: "atlas-mobility", start: "2022-07", description: "Ride and fleet APIs.", skills: ["Go", "PostgreSQL"] }], school: { institution: "City Polytechnic", degree: "BSc", field: "Computer Science", end: 2022 }, otw: "PUBLIC", otwRoles: ["Backend Engineer"] },
  { name: "Priya Raman", headline: "Machine Learning Engineer, recommendations", location: "Remote", years: 6, about: "Ranking and recommendation systems from feature pipelines to online evaluation.", skills: ["Python", "PyTorch", "Machine Learning", "Spark", "MLOps"], roles: [{ title: "ML Engineer", company: "Quarry Analytics", companySlug: "quarry-analytics", start: "2022-02", description: "Query suggestions and anomaly detection.", skills: ["PyTorch"] }, { title: "Data Engineer", company: "Tern Bank", start: "2018-05", end: "2022-01", description: "Feature pipelines for fraud models.", skills: ["Spark"] }], school: { institution: "Lakeside University", degree: "MSc", field: "Computer Science", end: 2018 }, otw: "RECRUITERS", otwRoles: ["Senior ML Engineer"] },
  { name: "Gideon Hart", headline: "Product Manager, mobile", location: "Riverside", years: 5, about: "Mobile product: onboarding, retention and the details that make an app feel fast.", skills: ["Product management", "Mobile", "Analytics", "Experimentation"], roles: [{ title: "Product Manager", company: "Atlas Mobility", companySlug: "atlas-mobility", start: "2021-10", description: "Rider app; first-ride conversion up 18%.", skills: ["Mobile"] }], school: { institution: "State University", degree: "BA", field: "Economics", end: 2018 } },
  { name: "Wren Takahashi", headline: "Game Designer, systems and economy", location: "Old Town", years: 6, about: "Systems design for cozy games: crafting, economies and progression that respects players' time.", skills: ["Game design", "Unity", "Systems design", "Prototyping"], roles: [{ title: "Game Designer", company: "Pinecone Games", companySlug: "pinecone-games", start: "2020-09", description: "Lead systems designer on two shipped titles.", skills: ["Game design", "Unity"] }], school: { institution: "Old Town School of Design", degree: "BA", field: "Game Design", end: 2018 }, project: { name: "Tidepool", description: "A small game about keeping a tidepool healthy.", url: "https://tidepool.example", skills: ["Unity"] } },
  { name: "Esme Calloway", headline: "Clinical Informatics Nurse", location: "Lakeside", years: 10, about: "Bridging nursing and software: workflows, EHR configuration and training.", skills: ["Clinical informatics", "EHR", "Training", "Process improvement"], roles: [{ title: "Clinical Informatics Nurse", company: "Cedar Health", companySlug: "cedar-health", start: "2019-03", description: "Rolled out e-prescribing to 40 clinics.", skills: ["EHR"] }], school: { institution: "Lakeside University", degree: "BSN", field: "Nursing", end: 2013 } },
  { name: "Mateo Silva", headline: "Full Stack Engineer, TypeScript", location: "Remote", years: 4, about: "Next.js, Node and Postgres. I like owning a feature from the schema to the empty state.", skills: ["TypeScript", "React", "Node.js", "PostgreSQL", "Next.js"], roles: [{ title: "Full Stack Engineer", company: "Lumen Studio", companySlug: "lumen-studio", start: "2022-03", description: "Client product builds.", skills: ["Next.js"] }, { title: "Developer", company: "Pebble Web", start: "2020-01", end: "2022-02", description: "Agency work.", skills: ["React"] }], school: { institution: "Riverside College", degree: "BSc", field: "Information Systems", end: 2019 }, otw: "PUBLIC", otwRoles: ["Full Stack Engineer", "Product Engineer"] },
  { name: "Ines Varga", headline: "Security Engineer, application security", location: "Harbour City", years: 8, about: "Threat models, secure defaults and code review that developers thank you for.", skills: ["Application security", "Threat modeling", "Go", "Python", "Cloud security"], roles: [{ title: "Security Engineer", company: "Harbor Finance", companySlug: "harbor-finance", start: "2020-06", description: "AppSec for payments; ran the bug bounty program.", skills: ["Application security"] }], school: { institution: "Harbour Institute of Technology", degree: "MSc", field: "Information Security", end: 2016 } },
  { name: "Kofi Mensah", headline: "Data Engineer, warehouses and pipelines", location: "Remote", years: 5, about: "dbt, Airflow and the boring reliability that makes dashboards trustworthy.", skills: ["SQL", "dbt", "Airflow", "Python", "Snowflake"], roles: [{ title: "Data Engineer", company: "Quarry Analytics", companySlug: "quarry-analytics", start: "2022-01", description: "Customer warehouse onboarding.", skills: ["dbt", "SQL"] }], school: { institution: "City Polytechnic", degree: "BSc", field: "Mathematics", end: 2019 }, otw: "RECRUITERS", otwRoles: ["Senior Data Engineer", "Analytics Engineer"] },
  { name: "Astrid Nilsson", headline: "Hardware Engineer, motor control", location: "Riverside", years: 7, about: "Embedded firmware and power electronics for mobile robots.", skills: ["Embedded C", "Power electronics", "PCB design", "RTOS"], roles: [{ title: "Hardware Engineer", company: "Brightwater Robotics", companySlug: "brightwater-robotics", start: "2019-08", description: "Drive train motor controllers.", skills: ["Embedded C"] }], school: { institution: "Harbour Institute of Technology", degree: "BEng", field: "Electrical Engineering", end: 2017 } },
  { name: "Leo Brennan", headline: "Brand Designer", location: "Old Town", years: 5, about: "Identity systems, type and motion for products that want to feel human.", skills: ["Brand design", "Typography", "Illustration", "Motion design"], roles: [{ title: "Brand Designer", company: "Lumen Studio", companySlug: "lumen-studio", start: "2021-05", description: "Identity for nine product launches.", skills: ["Brand design"] }], school: { institution: "Old Town School of Design", degree: "BA", field: "Graphic Design", end: 2019 }, otw: "PUBLIC", otwRoles: ["Senior Brand Designer"] },
  { name: "Hana Kowalczyk", headline: "QA Engineer, test automation", location: "Lakeside", years: 6, about: "Playwright, contract tests and a test pyramid that actually has a base.", skills: ["Test automation", "Playwright", "TypeScript", "API testing"], roles: [{ title: "QA Engineer", company: "Cedar Health", companySlug: "cedar-health", start: "2020-10", description: "End-to-end suite for the patient app.", skills: ["Playwright"] }], school: { institution: "Lakeside University", degree: "BSc", field: "Software Engineering", end: 2018 } },
  { name: "Silas Okonjo", headline: "Engineering intern, platform", location: "Harbour City", years: 0, about: "Final-year computer science student, interested in compilers and build systems.", skills: ["Rust", "Python", "Linux"], roles: [{ title: "Engineering Intern", company: "Northwind Labs", companySlug: "northwind-labs", start: "2025-06", end: "2025-09", description: "Prototyped a Rust-based file watcher.", skills: ["Rust"] }], school: { institution: "Harbour Institute of Technology", degree: "BSc", field: "Computer Science", end: 2026 }, otw: "PUBLIC", otwRoles: ["Graduate Software Engineer"] },
  { name: "Delphine Roux", headline: "Technical Writer, developer documentation", location: "Remote", years: 7, about: "Docs people finish reading: tutorials, references and the information architecture between them.", skills: ["Technical writing", "Information architecture", "Docs as code", "Markdown"], roles: [{ title: "Technical Writer", company: "Northwind Labs", companySlug: "northwind-labs", start: "2020-02", description: "Developer docs for the CI product.", skills: ["Technical writing"] }], school: { institution: "State University", degree: "BA", field: "English", end: 2017 } },
  { name: "Arlo Fitzgerald", headline: "iOS Engineer", location: "Riverside", years: 5, about: "SwiftUI, offline-first sync and animations that feel right.", skills: ["Swift", "SwiftUI", "iOS", "Core Data"], roles: [{ title: "iOS Engineer", company: "Atlas Mobility", companySlug: "atlas-mobility", start: "2021-04", description: "Rider app iOS.", skills: ["SwiftUI"] }], school: { institution: "Riverside College", degree: "BSc", field: "Computer Science", end: 2020 }, otw: "RECRUITERS", otwRoles: ["Senior iOS Engineer"] },
  { name: "Yara Haddadi", headline: "Operations Analyst", location: "Riverside", years: 3, about: "Making fleets run on time with spreadsheets, SQL and good questions.", skills: ["SQL", "Excel", "Operations", "Forecasting"], roles: [{ title: "Operations Analyst", company: "Atlas Mobility", companySlug: "atlas-mobility", start: "2023-01", description: "Battery swap scheduling.", skills: ["Forecasting"] }], school: { institution: "Riverside College", degree: "BSc", field: "Operations Research", end: 2022 }, draft: true },
  { name: "Benedikt Aalto", headline: "Principal Engineer, distributed systems", location: "Harbour City", years: 16, about: "Consensus, storage engines and the operational discipline around them.", skills: ["Distributed systems", "Rust", "Go", "Storage", "Raft"], roles: [{ title: "Principal Engineer", company: "Kestrel Systems", start: "2017-01", description: "Storage layer architect.", skills: ["Rust", "Raft"] }], school: { institution: "Harbour Institute of Technology", degree: "PhD", field: "Computer Science", end: 2010 } },
  { name: "Clementine Duval", headline: "Product Marketing Manager", location: "Remote", years: 6, about: "Positioning and launches for technical products.", skills: ["Product marketing", "Positioning", "Content strategy"], roles: [{ title: "Product Marketing Manager", company: "Quarry Analytics", companySlug: "quarry-analytics", start: "2022-04", description: "Launched the semantic layer GA.", skills: ["Positioning"] }], school: { institution: "State University", degree: "BA", field: "Marketing", end: 2018 } },
  { name: "Rafael Okafor", headline: "DevOps Engineer", location: "Lakeside", years: 4, about: "Pipelines, containers and infrastructure as code.", skills: ["Docker", "Terraform", "AWS", "GitHub Actions"], roles: [{ title: "DevOps Engineer", company: "Cedar Health", companySlug: "cedar-health", start: "2022-05", description: "Migrated 30 services to containers.", skills: ["Docker", "Terraform"] }], school: { institution: "Lakeside University", degree: "BSc", field: "Computer Science", end: 2021 }, otw: "PUBLIC", otwRoles: ["Platform Engineer", "DevOps Engineer"] },
];

/** Recruiters waiting in the /admin review queue: an applicant per company, one using free mail. */
const PENDING_RECRUITERS = [
  { name: "Odette Laurent", headline: "Recruiter", slug: "pinecone-games", email: "odette@pinecone.example" },
  { name: "Bastian Kerr", headline: "Recruiting coordinator", slug: "atlas-mobility", email: "bastian.kerr@personal.example" },
];

const JOB_SPECS: { company: string; title: string; type: "FULL_TIME" | "CONTRACT" | "INTERNSHIP" | "PART_TIME"; workplace: "REMOTE" | "HYBRID" | "ONSITE"; seniority: "INTERN" | "ENTRY" | "MID" | "SENIOR" | "LEAD"; location: string; salary: [number, number]; skills: string[]; status?: "DRAFT" | "CLOSED" }[] = [
  { company: "northwind-labs", title: "Staff Engineer, Build Platform", type: "FULL_TIME", workplace: "HYBRID", seniority: "LEAD", location: "Harbour City", salary: [210000, 260000], skills: ["Go", "Bazel", "Kubernetes", "CI/CD"] },
  { company: "northwind-labs", title: "Senior Frontend Engineer", type: "FULL_TIME", workplace: "REMOTE", seniority: "SENIOR", location: "Remote", salary: [160000, 195000], skills: ["React", "TypeScript", "Accessibility"] },
  { company: "northwind-labs", title: "Developer Advocate", type: "FULL_TIME", workplace: "REMOTE", seniority: "MID", location: "Remote", salary: [130000, 160000], skills: ["Technical writing", "TypeScript"] },
  { company: "northwind-labs", title: "Engineering Intern, Summer", type: "INTERNSHIP", workplace: "ONSITE", seniority: "INTERN", location: "Harbour City", salary: [45, 55], skills: ["Python", "Rust"], status: "DRAFT" },
  { company: "brightwater-robotics", title: "Robotics Software Engineer, Fleet", type: "FULL_TIME", workplace: "ONSITE", seniority: "SENIOR", location: "Riverside", salary: [170000, 210000], skills: ["C++", "ROS", "Motion planning"] },
  { company: "brightwater-robotics", title: "Site Reliability Engineer", type: "FULL_TIME", workplace: "HYBRID", seniority: "SENIOR", location: "Riverside", salary: [165000, 200000], skills: ["Kubernetes", "Terraform", "Observability"] },
  { company: "cedar-health", title: "Senior UX Researcher", type: "FULL_TIME", workplace: "HYBRID", seniority: "SENIOR", location: "Lakeside", salary: [140000, 170000], skills: ["User research", "Usability testing"] },
  { company: "cedar-health", title: "Platform Engineer", type: "FULL_TIME", workplace: "REMOTE", seniority: "MID", location: "Remote", salary: [140000, 175000], skills: ["Docker", "Terraform", "AWS"] },
  { company: "cedar-health", title: "QA Automation Contractor", type: "CONTRACT", workplace: "REMOTE", seniority: "MID", location: "Remote", salary: [80, 110], skills: ["Playwright", "TypeScript"], status: "CLOSED" },
  { company: "lumen-studio", title: "Lead Product Designer", type: "FULL_TIME", workplace: "HYBRID", seniority: "LEAD", location: "Old Town", salary: [150000, 180000], skills: ["Figma", "Design systems", "Prototyping"] },
  { company: "lumen-studio", title: "Freelance Brand Designer", type: "CONTRACT", workplace: "REMOTE", seniority: "SENIOR", location: "Remote", salary: [90, 130], skills: ["Brand design", "Typography"] },
  { company: "harbor-finance", title: "Senior Backend Engineer, Ledger", type: "FULL_TIME", workplace: "HYBRID", seniority: "SENIOR", location: "Harbour City", salary: [180000, 220000], skills: ["Kotlin", "PostgreSQL", "Distributed systems"] },
  { company: "harbor-finance", title: "Application Security Engineer", type: "FULL_TIME", workplace: "HYBRID", seniority: "SENIOR", location: "Harbour City", salary: [175000, 215000], skills: ["Application security", "Threat modeling"] },
  { company: "quarry-analytics", title: "Senior Data Scientist", type: "FULL_TIME", workplace: "REMOTE", seniority: "SENIOR", location: "Remote", salary: [165000, 200000], skills: ["Python", "Experimentation", "Statistics"] },
  { company: "quarry-analytics", title: "Analytics Engineer", type: "FULL_TIME", workplace: "REMOTE", seniority: "MID", location: "Remote", salary: [135000, 165000], skills: ["SQL", "dbt", "Airflow"] },
  { company: "atlas-mobility", title: "Backend Engineer, Fleet APIs", type: "FULL_TIME", workplace: "HYBRID", seniority: "MID", location: "Riverside", salary: [120000, 150000], skills: ["Go", "PostgreSQL", "Redis"] },
];

const POST_LINES = [
  "We cut CI time in half by caching per lockfile hash. Write-up below, with the numbers.",
  "Three things I look for in a portfolio: the problem, the trade-offs you made, and what you would change.",
  "Our interview loop is four hours, one day, and we send you the questions in advance. Hiring should not be a quiz.",
  "Shipped the accessibility audit fixes today. Every screen now works with a keyboard and a screen reader.",
  "A guardrail metric saved us from shipping a change that would have looked like a win for a month.",
  "Hot take: the best on-call improvement is deleting alerts nobody acts on.",
  "Wrote down how we review design work: critique the problem, not the pixels. Happy to share the template.",
  "Twelve months, two products, one design system. Here is what we would do again and what we would not.",
  "If your job post says 'rockstar', I am not applying. If it lists the salary, I am reading.",
  "Notes from the incident review: the runbook existed, it was just two clicks too deep.",
  "We moved our data tests into the pull request. Broken dashboards dropped to almost zero.",
  "First week at a new team: I asked everyone what they would fix with a free week. Best onboarding I have done.",
];
const COMMENT_LINES = ["Great write-up, thank you.", "Saving this.", "We saw the same thing.", "Could you share the before and after?", "Strong agree.", "This is the kind of post I come here for.", "Congratulations to the whole team!", "Counterpoint: it depends on team size."];

function emailFor(name: string): string {
  return `${name.toLowerCase().replace(/[^a-z]+/g, ".").replace(/^\.|\.$/g, "")}@example.com`;
}
function usernameFor(name: string): string {
  return name.toLowerCase().replace(/[^a-z]+/g, "-").replace(/^-|-$/g, "").slice(0, 40);
}
function phoneFor(i: number): string {
  return `+1555${String(1000000 + i * 7919).slice(-7)}`;
}

function printLogins(password: string | null, fresh: boolean): void {
  const lines = [
    "",
    `${config.PRODUCT_NAME} demo data`,
    "",
    `  admin           ${ADMIN_EMAIL}`,
    `  moderator       ${emailFor(PEOPLE[1]!.name)}`,
    `  recruiter ops   ${emailFor(PEOPLE[2]!.name)}`,
    `  recruiter       ${emailFor(PEOPLE[3]!.name)}  (Northwind Labs, owner)`,
    `  candidate       ${emailFor(PEOPLE[11]!.name)}  (and about 30 more)`,
    "",
    password ? `  password        ${password}   (shared by every demo account${fresh ? "; shown once" : ", from DEMO_PASSWORD"})` : "  password        the one printed when the demo was first seeded, or DEMO_PASSWORD",
    "",
  ];
  process.stdout.write(lines.join("\n") + "\n");
}

async function quietly<T>(fn: () => Promise<T>): Promise<T | null> {
  try {
    return await fn();
  } catch {
    return null;
  }
}

export async function seedDemo(): Promise<void> {
  if (config.NODE_ENV === "production") throw new Error("demo:seed refuses to run with NODE_ENV=production");
  try {
    const existing = await db.selectFrom("users").select("id").where("email", "=", ADMIN_EMAIL).executeTakeFirst();
    if (existing) {
      printLogins(config.DEMO_PASSWORD ?? null, false);
      return;
    }
    await seed();
  } finally {
    await closeQueues().catch(() => undefined);
    await closeRedis().catch(() => undefined);
  }
}

async function seed(): Promise<void> {
  const password = config.DEMO_PASSWORD || crypto.randomBytes(9).toString("base64url");
  const hash = await hashPassword(password);
  const day = 86400_000;
  const now = Date.now();

  // ── Companies (created directly; recruiters join them below). ────────────
  const companyId = new Map<string, string>();
  for (const [i, c] of COMPANIES.entries()) {
    const id = newId();
    companyId.set(c.slug, id);
    await db
      .insertInto("companies")
      .values({
        id,
        slug: c.slug,
        name: c.name,
        tagline: c.tagline,
        about: c.about,
        website: `https://www.${c.domain}`,
        industry: c.industry,
        size_band: c.size,
        headquarters: c.hq,
        founded_year: c.founded,
        domains: [c.domain],
        auto_approve_domain: c.verified,
        status: c.verified ? "VERIFIED" : "UNVERIFIED",
        verified_at: c.verified ? new Date(now - 40 * day) : null,
        created_at: new Date(now - (200 - i * 10) * day),
      })
      .execute();
  }

  // ── People, their talent pages, and recruiter teams. ────────────────────
  const people: Actor[] = [];
  const byName = new Map<string, Actor>();
  for (const [i, p] of PEOPLE.entries()) {
    const id = newId();
    const email = p.platformRole === "ADMIN" ? ADMIN_EMAIL : emailFor(p.name);
    await db
      .insertInto("users")
      .values({ id, email, username: usernameFor(p.name), display_name: p.name, password_hash: hash, role: p.platformRole ?? "USER", status: "ACTIVE", email_verified_at: new Date(), created_at: new Date(now - (120 + int(0, 60)) * day) })
      .execute();
    await db.insertInto("talent_profiles").values({ id: newId(), user_id: id }).execute();
    const avatar = await storeImage(id, "AVATAR", avatarSvg(p.name, i), 320, 320);
    const cover = await storeImage(id, "COVER", bannerSvg(1500, 420, i + 3), 1500, 420);
    await db.updateTable("users").set({ avatar_upload_id: avatar, cover_upload_id: cover }).where("id", "=", id).execute();
    const actor: Actor = { id, username: usernameFor(p.name), displayName: p.name, role: p.platformRole ?? "USER", status: "ACTIVE" };
    people.push(actor);
    byName.set(p.name, actor);

    await profiles.updateBasics(actor, { headline: p.headline, about: p.about, location: p.location, yearsExperience: p.years, languages: ["English"] });
    await profiles.replaceSection(actor, {
      section: "experience",
      items: p.roles.map((r) => ({ title: r.title, companyName: r.company, companySlug: r.companySlug ?? null, startMonth: r.start, endMonth: r.end ?? null, location: r.location ?? null, description: r.description, skills: r.skills })),
    });
    await profiles.replaceSection(actor, { section: "education", items: [{ institution: p.school.institution, degree: p.school.degree, field: p.school.field, startYear: p.school.end - (p.school.degree.startsWith("M") || p.school.degree === "PhD" ? 2 : 4), endYear: p.school.end }] });
    await profiles.replaceSection(actor, { section: "skills", items: p.skills.map((name, k) => ({ name, years: Math.max(1, Math.min(p.years, p.years - k)) || null })) });
    if (p.project) await profiles.replaceSection(actor, { section: "projects", items: [{ name: p.project.name, description: p.project.description, url: p.project.url, repoUrl: p.project.repo ?? null, skills: p.project.skills }] });
    await profiles.replaceSection(actor, {
      section: "links",
      items: [
        { kind: "WEBSITE", url: `https://${usernameFor(p.name)}.example`, label: "Portfolio" },
        ...(p.project?.repo ? [{ kind: "GITHUB" as const, url: `https://github.com/example/${usernameFor(p.name)}`, label: null }] : []),
      ],
    });
    await profiles.updateContact(actor, { email, phone: phoneFor(i), whatsapp: i % 3 === 0 ? phoneFor(i) : null });
    if (p.otw) await profiles.updateOpenToWork(actor, { mode: p.otw, roles: p.otwRoles ?? [], employmentTypes: ["FULL_TIME"], workplaceTypes: ["REMOTE", "HYBRID"], availableFrom: null });
    if (!p.draft) await quietly(() => profiles.setStatus(actor, "PUBLISHED"));
    // Published at different times, so "recent" sorts look real.
    await db.updateTable("talent_profiles").set({ published_at: new Date(now - int(1, 90) * day) }).where("user_id", "=", id).where("status", "=", "PUBLISHED").execute();

    if (p.recruits) {
      const company = COMPANIES.find((c) => c.slug === p.recruits!.slug)!;
      await db
        .insertInto("recruiters")
        .values({ id: newId(), user_id: id, company_id: companyId.get(company.slug)!, role: p.recruits.role, status: "ACTIVE", title: p.recruits.title, work_email: `${usernameFor(p.name).replace(/-/g, ".")}@${company.domain}`, work_email_verified_at: new Date(now - 60 * day), reviewed_at: new Date(now - 59 * day), review_note: "Approved: work email on the company domain" })
        .execute();
      await db.updateTable("companies").set({ created_by: id }).where("id", "=", companyId.get(company.slug)!).where("created_by", "is", null).execute();
    }
  }
  const P = (name: string) => byName.get(name)!;
  const admin = people[0]!;
  await db.updateTable("companies").set({ verified_by: admin.id }).where("status", "=", "VERIFIED").execute();

  // Company logos and covers (uploaded by the page owner).
  for (const [i, c] of COMPANIES.entries()) {
    const owner = people.find((p, k) => PEOPLE[k]?.recruits?.slug === c.slug && PEOPLE[k]?.recruits?.role === "OWNER") ?? admin;
    const logo = await storeImage(owner.id, "COMPANY_LOGO", logoSvg(c.name, i), 320, 320);
    const cover = await storeImage(owner.id, "COMPANY_COVER", bannerSvg(1600, 400, i), 1600, 400);
    await db.updateTable("companies").set({ logo_upload_id: logo, cover_upload_id: cover }).where("slug", "=", c.slug).execute();
  }

  // The demo's personal mail domain counts as free mail, so the review queue shows the
  // "free email provider" evidence on one of the pending applications.
  const current = await getSettings();
  if (!current.recruiter.freeMailDomains.includes("personal.example")) await saveSettings({ recruiter: { ...current.recruiter, freeMailDomains: [...current.recruiter.freeMailDomains, "personal.example"] } }, people[0]!.id);

  // Recruiters waiting for review (the /admin queue).
  for (const r of PENDING_RECRUITERS) {
    const id = newId();
    await db.insertInto("users").values({ id, email: emailFor(r.name), username: usernameFor(r.name), display_name: r.name, password_hash: hash, status: "ACTIVE", email_verified_at: new Date() }).execute();
    await db.insertInto("talent_profiles").values({ id: newId(), user_id: id, headline: r.headline }).execute();
    const avatar = await storeImage(id, "AVATAR", avatarSvg(r.name, people.length), 320, 320);
    await db.updateTable("users").set({ avatar_upload_id: avatar }).where("id", "=", id).execute();
    await db
      .insertInto("recruiters")
      .values({ id: newId(), user_id: id, company_id: companyId.get(r.slug)!, role: "RECRUITER", status: "PENDING_REVIEW", title: r.headline, work_email: r.email, work_email_verified_at: new Date(now - day), application_note: "I coordinate interviews for the team and would like to post our open roles." })
      .execute();
  }

  // ── Connections and follows (through the network service). ──────────────
  const candidates = people.slice(11);
  const recruiters = people.slice(3, 11);
  const linkPairs = new Set<string>();
  const connect = async (a: Actor, b: Actor) => {
    if (a.id === b.id || linkPairs.has(pairKey(a.id, b.id))) return;
    linkPairs.add(pairKey(a.id, b.id));
    const r = await quietly(() => network.connect(a, b.id, null));
    if (r && r.state === "PENDING_OUTGOING") await quietly(() => network.respond(b, r.connectionId, true));
  };
  for (const c of candidates) for (const other of sample(candidates, int(4, 9))) await connect(c, other);
  for (const r of recruiters) for (const other of sample(candidates, int(6, 12))) await connect(r, other);
  for (const r of recruiters) for (const other of sample(recruiters, 3)) await connect(r, other);
  // A few invitations left pending, for the "My network" page.
  for (const c of sample(candidates, 4)) await quietly(() => network.connect(c, P("Juniper Vale").id, "We met at the build tooling meetup; would love to stay in touch."));
  for (const c of candidates) for (const other of sample(people, 3)) await quietly(() => users.follow(c, other.id));
  for (const c of sample(candidates, 20)) {
    const slug = pick(COMPANIES).slug;
    await db.insertInto("company_follows").values({ user_id: c.id, company_id: companyId.get(slug)! }).onConflict((oc) => oc.doNothing()).execute();
  }

  // Endorsements from connections.
  const skillRows = await db.selectFrom("profile_skills as s").innerJoin("talent_profiles as p", "p.id", "s.profile_id").select(["s.id", "p.user_id"]).execute();
  for (const s of skillRows) {
    if (rand() < 0.45) continue;
    for (const endorser of sample(people, int(1, 4))) await quietly(() => profiles.endorse(endorser, s.id, true));
  }

  // ── Jobs (through the job service, as the company's recruiters). ────────
  const recruiterOf = (slug: string) => people.find((_, k) => PEOPLE[k]?.recruits?.slug === slug)!;
  const jobIds: { id: string; spec: (typeof JOB_SPECS)[number] }[] = [];
  for (const spec of JOB_SPECS) {
    const r = recruiterOf(spec.company);
    const hourly = spec.type === "CONTRACT" || spec.type === "INTERNSHIP";
    const job = await jobs.create(r, {
      title: spec.title,
      description: `About the role\n\nYou will join a small team at ${COMPANIES.find((c) => c.slug === spec.company)!.name} and own meaningful work from the first month. We value written communication, clear ownership and steady progress over heroics.\n\nWhat you will do\n- Build and run ${spec.skills.slice(0, 2).join(" and ")} work that customers rely on\n- Work closely with product, design and support\n- Help us raise the bar on quality and reliability\n\nWhat we look for\n- Experience with ${spec.skills.join(", ")}\n- A habit of writing things down\n- Curiosity about users\n\nThe interview: a 30-minute intro, a practical exercise you can do at home, and a 3-hour onsite or video loop. We share the format in advance.`,
      employmentType: spec.type,
      workplaceType: spec.workplace,
      seniority: spec.seniority,
      location: spec.location,
      salary: { min: spec.salary[0], max: spec.salary[1], currency: "USD", period: hourly ? "HOUR" : "YEAR" },
      skills: spec.skills,
      openings: spec.seniority === "MID" ? 2 : 1,
      screeningQuestions: [
        { prompt: "Are you authorized to work in the job's location?", kind: "YES_NO", required: true },
        { prompt: "Tell us about a project you are proud of (a few sentences).", kind: "TEXT", required: false },
      ],
      publish: spec.status !== "DRAFT",
    });
    await db.updateTable("jobs").set({ opened_at: new Date(now - int(1, 30) * day) }).where("id", "=", job.id).where("opened_at", "is not", null).execute();
    if (spec.status === "CLOSED") await jobs.setStatus(r, job.id, "CLOSED");
    jobIds.push({ id: job.id, spec });
  }

  // ── Applications across every stage. ──────────────────────────────────
  const openJobs = jobIds.filter((j) => !j.spec.status);
  const stages = ["APPLIED", "APPLIED", "SCREENING", "SCREENING", "INTERVIEW", "INTERVIEW", "OFFER", "HIRED", "REJECTED"] as const;
  const appCandidates = PEOPLE.map((p, k) => ({ p, a: people[k]! })).filter(({ p }) => !p.recruits && !p.platformRole && !p.draft);
  const hired: { applicationId: string; recruiter: Actor; jobTitle: string }[] = [];
  for (const job of openJobs) {
    const fit = appCandidates.filter(({ p }) => p.skills.some((s) => job.spec.skills.includes(s)));
    const pool = [...fit, ...sample(appCandidates, 2)];
    for (const { a } of sample([...new Map(pool.map((x) => [x.a.id, x])).values()], int(2, 5))) {
      const qs = readQuestions((await db.selectFrom("jobs").select("screening_questions").where("id", "=", job.id).executeTakeFirstOrThrow()).screening_questions);
      const answers = qs.map((q) => ({ questionId: q.id, answer: q.kind === "YES_NO" ? "YES" : "I led a migration that cut our deploy time in half and wrote the runbook the team still uses." }));
      const app = await quietly(() => applications.apply(a, job.id, { coverNote: "I have been following your team's work for a while and would love to talk.", answers }));
      if (!app) continue;
      const appRow = await db.selectFrom("applications").select("id").where("job_id", "=", job.id).where("candidate_id", "=", a.id).executeTakeFirstOrThrow();
      const target = pick(stages);
      const r = recruiterOf(job.spec.company);
      const path = { APPLIED: [], SCREENING: ["SCREENING"], INTERVIEW: ["SCREENING", "INTERVIEW"], OFFER: ["SCREENING", "INTERVIEW", "OFFER"], HIRED: ["SCREENING", "INTERVIEW", "OFFER", "HIRED"], REJECTED: ["SCREENING", "REJECTED"] }[target] as ("SCREENING" | "INTERVIEW" | "OFFER" | "HIRED" | "REJECTED")[];
      for (const to of path) await quietly(() => applications.move(r, appRow.id, { to, reason: to === "REJECTED" ? "We went with someone whose experience matched the role more closely." : null, note: to === "INTERVIEW" ? "Strong systems thinking in the intro call." : null }));
      if (target !== "APPLIED") await quietly(() => applications.addNote(r, { applicationId: appRow.id, body: pick(["Clear communicator, great questions.", "Solid portfolio; check references.", "Take-home was excellent.", "Good fit for the team's pace."]), rating: int(3, 5) }));
      if (target === "HIRED") hired.push({ applicationId: appRow.id, recruiter: r, jobTitle: job.spec.title });
    }
  }

  // ── Approaches: pending, accepted (with channels and a conversation), declined. ──
  const approachPairs = [
    { r: "Harper Lindqvist", c: "Thaddeus Grant", role: "Staff Engineer, Build Platform", outcome: "ACCEPT" },
    { r: "Harper Lindqvist", c: "Priya Raman", role: "ML Engineer, Code Search", outcome: "PENDING" },
    { r: "Dev Okafor", c: "Tamsin Wren", role: "Senior Frontend Engineer", outcome: "ACCEPT" },
    { r: "Sienna Marsh", c: "Juniper Vale", role: "Principal Engineer, Fleet Platform", outcome: "PENDING" },
    { r: "Sienna Marsh", c: "Felix Andersson", role: "Backend Engineer, Fleet", outcome: "DECLINE" },
    { r: "Ezra Whitlock", c: "Ines Varga", role: "Staff Security Engineer", outcome: "PENDING" },
    { r: "Imani Castell", c: "Kofi Mensah", role: "Senior Analytics Engineer", outcome: "ACCEPT" },
    { r: "Noor Haddad", c: "Orrin Featherstone", role: "Design Systems Lead", outcome: "ACCEPT" },
    { r: "Aurelio Banks", c: "Rafael Okafor", role: "Platform Engineer", outcome: "PENDING" },
    { r: "Aurelio Banks", c: "Marigold Ashby", role: "Lead UX Researcher", outcome: "PENDING" },
  ] as const;
  const accepted: { approachId: string; recruiter: Actor; candidate: Actor; role: string; threadId: string | null }[] = [];
  for (const a of approachPairs) {
    const recruiter = P(a.r);
    const candidate = P(a.c);
    const sent = await quietly(() =>
      approaches.send(recruiter, {
        username: candidate.username,
        roleTitle: a.role,
        message: `Hi ${candidate.displayName.split(" ")[0]}, your work stood out to us. We are hiring a ${a.role} and I think you would enjoy the problems the team is working on. Happy to share the interview format and the salary range up front. Open to a short chat?`,
        employmentType: "FULL_TIME",
        salary: { min: 170000, max: 220000, currency: "USD", period: "YEAR" },
      }),
    );
    if (!sent) continue;
    if (a.outcome === "ACCEPT") {
      const done = await quietly(() => approaches.accept(candidate, sent.id, ["EMAIL"]));
      if (done) accepted.push({ approachId: sent.id, recruiter, candidate, role: a.role, threadId: done.threadId });
    } else if (a.outcome === "DECLINE") await quietly(() => approaches.decline(candidate, sent.id, "Not looking to move this year, thank you for asking."));
  }
  for (const a of accepted) {
    if (!a.threadId) continue;
    await quietly(() => dms.sendMessage(a.recruiter, a.threadId!, { body: `Thanks for sharing your email, ${a.candidate.displayName.split(" ")[0]}. Does Thursday at 10 work for a 30-minute intro?` }));
    await quietly(() => dms.sendMessage(a.candidate, a.threadId!, { body: "Thursday works. Could you send the interview format beforehand?" }));
    await quietly(() => dms.sendMessage(a.recruiter, a.threadId!, { body: "Of course. Sending it now, along with the salary band and the team's current projects." }));
  }
  // A couple of logged contact reveals for "Who has seen your details".
  for (const a of accepted.slice(0, 3)) await quietly(() => approaches.revealContact(a.recruiter, a.approachId, { ip: "203.0.113.10", userAgent: "demo" }));

  // Conversations between connections.
  // Each opener is different: the rules provider rightly flags one text sent to many people as spam.
  const OPENERS: [string, string][] = [
    ["Great seeing your post this week. Would you be up for a coffee chat about how your team runs reviews?", "Happy to! Next Tuesday afternoon?"],
    ["Your talk on incident reviews was the clearest I have seen. Do you share the slides anywhere?", "Thank you! I will send them over tonight."],
    ["We are about to migrate our queue workers. Any lessons you wish you had known earlier?", "Plenty. Want to pair on the plan for half an hour?"],
    ["Congrats on the launch. How did you keep the rollout so calm?", "Feature flags and a lot of patience. Happy to walk you through it."],
    ["Are you going to the meetup in Harbour City next month?", "Yes, I am giving a short talk. Come say hi."],
    ["Thanks for the endorsement on PostgreSQL, I owe you one.", "Well earned. Your index tuning post saved us a week."],
    ["Quick question about your design system: how do you version the tokens?", "One package per release, with a changelog. I can show you."],
    ["I am hiring a mentor for our juniors. Would you be open to a chat?", "Sure, I love that kind of work. Send me a time."],
    ["Loved the write-up on accessibility audits. Mind if I share it with my team?", "Please do. Feedback welcome too."],
    ["Your open source CLI saved me hours this week. Thank you!", "That makes my day. Issues and ideas are welcome."],
  ];
  const pairs = [...linkPairs].slice(0, OPENERS.length);
  for (const [i, key] of pairs.entries()) {
    const [x, y] = key.split(":");
    const a = people.find((p) => p.id === x);
    const b = people.find((p) => p.id === y);
    if (!a || !b) continue;
    const thread = await quietly(() => dms.openDirect(a, b.id));
    if (!thread) continue;
    const [opener, reply] = OPENERS[i]!;
    await quietly(() => dms.sendMessage(a, thread.id, { body: opener }));
    await quietly(() => dms.sendMessage(b, thread.id, { body: reply }));
  }

  // ── Engagements with revealed ratings (trust). ─────────────────────────
  for (const h of hired.slice(0, 3)) {
    const app = await db.selectFrom("applications").select("candidate_id").where("id", "=", h.applicationId).executeTakeFirstOrThrow();
    const candidate = people.find((p) => p.id === app.candidate_id);
    if (!candidate) continue;
    const e = await quietly(() => trust.propose(h.recruiter, { applicationId: h.applicationId, title: h.jobTitle }));
    if (!e) continue;
    await quietly(() => trust.confirm(candidate, e.id));
    await quietly(() => trust.complete(h.recruiter, e.id));
    await quietly(() => trust.complete(candidate, e.id));
    await quietly(() => trust.rate(h.recruiter, e.id, { score: 5, subScores: { communication: 5, quality: 5, reliability: 5, professionalism: 5 }, comment: "Thoughtful, fast and kind to work with. We would hire again in a heartbeat." }));
    await quietly(() => trust.rate(candidate, e.id, { score: int(4, 5), subScores: { communication: 5, professionalism: 5 }, comment: "Clear process, honest feedback, and they shared the salary range on the first call." }));
  }

  // ── The feed. ───────────────────────────────────────────────────────────
  const made: string[] = [];
  for (let k = 0; k < 34; k++) {
    const author = pick(people.slice(3));
    const withImage = rand() < 0.4;
    const media = withImage ? [await storeImage(author.id, "POST", postSvg(1200, 675, k), 1200, 675)] : [];
    const p = await quietly(() => posts.create(author, { body: pick(POST_LINES), mediaIds: media, visibility: rand() < 0.15 ? "CONNECTIONS" : "PUBLIC" }));
    if (p) made.push(p.id);
  }
  // Company page posts and hiring posts with job cards.
  for (const job of openJobs.slice(0, 7)) {
    const r = recruiterOf(job.spec.company);
    const p = await quietly(() => posts.create(r, { body: `We are hiring: ${job.spec.title}. The salary range is on the post, the interview format is shared in advance, and we answer every application.`, kind: "HIRING", jobId: job.id, companyId: companyId.get(job.spec.company) }));
    if (p) made.push(p.id);
  }
  for (const id of made) {
    for (const reactor of sample(people, int(2, 12))) await quietly(() => reactions.setPostReaction(reactor, id, pick(["LIKE", "LIKE", "LIKE", "CELEBRATE", "INSIGHTFUL", "SUPPORT", "LOVE"] as const)));
    for (const commenter of sample(people, int(0, 4))) await quietly(() => comments.create(commenter, id, { body: pick(COMMENT_LINES) }));
  }
  // Spread posts over the last two weeks.
  for (const [i, id] of made.entries()) await db.updateTable("posts").set({ created_at: new Date(now - (made.length - i) * 8 * 3600_000) }).where("id", "=", id).execute();

  // ── Things for /admin: complaints and reported posts. ─────────────────
  const declined = await db.selectFrom("approaches as a").innerJoin("recruiters as r", "r.id", "a.recruiter_id").select(["a.id", "a.candidate_id", "r.user_id"]).where("a.status", "in", ["DECLINED", "ACCEPTED"]).limit(2).execute();
  for (const d of declined) {
    const complainant = people.find((p) => p.id === d.candidate_id);
    const against = people.find((p) => p.id === d.user_id);
    if (complainant && against) await quietly(() => trust.fileComplaint(complainant, { againstUsername: against.username, category: "SPAM", description: "After I declined, I kept getting follow-up messages from this recruiter about unrelated roles.", approachId: d.id }));
  }

  // A shortlist and a saved search for the Northwind owner's workspace.
  const owner = recruiterOf("northwind-labs");
  const NOTES = ["Strong platform background, ask about the CI migration.", "Great writing samples; good fit for developer relations.", "Open to work from next quarter, follow up then."];
  const shortlist = people.filter((p, k) => !PEOPLE[k]?.recruits && !PEOPLE[k]?.platformRole && !PEOPLE[k]?.draft).slice(0, 3);
  for (const [k, c] of shortlist.entries()) await quietly(() => directory.saveCandidate(owner, c.username, NOTES[k]!, true));
  await quietly(() => directory.saveSearch(owner, "Senior platform engineers", { q: "platform", skills: ["Kubernetes"], openToWork: true }));

  // Reported content for the moderation desk: an off-topic sales pitch several people
  // flagged, and a post one person thinks is misleading (the desk decides).
  const pitcher = people[people.length - 1]!;
  const pitch = await quietly(() => posts.create(pitcher, { body: "Selling a course that guarantees a senior role in 30 days. Message me for the payment link, only 5 seats left!" }));
  if (pitch) for (const reporter of people.slice(5, 8)) await quietly(() => createReport(reporter, { targetType: "POST", targetId: pitch.id, reason: "SPAM", details: "Paid course pitch with a payment link, not a professional update." }));
  const debatable = made[1];
  if (debatable) await quietly(() => createReport(people[9]!, { targetType: "POST", targetId: debatable, reason: "MISINFORMATION", details: "The numbers in this post do not add up." }));

  await reconcileCounters();
  printLogins(password, true);
}
