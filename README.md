<p align="center">
  <img src="docs/assets/banner.svg" alt="Euron Open Talent: talent pages, verified recruiters and a live hiring pipeline, on infrastructure you own" width="100%">
</p>

<p align="center">
  <img alt="Open source" src="https://img.shields.io/badge/open_source-%E2%9D%A4-5b8cff?style=flat">
  <a href="LICENSE"><img alt="License: MIT" src="https://img.shields.io/badge/license-MIT-3b82f6?style=flat"></a>
  <img alt="Node.js 22 LTS" src="https://img.shields.io/badge/node-22_LTS-339933?style=flat&logo=nodedotjs&logoColor=white">
  <img alt="TypeScript strict" src="https://img.shields.io/badge/TypeScript-strict-3178c6?style=flat&logo=typescript&logoColor=white">
  <img alt="Next.js 15" src="https://img.shields.io/badge/Next.js-15-000000?style=flat&logo=nextdotjs&logoColor=white">
  <img alt="Socket.IO" src="https://img.shields.io/badge/realtime-Socket.IO-010101?style=flat&logo=socketdotio&logoColor=white">
  <img alt="PostgreSQL 16" src="https://img.shields.io/badge/PostgreSQL-16-4169e1?style=flat&logo=postgresql&logoColor=white">
  <img alt="Redis 7" src="https://img.shields.io/badge/Redis-7-dc382d?style=flat&logo=redis&logoColor=white">
  <img alt="Terraform" src="https://img.shields.io/badge/IaC-Terraform-7b42bc?style=flat&logo=terraform&logoColor=white">
  <img alt="AWS" src="https://img.shields.io/badge/AWS-ready-ff9900?style=flat&logo=amazonwebservices&logoColor=white">
</p>

<p align="center">
  <a href="https://github.com/euron-sde-team/euron-open-talent-network/stargazers"><img alt="Star this repo" src="https://img.shields.io/github/stars/euron-sde-team/euron-open-talent-network?style=social&label=Star%20this%20repo"></a>
  <a href="https://github.com/euron-sde-team/euron-open-talent-network/fork"><img alt="Fork" src="https://img.shields.io/github/forks/euron-sde-team/euron-open-talent-network?style=social&label=Fork"></a>
  <a href="https://github.com/euron-sde-team/euron-open-talent-network/watchers"><img alt="Watch" src="https://img.shields.io/github/watchers/euron-sde-team/euron-open-talent-network?style=social&label=Watch"></a>
  <br>
  <a href="https://github.com/euron-sde-team/euron-open-talent-network/issues"><img alt="Open issues" src="https://img.shields.io/github/issues/euron-sde-team/euron-open-talent-network?style=flat&color=5b8cff"></a>
  <a href="https://github.com/euron-sde-team/euron-open-talent-network/pulls"><img alt="PRs welcome" src="https://img.shields.io/badge/PRs-welcome-34d399?style=flat"></a>
  <a href="https://github.com/euron-sde-team/euron-open-talent-network/commits/main"><img alt="Last commit" src="https://img.shields.io/github/last-commit/euron-sde-team/euron-open-talent-network?style=flat&color=8b95a8"></a>
  <img alt="Runs locally with no AWS account" src="https://img.shields.io/badge/runs_locally-no_AWS_account_needed-0a0f1c?style=flat">
  <br>
  <a href="#built-by-the-team-behind-euron"><img alt="Built by the team behind Euron" src="https://img.shields.io/badge/built_by-Euron-4f46e5?style=flat"></a>
</p>

<p align="center">
  <b><a href="#-quickstart">Quickstart</a></b> ·
  <b><a href="#️-architecture">Architecture</a></b> ·
  <b><a href="#-explore-the-repository">Explore the repo</a></b> ·
  <b><a href="docs/api/rest-contract.md">API reference</a></b> ·
  <b><a href="#️-deploy-to-aws">Deploy</a></b> ·
  <b><a href="docs/architecture/security.md">Security</a></b> ·
  <b><a href="#-documentation">Docs</a></b>
</p>

**Euron Open Talent** is an open-source, self-hosted **professional network like LinkedIn**:
people build talent pages that show their real work, connect with the people they have worked
with, and get hired by verified recruiters, all on infrastructure you own. It is MIT-licensed
and part of the open-source initiative of **ENGAGESPHERE TECHNOLOGY PRIVATE LIMITED**.

Candidates get a talent page (experience, projects, skills with endorsements, badges and
ratings), a feed, connections and messaging, a job board with Easy Apply, and a private
dashboard. Recruiters verify a work email, join or create a company page, post jobs and move
applicants through a hiring pipeline the whole team sees live. Network staff run everything
from an `/admin` control plane: recruiter approvals, companies, moderation, people,
complaints, settings and the audit log.

The rules that make a professional network trustworthy are enforced by the server, not left to the UI:

- **Contact details stay private until the candidate says yes.** A recruiter asks first; the
  candidate picks which channels to share; every view is logged where the candidate can see it;
  access can be revoked at any time.
- **Recruiters are verified.** A code to a work email on the company's domain, then a review by
  network staff, before anyone can be approached.
- **Messaging is gated.** Connections talk freely; anyone else sends a request the recipient
  can accept or decline, and a block ends everything in both directions.

Everything runs on a laptop against an AWS emulator, and deploys to AWS with one command from
the same Terraform.

<p align="center">
  <img src="docs/assets/tour.gif" alt="Product tour: the landing page, the feed, a talent page seen by a recruiter, AI resume import, job search, Easy Apply, the hiring pipeline, a candidate drawer, the contact consent dialog, messaging, the moderation desk, recruiter approvals and dark mode" width="100%">
</p>

> [!NOTE]
> Everything in the tour ran for real: Docker Compose on a laptop, with S3, SES, KMS and
> Secrets Manager emulated locally and provisioned by the same Terraform modules that build
> production. `make up && make demo` reproduces it.

<h3 align="center">Built by the team behind Euron</h3>

<p align="center">
  <sub>Euron Open Talent is part of the open-source initiative of ENGAGESPHERE TECHNOLOGY PRIVATE LIMITED, made by the people who build<br>the platforms below. If you like how this repository is built, come and see what we build with it.</sub>
</p>

<p align="center">
  <a href="https://euron.one"><picture><source media="(prefers-color-scheme: dark)" srcset="docs/assets/brand/euron-dark.svg"><img src="docs/assets/brand/euron-light.svg" alt="Euron: learn the latest technologies from industry experts. Visit euron.one" width="31%"></picture></a>
  <a href="https://euronsystems.com"><picture><source media="(prefers-color-scheme: dark)" srcset="docs/assets/brand/euron-systems-dark.svg"><img src="docs/assets/brand/euron-systems-light.svg" alt="Euron Systems: the SaaS platform for educators and creators. Visit euronsystems.com" width="31%"></picture></a>
  <a href="https://alphaeuron.com"><picture><source media="(prefers-color-scheme: dark)" srcset="docs/assets/brand/alpha-euron-dark.svg"><img src="docs/assets/brand/alpha-euron-light.svg" alt="Alpha Euron: where school kids grow creativity and tech skills with AI. Visit alphaeuron.com" width="31%"></picture></a>
</p>

<p align="center">
  <a href="https://www.instagram.com/euron_official"><img src="https://img.shields.io/badge/Instagram-E4405F?style=flat-square&logo=instagram&logoColor=white" alt="Instagram"></a>
  <a href="https://www.linkedin.com/company/euronone/posts/"><img src="https://img.shields.io/badge/LinkedIn-0A66C2?style=flat-square&logo=linkedin&logoColor=white" alt="LinkedIn"></a>
  <a href="https://x.com/euron712"><img src="https://img.shields.io/badge/X-000000?style=flat-square&logo=x&logoColor=white" alt="X"></a>
  <a href="https://www.youtube.com/@Euron-official"><img src="https://img.shields.io/badge/YouTube-FF0000?style=flat-square&logo=youtube&logoColor=white" alt="YouTube"></a>
  <a href="https://whatsapp.com/channel/0029VaeeJwq9RZAfPW9P2l07"><img src="https://img.shields.io/badge/WhatsApp_channel-25D366?style=flat-square&logo=whatsapp&logoColor=white" alt="WhatsApp channel"></a>
</p>

---

## 📚 Table of contents

- [Why Euron Open Talent](#-why-euron-open-talent)
- [At a glance](#-at-a-glance)
- [Screenshots](#️-screenshots)
- [Features](#-features)
- [Architecture](#️-architecture)
  - [Contact details, by consent](#contact-details-by-consent)
  - [The hiring pipeline](#the-hiring-pipeline)
  - [A move, from drag to every screen](#a-move-from-drag-to-every-screen)
  - [Who may message whom](#who-may-message-whom)
  - [AI resume import](#ai-resume-import)
  - [Moderation](#moderation)
  - [Media](#media)
- [Tech stack](#-tech-stack)
- [Prerequisites](#-prerequisites)
- [Quickstart](#-quickstart)
- [Explore the repository](#-explore-the-repository)
- [API](#-api)
- [Configuration](#️-configuration)
- [Deploy to AWS](#️-deploy-to-aws)
- [Security model](#-security-model)
- [Testing](#-testing)
- [Documentation](#-documentation)
- [Roadmap](#️-roadmap)
- [FAQ](#-faq)
- [Contributing, security and license](#-contributing-security-and-license)

---

## 💡 Why Euron Open Talent

A professional network holds some of the most sensitive data people share online: where they
work, what they earn, how to reach them, and who is trying to hire them. On a hosted platform
none of that is yours, and the rules about who sees it are someone else's.

Euron Open Talent is a professional network like LinkedIn that a university, a bootcamp, an
industry association, a company alumni group or a regional jobs community can run for its own
people, with the hard parts done and tested:

- **A product people already know how to use.** Talent pages, a feed, My Network, Jobs,
  Messaging and Notifications, in a calm, enterprise-grade interface with light and dark mode.
- **Privacy that is a protocol, not a promise.** Contact details are never in a public
  response; they unlock per channel, only after the candidate accepts, with an access log and
  revocation. Sections of a page can be limited to connections or verified recruiters, and
  search never matches what a viewer is not allowed to see.
- **Hiring that teams can actually use.** Company pages with teams, jobs with screening
  questions, Easy Apply, and a pipeline board that updates live for every recruiter on the job
  while candidates watch their own timeline move.
- **Trust you can audit.** Verified recruiters, double-blind ratings after real engagements,
  complaints with evidence, a moderation desk with appeals, and every staff action in the
  audit log.
- **Production-grade on AWS in one command.** VPC, RDS, ElastiCache, S3 with KMS, SES, ECS
  Fargate, CloudFront with WAF, alarms. The same modules provision the local emulator.

## 📊 At a glance

| | |
|---|---|
| **Apps** | Web app (Next.js) with the `/admin` control plane, API with the Socket.IO gateway, background worker, an AI stub for tests |
| **People** | Talent pages with per-section visibility, open-to-work, AI resume import, endorsements, evidence-gated badges, connections, follows, blocks, a feed, messaging |
| **Hiring** | Company pages and teams, work-email recruiter verification with review, approaches with consent-based contact unlock, jobs, Easy Apply, a live hiring pipeline, saved candidates and searches |
| **Trust** | Engagements confirmed by both sides, double-blind ratings, complaints, reports, AI-assisted moderation, appeals, audit log |
| **Infrastructure** | 13 Terraform modules, 3 environments (local emulator, AWS dev, AWS prod) |
| **Tests** | 459 unit, 466 integration (run under 12 backend combinations), 17 browser end-to-end |
| **License** | MIT |

## 🖼️ Screenshots

<table>
  <tr>
    <td width="50%"><img src="docs/assets/screenshots/01-feed.png" alt="The home feed with the profile card, the composer, a hiring post with a job card, people suggestions and jobs for you"><br><sub><b>Feed.</b> Posts, hiring updates and milestones from your network, with suggestions and jobs that match your skills.</sub></td>
    <td width="50%"><img src="docs/assets/screenshots/02-profile.png" alt="A talent page as a verified recruiter sees it, with Approach, Message, Follow and Save"><br><sub><b>Talent page.</b> As a verified recruiter sees it: approach, save, invite to a job. Contact details are not on the page.</sub></td>
  </tr>
  <tr>
    <td><img src="docs/assets/screenshots/03-profile-owner.png" alt="The owner's view of their talent page with profile strength, publish controls and insights"><br><sub><b>Your page.</b> Profile strength, publish and unlist, open to work, section visibility, private contact, insights.</sub></td>
    <td><img src="docs/assets/screenshots/04-ai-import.png" alt="Reviewing an AI draft of a profile: headline, experience and education, each with a checkbox"><br><sub><b>AI import.</b> Paste a resume, upload a PDF or record a voice note; approve each section before it is saved.</sub></td>
  </tr>
  <tr>
    <td><img src="docs/assets/screenshots/06-jobs.png" alt="The jobs page with recommendations, a job list and the selected job with a skill match"><br><sub><b>Jobs.</b> Search and filters, recommendations, and how your skills match each job.</sub></td>
    <td><img src="docs/assets/screenshots/07-easy-apply.png" alt="The Easy Apply dialog showing the profile snapshot that will be shared"><br><sub><b>Easy Apply.</b> A snapshot of your page, a resume, screening questions and a note, in five short steps.</sub></td>
  </tr>
  <tr>
    <td><img src="docs/assets/screenshots/08-applications.png" alt="My applications with a stage timeline for each job"><br><sub><b>My applications.</b> Every application's stage, updated live as the team moves it.</sub></td>
    <td><img src="docs/assets/screenshots/11-consent.png" alt="The dialog where a candidate chooses which contact channels to share with a recruiter"><br><sub><b>Consent.</b> The candidate chooses which channels a recruiter may see; every view is logged and revocable.</sub></td>
  </tr>
  <tr>
    <td><img src="docs/assets/screenshots/13-pipeline.png" alt="The hiring pipeline board for a job with Applied, Screening, Interview and Offer columns"><br><sub><b>Pipeline.</b> Drag cards between stages; teammates see every move live.</sub></td>
    <td><img src="docs/assets/screenshots/14-candidate.png" alt="The candidate drawer with skill match, screening answers, experience and team notes"><br><sub><b>Candidate drawer.</b> Skill match, answers, the snapshot, team notes and ratings, stage history.</sub></td>
  </tr>
  <tr>
    <td><img src="docs/assets/screenshots/15-talent-search.png" alt="Recruiter talent search with skill and location filters"><br><sub><b>Talent search.</b> Skills, location, open to work, experience; save searches and shortlists.</sub></td>
    <td><img src="docs/assets/screenshots/09-company.png" alt="A verified company page with its about section and open jobs"><br><sub><b>Company pages.</b> Verified by domain, with open jobs, people, posts and a team for its recruiters.</sub></td>
  </tr>
  <tr>
    <td><img src="docs/assets/screenshots/05-network.png" alt="My Network with an invitation and people you may know"><br><sub><b>My Network.</b> Invitations with notes, and people you may know from shared workplaces and skills.</sub></td>
    <td><img src="docs/assets/screenshots/10-messaging.png" alt="Messaging with the inbox, requests, archived and a conversation"><br><sub><b>Messaging.</b> Inbox, requests and archive, typing indicators and read receipts, a dock on every page.</sub></td>
  </tr>
  <tr>
    <td><img src="docs/assets/screenshots/12-dashboard.png" alt="The candidate dashboard with profile analytics and recruiter approaches"><br><sub><b>Dashboard.</b> Profile views, search appearances, approaches, invitations, the contact log, engagements and complaints.</sub></td>
    <td><img src="docs/assets/screenshots/17-recruiter-approvals.png" alt="The admin recruiter approval queue with domain evidence"><br><sub><b>Recruiter approvals.</b> Work email domain evidence for each application, approve or reject with a note.</sub></td>
  </tr>
  <tr>
    <td><img src="docs/assets/screenshots/18-moderation.png" alt="The moderation desk with a reported post open in the case drawer"><br><sub><b>Moderation desk.</b> Reports and AI signals in one queue, every action a moderator can take, appeals.</sub></td>
    <td><img src="docs/assets/screenshots/16-admin.png" alt="The admin overview with totals and daily activity charts"><br><sub><b>Control plane.</b> Totals, daily activity, the hiring funnel and top skills, with CSV export.</sub></td>
  </tr>
  <tr>
    <td><img src="docs/assets/screenshots/19-dark-mode.png" alt="The feed in dark mode"><br><sub><b>Dark mode.</b> Every screen, following the system setting or your choice.</sub></td>
    <td><img src="docs/assets/screenshots/20-mobile.png" alt="The feed, a talent page and a job on a phone"><br><sub><b>Mobile.</b> Every screen down to phone width, with a bottom navigation bar.</sub></td>
  </tr>
  <tr>
    <td colspan="2"><img src="docs/assets/screenshots/00-landing.png" alt="The signed-out landing page with job search, recent jobs and companies"><br><sub><b>Landing.</b> Signed-out visitors can search jobs, browse companies and published talent pages.</sub></td>
  </tr>
</table>

## ✨ Features

| Area | What you get |
|---|---|
| **Talent pages** | Headline, about, experience with structured dates, education, projects with covers, skills with endorsements, certifications, links (YouTube loads only on click), badges with their evidence, ratings, activity. Per-section audience (everyone, connections, verified recruiters), open to work for everyone or for recruiters only, explicit publish gated on profile strength and a private contact channel, username changes with redirects, PDF and DOCX resume export |
| **AI import** | Paste text, upload a PDF or DOCX, or record a voice note; honest live progress; review and accept each section; badges only with a verbatim quote from your text; OpenAI by default, Gemini, a stub, or off |
| **Network** | Connection invitations with notes, accept, ignore and withdraw, mutual connections, people you may know, follows, blocks that cascade everywhere |
| **Feed** | Posts, hiring posts with job cards, open-to-work and milestone posts, posting as a company page, reposts, six reactions, threaded comments with mentions, saved posts, live counts and a "new posts" pill |
| **Messaging** | 1:1 threads with context (connection, approach, application, request), message requests, archive, replies, reactions, edits, attachments, typing, read receipts, a dock on every page |
| **Companies** | Pages with logo, cover, about and domains; verification; teams with owner, admin and recruiter roles; follow; jobs, people and posts tabs |
| **Recruiting** | Work-email verification and staff review, a workspace with a daily approach quota, talent search with saved searches and shortlists with notes, approaches with consent-based contact unlock, job invites |
| **Jobs** | Search with filters and skill match, recommendations, saved jobs, Easy Apply with resume and screening questions, a candidate timeline, withdraw |
| **Pipeline** | A kanban board per job with drag and drop, keyboard moves, bulk moves, required rejection reasons, team notes and 1 to 5 ratings, live updates for the team and the candidate |
| **Trust** | Engagements both sides confirm, double-blind ratings with a window and a Bayesian average, complaints with evidence and a relationship check |
| **Moderation** | Scans of posts, comments, messages, profiles, companies, jobs and approaches; per-category thresholds; reports; hide, remove, restore, warn, suspend, ban; appeals; full history |
| **Accounts** | Email verification, password reset, two-factor sign-in with recovery codes, sessions, data export, account deletion, digest emails |
| **Control plane** | Role-scoped areas for admins, moderators and recruiter operations: overview with CSV export, recruiter approvals, companies, moderation, people, jobs, complaints, settings, audit log |

## 🏗️ Architecture

<p align="center">
  <img src="docs/assets/diagrams/architecture.svg" alt="Architecture: browsers reach one host through CloudFront and an application load balancer; pages go to the web service, /api and /socket.io to the API; the API and worker share PostgreSQL, Redis, S3, SES, KMS and Secrets Manager; an AI provider is called for import and moderation" width="100%">
</p>

- **One origin for the browser.** The load balancer routes `/api/*`, `/socket.io/*` and `/up`
  to the API and everything else to the web app, so the session cookie is first-party and
  there is no CORS in production.
- **Stateless servers.** API tasks keep nothing in memory that matters: sockets fan out
  through Redis, rate limits live in Redis, sessions live in Postgres.
- **The worker does the slow work.** Resume import, moderation scans, image processing, feed
  fan-out, digests and housekeeping run on BullMQ queues in a separate service built from the
  same image.
- **Side effects only after commit.** Socket emits, jobs and notifications are collected during
  a transaction and released only when it commits ([`core/effects.ts`](apps/api/src/core/effects.ts)),
  so nobody is ever told about a change that rolled back.

### Contact details, by consent

<p align="center">
  <img src="docs/assets/diagrams/contact-unlock.svg" alt="A verified recruiter sends an approach; the candidate sees the role, pay and message with contact details hidden; they accept with chosen channels, decline or block; the recruiter reveals only the shared channels, each reveal logged for the candidate; the candidate can revoke at any time" width="100%">
</p>

Email, phone and WhatsApp live in private columns that no public response ever includes. A
recruiter sends an approach with the role, the pay and a message; the candidate accepts with
the channels they choose, declines (a cooldown stops repeat asks), or blocks. Each reveal is
written to a contact access log in the same transaction, and the candidate can revoke access
at any time. The full model is in
[docs/architecture/privacy-and-contact-consent.md](docs/architecture/privacy-and-contact-consent.md).

### The hiring pipeline

<p align="center">
  <img src="docs/assets/diagrams/hiring-pipeline.svg" alt="Stages Applied, Screening, Interview, Offer and Hired, with Rejected (team only, reason required) and Withdrawn (candidate only) as exits; one pure function decides every move" width="100%">
</p>

Every move, single or bulk, is checked by one pure function,
[`canMoveStage`](apps/api/src/domain/pipeline.ts), and applied as a conditional update, so two
recruiters racing on the same card get one success and one clear conflict instead of a silent
overwrite.

### A move, from drag to every screen

<p align="center">
  <img src="docs/assets/diagrams/realtime.svg" alt="A recruiter moves a card; after commit the API emits to the job room for teammates' boards and to the candidate's user room for their timeline, through the Redis adapter, on any API task" width="100%">
</p>

Every socket joins a room for its user; a recruiter's open board joins the room for that job,
which the server allows only for active recruiters of the job's company. Teammates see the card
move, the candidate sees their timeline change, and team notes never leave the team.

### Who may message whom

The rule lives in one pure function, [`domain/can-message.ts`](apps/api/src/domain/can-message.ts):

1. You cannot message yourself, and restricted accounts cannot start conversations.
2. A block in either direction stops everything.
3. Connections, a recruiter and candidate after an accepted approach, and a hiring team and
   applicant on an application may message each other directly.
4. Anyone else may send a **message request**, if the recipient allows it: from anyone, from
   verified recruiters only (the default), or from nobody.

### AI resume import

<p align="center">
  <img src="docs/assets/diagrams/ai-import.svg" alt="Text, a PDF, a DOCX or a voice note goes to private storage; a job carries only the key; text is extracted or transcribed; the provider returns structured data; it is sanitised; badges need a verbatim quote; the person reviews and applies each section; personal data is purged afterwards" width="100%">
</p>

The provider is pluggable (OpenAI by default, Gemini, a deterministic stub, or none) and never
writes to a page directly: its proposal is sanitised (links must be http or https, contact
details are stripped) and the person approves each section. Details in
[docs/architecture/ai.md](docs/architecture/ai.md).

### Moderation

<p align="center">
  <img src="docs/assets/diagrams/moderation.svg" alt="Content is scanned after it is saved; thresholds decide clean, review or hide; reports join the case; staff act from the desk; authors can appeal" width="100%">
</p>

The policy that turns scores into an outcome is a pure, unit-tested function
([`domain/moderation-decision.ts`](apps/api/src/domain/moderation-decision.ts)); thresholds are
admin settings, and the classifier can be OpenAI's moderation model, built-in rules or a stub.

### Media

<p align="center">
  <img src="docs/assets/diagrams/media-upload.svg" alt="The browser gets a ticket, uploads straight to the private bucket with a presigned PUT, completes the upload; the API checks size and magic bytes; the worker strips metadata and makes a thumbnail" width="100%">
</p>

Bytes never pass through the API. The bucket is private and encrypted with KMS, every read is a
short-lived signed URL, and content can only reference uploads by id: yours, finished, inspected
and unused. Photos are shown only after location and camera metadata are stripped.

## 🧰 Tech stack

| Layer | Choice |
|---|---|
| Web | Next.js 15 (App Router), React 19, TanStack Query, Radix UI, Tailwind CSS |
| API | Node.js 22, Express 5, Kysely on PostgreSQL 16 (full-text and trigram search), zod, Socket.IO 4 with the Redis adapter |
| Jobs | BullMQ on Redis 7 |
| AI | OpenAI (default), Gemini, a stub or none, behind one interface; in-process PDF and DOCX text extraction |
| Media | S3 presigned uploads, sharp for image processing, pdfkit and docx for resume export |
| Mail | Amazon SES (or SMTP, or a local outbox) |
| Infrastructure | Terraform, ECS Fargate, ALB, CloudFront and WAF, RDS, ElastiCache, S3, KMS, SES, Secrets Manager, CloudWatch |
| Local AWS | The Floci emulator (S3, SES, KMS, Secrets Manager) and Mailpit ([ADR 0013](docs/architecture/adr/0013-floci-for-local-aws.md)) |
| Tooling | pnpm workspaces, Turborepo, TypeScript strict, Vitest, Playwright, ESLint, Prettier |

## 📋 Prerequisites

- Docker with Compose v2 (about 6 GB of free disk for images)
- Node.js 22 and pnpm 9 (only to run tests or develop outside Docker)
- For AWS: an account, a domain in Route 53 with an ACM certificate, and Terraform 1.10 or later

No AWS account and no AI key are needed to run it locally.

## 🚀 Quickstart

```bash
git clone https://github.com/euron-sde-team/euron-open-talent-network.git
cd euron-open-talent-network
make up      # builds the images, starts Floci, Postgres, Redis, Mailpit, the AI stub and the app
make demo    # seeds a fictional network: people, eight companies, jobs, applications, posts
```

| What | Where |
|---|---|
| The app | http://localhost:3520 |
| Mail (verification links, recruiter codes, digests) | http://localhost:8036 |
| API readiness | http://localhost:5016/api/ready |

`make demo` prints the demo accounts and their shared password:

| Account | Try |
|---|---|
| `juniper.vale@example.com` | A candidate: the feed, your talent page, applications, the dashboard with an approach to accept |
| `harper.lindqvist@example.com` | Owner of Northwind Labs: the recruiter workspace, the pipeline board, talent search |
| `admin@example.com` | The control plane: recruiter approvals, settings, the audit log |
| `quinn.avery@example.com` | A moderator: the moderation desk |
| `rowan.pike@example.com` | Recruiter operations: approvals and companies |

The local stack runs the AI stub, so resume import works with no key. Sign up with any address
to see the email flows: they land in Mailpit. `make down` stops everything and deletes the
local data. The full walkthrough is in [docs/guides/quickstart-local.md](docs/guides/quickstart-local.md).

## 🧭 Explore the repository

```
apps/
  api/              Express API, Socket.IO gateway, BullMQ worker, CLI
    src/routes/         URL + guards, one line per endpoint
    src/controllers/    parse the request (zod, strict), call one service, respond
    src/services/       business rules, transactions, after-commit effects
    src/repositories/   every SQL query; visibility.ts applies blocks and audiences
    src/presenters/     rows to API shapes, batched, signed media URLs
    src/domain/         pure rules: can-message, pipeline moves, profile strength, trust, badges, moderation
    src/integrations/   the AI providers, mail and storage
    src/realtime/       the gateway, rooms, presence
    src/jobs/           queue handlers and housekeeping
  web/              Next.js app: feed, talent pages, network, jobs, messaging, dashboard,
                    recruiter workspace, /admin control plane
  ai-stub/          OpenAI-compatible fake for tests and local development
packages/
  types/            the API contract: response shapes and the socket event map
  api-client/       typed client with token refresh, uploads and the socket
  ui/               design system: tokens, light and dark, Radix components
db/migrations/      the schema (SQL), applied by a checksummed runner
infra/terraform/    13 modules and 3 environments; infra/docker: the images
deploy/compose/     the local stack (Floci overlay, real-AWS overlay)
e2e/                Playwright suites against the full stack
docs/               architecture, ADRs, guides, the API reference
```

Start reading at [docs/guides/walkthrough.md](docs/guides/walkthrough.md): it follows a
candidate and a recruiter from sign-up to a hire, naming the file at every step.

## 🔌 API

REST under `/api` and Socket.IO under `/socket.io`, on the same origin as the web app.

- [docs/api/rest-contract.md](docs/api/rest-contract.md): every endpoint, its access level, body, response and error codes.
- [docs/api/openapi.yaml](docs/api/openapi.yaml): the OpenAPI 3.1 reference, generated from the route files (`make openapi`).
- [docs/architecture/realtime.md](docs/architecture/realtime.md): socket events, rooms and delivery guarantees.

```bash
# sign in, then call the API with the access token
TOKEN=$(curl -s localhost:5016/api/auth/login -H 'content-type: application/json' \
  -d '{"login":"juniper.vale@example.com","password":"<demo password>"}' | jq -r .accessToken)
curl -s "localhost:5016/api/jobs?q=platform" -H "authorization: Bearer $TOKEN" | jq '.items[0].title'
```

## ⚙️ Configuration

Every environment variable is declared and validated in one place,
[`apps/api/src/core/config.ts`](apps/api/src/core/config.ts), and documented in
[docs/guides/configuration.md](docs/guides/configuration.md). In production the API refuses to
start with a development secret, an open CORS policy, local storage, an outbox mailer, the stub
AI provider or a placeholder API key.

Network policy (registration, profile strength needed to publish, approach quotas and
cooldowns, free-mail domains, rating windows, moderation thresholds) is changed by admins in the
control plane, not in environment variables.

## ☁️ Deploy to AWS

```bash
cd infra/terraform/envs/aws-dev
cp terraform.tfvars.example terraform.tfvars    # name_prefix, domain, route53 zone, certificate
cd -
make aws-deploy ENV=aws-dev                     # registries, images, infrastructure, migrations, rollout
make aws-admin ENV=aws-dev EMAIL=you@example.com   # emails you a link to set the admin password
```

`aws-deploy` builds and pushes the images, applies the Terraform, runs the migrations as a
one-off task and waits for the services to be stable. `aws-dev` is sized small (one NAT gateway,
single-node Redis, no CDN); `aws-prod` adds three availability zones, Multi-AZ database and
cache, CloudFront with WAF, autoscaling and deletion protection. With an OpenAI key in Secrets
Manager, AI import and moderation switch on; without one they stay off.

Read [docs/guides/deploy-aws.md](docs/guides/deploy-aws.md) before the first deploy: it covers
SES production access, sizing, updates, rollbacks and teardown.

## 🔐 Security model

- **Identity from the token, never the body.** Request bodies are validated with strict zod
  schemas, so a forged `userId` or `recruiterId` is rejected, not trusted.
- **Sessions:** short-lived access tokens kept only in memory; refresh tokens in an httpOnly
  cookie, rotated on every use, with reuse detection that revokes the whole session family.
- **Accounts:** email verification, two-factor sign-in with encrypted secrets and recovery
  codes, throttled sign-in that never reveals whether an account exists.
- **Privacy:** contact details only through the logged, revocable reveal; section audiences and
  blocks applied in SQL by shared helpers; search indexes only what everyone may see.
- **Races:** state changes are conditional updates (`WHERE status = 'PENDING'`), connections and
  threads use ordered pair keys, and one-time codes count attempts atomically.
- **Realtime:** every room join is authorised; removed recruiters leave job rooms at once; bans
  and sign-outs disconnect sockets.
- **Media:** type allowlist, magic-byte checks, no SVG, metadata stripping, private bucket,
  signed URLs.
- **Infrastructure:** private subnets, KMS everywhere, TLS-only bucket, Redis with TLS and a
  password, least-privilege task roles, WAF, and a CloudFront origin secret the load balancer checks.

Details, and an honest list of known limitations, are in
[docs/architecture/security.md](docs/architecture/security.md) and the
[threat model](docs/architecture/threat-model.md). To report a vulnerability, see
[SECURITY.md](SECURITY.md).

## 🧪 Testing

| Suite | What it proves | Run |
|---|---|---|
| Unit (459) | Messaging eligibility, pipeline moves, profile strength, trust and rating rules, badges, safe URLs, recruiter verification, moderation decisions, the AI sanitiser, the web app's state logic and components | `make test` |
| Integration (466) | The real API and socket gateway in-process against Postgres and Redis: every route group, an authorisation sweep (forged identities, blocks, audiences, contact leaks, races, roles), realtime delivery, AI import against the stub | `make test-integration` |
| Matrix (12 runs) | The integration suite under every backend: local or S3 storage, outbox, SMTP or SES mail, rules or stub moderation | `make test-matrix` |
| Browser (17) | Sign-up by email, talent pages and privacy, AI import, the feed, messaging and requests, blocking, moderation and appeals, recruiter onboarding and approval, consent-based contact unlock, Easy Apply and the live pipeline, ratings, admin settings, two-factor | `make e2e` |
| Infrastructure | `terraform validate` for three environments, tflint, checkov, shellcheck, gitleaks | `make tf-validate tf-lint tf-security` |

How to run each suite, and what the matrix covers, is in [docs/guides/testing.md](docs/guides/testing.md).

## 📖 Documentation

| Architecture | Guides |
|---|---|
| [High-level design](docs/architecture/HLD.md) | [Quickstart (local)](docs/guides/quickstart-local.md) |
| [Low-level design](docs/architecture/LLD.md) | [Local with real AWS](docs/guides/local-with-aws.md) |
| [Data model](docs/architecture/data-model.md) | [Deploy to AWS](docs/guides/deploy-aws.md) |
| [Privacy and contact consent](docs/architecture/privacy-and-contact-consent.md) | [Configuration](docs/guides/configuration.md) |
| [Hiring pipeline](docs/architecture/hiring-pipeline.md) | [Operations](docs/guides/operations.md) |
| [AI](docs/architecture/ai.md) | [Recruiter verification](docs/guides/recruiter-verification.md) |
| [Realtime](docs/architecture/realtime.md) | [Moderation playbook](docs/guides/moderation-playbook.md) |
| [Moderation](docs/architecture/moderation.md) | [Troubleshooting](docs/guides/troubleshooting.md) |
| [Media](docs/architecture/media.md) | [Testing](docs/guides/testing.md) |
| [Security](docs/architecture/security.md) and [threat model](docs/architecture/threat-model.md) | [Walkthrough: a candidate and a recruiter, end to end](docs/guides/walkthrough.md) |
| [Decision records (19)](docs/architecture/adr/README.md) | |

## 🗺️ Roadmap

- Web push and mobile notifications
- Single sign-on (OIDC and SAML) for organisations and university networks
- Skill assessments and verified credentials (Open Badges)
- Video introductions on talent pages with adaptive streaming
- Interview scheduling with calendar integration
- Semantic search with embeddings, as an option next to full-text search

Ideas and pull requests are welcome: open an issue to discuss larger changes first.

## ❓ FAQ

<details>
<summary><b>Is this a LinkedIn clone?</b></summary>

It is a professional network like LinkedIn, built for organisations that want to run their own:
the same familiar building blocks (talent pages, connections, a feed, jobs, messaging, company
pages), with stricter privacy by design. It has no affiliation with LinkedIn and uses none of its
branding, code or data.
</details>

<details>
<summary><b>Is it multi-tenant?</b></summary>

No: one deployment is one network, like Mastodon or Discourse. Organisations run their own.
The reasoning is in [ADR 0001](docs/architecture/adr/0001-single-network-per-deployment.md).
</details>

<details>
<summary><b>Do I need an OpenAI key?</b></summary>

No. Without one, resume import is hidden (people fill in their page by hand) and moderation uses
the built-in rules; everything else works the same. With a key, import, polish and moderation
use OpenAI; Gemini is a configuration change away.
</details>

<details>
<summary><b>Why can't recruiters see contact details on a talent page?</b></summary>

Because the candidate has not said yes yet. Scraped contact details are the main abuse in
professional networks; here a recruiter must be verified, must ask, and sees only the channels
the candidate chose, with every view in the candidate's access log.
</details>

<details>
<summary><b>How does it scale?</b></summary>

Add API tasks: sockets fan out through Redis, so any server can deliver to any user. Lists use
keyset pagination (no OFFSET, no counts), search uses Postgres full-text and trigram indexes, and
slow work runs on the worker. The production environment autoscales the API, worker and web
services independently.
</details>

<details>
<summary><b>Can I run it without Docker or without AWS?</b></summary>

Yes. The API needs Postgres and Redis; storage can be local disk, mail can be SMTP or an outbox,
and AI can be off. `make up` is simply the fastest way to see everything, including the AWS
services, working together.
</details>

<details>
<summary><b>Is the demo data real?</b></summary>

No. Every person and company is fictional, addresses use reserved example domains, and every
avatar, logo and image is generated by code.
</details>

## 🤝 Contributing, security and license

- Contributions: read [CONTRIBUTING.md](CONTRIBUTING.md) and the
  [code of conduct](CODE_OF_CONDUCT.md).
- Security issues: please report privately, as described in [SECURITY.md](SECURITY.md).
- License: [MIT](LICENSE).

Released under the [MIT License](LICENSE). Copyright (c) 2026 ENGAGESPHERE TECHNOLOGY
PRIVATE LIMITED and the Euron Open Talent contributors.

<p align="center">
  <sub>If Euron Open Talent is useful to you, <a href="https://github.com/euron-sde-team/euron-open-talent-network/stargazers">star the repository</a>: it helps others find it.</sub>
</p>
