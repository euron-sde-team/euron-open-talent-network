# Moderation and trust playbook

How platform operators keep a network trustworthy: the moderation case desk, appeals,
recruiter approvals, complaints between members, ratings, and the settings that tune all
of it. The pipeline that feeds the desk is described in
[moderation.md](../architecture/moderation.md); the endpoints are in
[rest-contract.md](../api/rest-contract.md#moderation-apimoderation). Recruiter approvals
have their own guide, [recruiter-verification.md](recruiter-verification.md).

## Who sees what

Operators hold a platform role (`users.role`). Each role opens a fixed set of `/admin`
areas, from one table in
[`domain/admin-permissions.ts`](../../apps/api/src/domain/admin-permissions.ts). Every admin
API call checks it (`requireArea`, `403 FORBIDDEN_AREA`), and the web app shows only the
areas the operator may open (`GET /api/admin/me`).

| Area (`/admin?area=`) | ADMIN | MODERATOR | RECRUITER_OPS |
| --- | --- | --- | --- |
| `overview` (KPIs over a date range, CSV export) | yes | yes | yes |
| `recruiters` (the approval queue) | yes | | yes |
| `companies` (verify, suspend, domains) | yes | | yes |
| `moderation` (the case desk) | yes | yes | |
| `people` (accounts, profiles, verification badges) | yes | yes | |
| `jobs` (every posting, close one) | yes | yes | yes |
| `complaints` (disputes between members, and ratings) | yes | yes | |
| `settings` (platform policy, role changes, erasure) | yes | | |
| `audit` (every change, by whom) | yes | | |

The moderation desk is also at `/moderation`, and the case API (`/api/moderation/cases`)
is for platform staff (MODERATOR and ADMIN). Members see their own cases, decisions and
appeals at `/account/moderation`. Reporters are never shown to anyone in a case, and the
author's view has no raw AI scores and no moderator identity.

Hard rules the API enforces, whatever the UI shows:

- Nobody acts on their own account (`400 CANNOT_MODERATE_SELF`), and only a platform ADMIN
  may act on a case about their own content (`403 SELF_MODERATION`).
- Admin accounts are out of reach of case and account actions (`403 TARGET_PROTECTED`);
  demote first. Moderators cannot act on other moderators.
- A suspended operator has no powers: acting needs an ACTIVE account.
- Nobody reviews their own recruiter application or a complaint they are part of
  (`403 SELF_REVIEW`).

## The case desk

A case is one OPEN record per target (a partial unique index), so new reports and
re-scans attach to the case that is already open. Cases come from three sources:

| Source | Opened by |
| --- | --- |
| `AI` | The automated scan of new and edited content scored at or above a review threshold |
| `REPORT` | A member's report |
| `PREMODERATION` | A post from a new account held for review before anyone else sees it |

Targets are `POST`, `COMMENT`, `DM_MESSAGE`, `USER`, `PROFILE`, `COMPANY`, `JOB` and
`APPROACH`. The queue sorts by priority (each report raises it, capped) and then by age.
Staff connected to the app get a live open-case count (`moderation:queue`).

### Reading a case

A case shows the snapshot of the content as it was when the case opened, the current
status of the target (it may have changed since), the AI provider, categories and scores,
the report reasons with counts, and the target's moderation history
(`GET /api/moderation/history`). Assign a case to yourself or another staff member before
working a long one so two people do not decide it at once.

### Triage

1. Severe categories first: anything scored or reported as `sexual/minors`, threats, or
   self-harm. These have the lowest thresholds by default.
2. Items already hidden automatically (their author is waiting and can appeal).
3. Held posts (`PREMODERATION`): the author cannot be seen until you decide.
4. Talent targets: an `APPROACH`, `JOB` or `COMPANY` case can mean a recruiter or a company
   page is misbehaving across many people. Check the recruiter row and the company in
   `/admin?area=recruiters` and `companies` too.
5. Everything else by priority.

### Content actions

| Action | From status | Result |
| --- | --- | --- |
| `APPROVE` | PENDING_REVIEW, HIDDEN, PUBLISHED | PUBLISHED, moderation state CLEAN. For a held post, the mentions it skipped are sent now |
| `HIDE` | PUBLISHED, PENDING_REVIEW, HIDDEN | HIDDEN (restorable); the author is told and may appeal |
| `REMOVE` | PUBLISHED, PENDING_REVIEW, HIDDEN, REMOVED | REMOVED (final unless an appeal wins) |
| `RESTORE` | HIDDEN, REMOVED, PUBLISHED | PUBLISHED, moderation state CLEAN |
| `DISMISS` | any | Closes the case and changes nothing |

Any other starting status is `409 INVALID_TRANSITION`. A `USER` case takes account actions
only (`400 INVALID_ACTION`). Every action writes a `moderation_actions` row and an
`audit_log` row and resolves the case.

The talent targets map onto these statuses
([`services/moderation/targets.ts`](../../apps/api/src/services/moderation/targets.ts)):

| Target | Hide or remove does | Restore does |
| --- | --- | --- |
| `PROFILE` | Suspends the profile and revokes every live contact unlock the person granted | Sets it UNLISTED: the owner republishes deliberately |
| `COMPANY` | Suspends the company page: its jobs and posts disappear from every list | Returns it to VERIFIED when it had been verified, otherwise UNVERIFIED |
| `JOB` | Sets the job's content status; the open-job counter follows | Republishes it |
| `APPROACH` | Withdraws a pending approach (it leaves the candidate's inbox). The recruiter's daily quota does not count approaches the classifier flagged | |

Profiles are scanned on every edit but are never hidden automatically: a profile verdict
only opens an `AI` case for you. Accounts, profiles and company pages are never hidden by
a report count either.

### Account actions

Account actions apply to the case's author (or, from `/admin?area=people`, to anyone). The
console and the case desk call the same code, so both leave the same trail: a moderation
action, an audit entry, a notification and, for a suspension or ban, the person's sockets disconnected.

| Action | Who | Effect |
| --- | --- | --- |
| `WARN` | staff | A notice to the person; nothing else changes |
| `SUSPEND` | staff | Read-only for `suspendDays` (1 to 3650; required, `400 SUSPEND_DAYS_REQUIRED`); open sockets are disconnected (`session:revoked` `SUSPENDED`) and the person can still sign in to read and appeal; a timed suspension lifts itself (`maintenance.lift-suspensions`, every 5 minutes) |
| `BAN` | platform ADMIN | Cannot sign in; every session is revoked, `token_version` is bumped, sockets end |
| `UNBAN` | platform ADMIN | Back to ACTIVE |

A suspended recruiter account cannot approach anyone, reveal contact details or move
pipeline cards, because every one of those checks for an ACTIVE account.

## Appeals

The person a case is about may appeal once per case (`POST /api/moderation/cases/:id/appeal`),
even while suspended:

- a RESOLVED case whose resolution was HIDE, REMOVE, SUSPEND or BAN, within 30 days;
- an OPEN case whose target was hidden automatically and is still HIDDEN.

WARN and DISMISS are not appealable (`400 NOT_APPEALABLE`). Banned accounts cannot sign in,
so they appeal outside the product, by whatever channel the operator publishes.

Deciding (`/api/moderation/appeals/:id/decide`):

- A different staff member decides. An admin may decide an appeal about their own case only
  with a written note, which stays on the record.
- `OVERTURNED` undoes the decision: content goes back to PUBLISHED; an account goes back to
  ACTIVE only if it is still in the state this case put it in and no later moderation
  action on it exists. Otherwise the overturn is recorded and the later decision stands.
- `UPHELD` leaves it. On an OPEN case, the appeal decision also resolves the case.
- The appellant is notified either way.

## Recruiter approvals

Recruiters gain the power to search with recruiter filters, approach candidates, post jobs
and see pipelines only after their work email is confirmed and an operator approves them
(or their company's domain is trusted for auto-approval). Work the queue in
`/admin?area=recruiters`; the checklist, the evidence fields and what suspension does are
in [recruiter-verification.md](recruiter-verification.md).

## Complaints

Complaints are about dealings between two members (harassment, non-payment, no-show,
misrepresentation, spam, scams, discrimination), not about a piece of content. They are
filed with `POST /api/trust/complaints` and worked in `/admin?area=complaints`.

What the API has already checked before you see one:

- **A real relationship.** The complainant must name an approach, an application or an
  engagement, and it must be between the two of them: the approach's recruiter and
  candidate, the application's candidate and a recruiter of the hiring company, or the
  engagement's two sides. Anything else is `404 NO_RELATIONSHIP`, so strangers cannot file
  complaints against anyone they like.
- **Volume.** At most `settings.trust.complaintsPer30Days` per complainant (plus a daily
  route limit), and one open complaint per engagement.
- **Evidence by upload id.** Evidence files are `EVIDENCE` uploads, visible only to the
  complainant and staff.

Each row shows `priorComplaintsAgainst`: how many complaints exist against the same person.
A pattern across unrelated complainants matters more than any single complaint.

Resolving (`POST /api/admin/complaints/:id/resolve`):

| Status | Use when | Note |
| --- | --- | --- |
| `UNDER_REVIEW` | You are looking into it (asking either side for more) | optional |
| `ACTION_TAKEN` | You acted. Optionally attach an enforcement action, `WARN` or `SUSPEND` with `days`, applied to the person complained about through the same account-action code as the case desk; the action is linked to the complaint | required |
| `DISMISSED` | Nothing to act on | required |

A final status notifies **both** sides with your note (`COMPLAINT_UPDATED`), so write it for
both readers: what you found, what happens next, nothing about the other side's private
details. For anything stronger than a suspension (a ban, suspending a recruiter, suspending
a company page) use the people, recruiters or companies areas; the complaint records what
you did in its note.

## Ratings

Ratings come from completed engagements and are double-blind: each side's rating stays
hidden until both have rated or the window (`settings.trust.ratingWindowDays`) closes.
Before reveal a rating can be edited once; after reveal it can never be edited
(`409 RATING_REVEALED`), so neither side can answer the other's score. The displayed
average is Bayesian-adjusted (a prior of 4.0 worth three ratings), so one rating does not
dominate.

Operators cannot change a rating. They can hide one (`POST /api/admin/ratings/:id/hide` with
a reason, area `complaints`), which removes it from the person's page and recomputes the
stored average. In the web app this lives inside a complaint, under "Ratings between them".
Hide a rating when it is abusive, discloses private details, or comes out of an engagement
you found to be fake; do not hide a rating for being low.

## Profiles, companies and jobs outside a case

| Where | Action | API |
| --- | --- | --- |
| `people` | Suspend a profile (with a reason), restore it (UNLISTED) | `/api/admin/users/:id/profile/suspend`, `/restore` |
| `people` | Grant or revoke a VERIFICATION badge | `/api/admin/users/:id/badges`, `/api/admin/badges/:id` |
| `companies` | Verify, unverify, suspend (reason required), edit domains and auto-approval | `PATCH /api/admin/companies/:id` |
| `jobs` | Close a posting with a reason | `/api/admin/jobs/:id/close` |
| `settings` | Change a role, erase an account | `PATCH /api/admin/users/:id`, `/erase` |

Suspending a company withdraws its pending approaches and closes its open jobs at once.
Erasure anonymises the account (the same code as self-deletion) and needs the admin role;
admins must be demoted first.

## Settings to tune

All in `/admin?area=settings` (`PATCH /api/admin/settings`, strictly validated). Defaults
are in [`services/settings.service.ts`](../../apps/api/src/services/settings.service.ts).

| Setting | Default | Effect |
| --- | --- | --- |
| `moderation.enabled` | true | Off: nothing is scanned |
| `moderation.provider` | `MODERATION_PROVIDER` | `rules`, `openai` or `stub`. `openai` without a usable key falls back to `rules` with a logged warning |
| `moderation.thresholds` | per category, for example `harassment` review 0.5 and hide 0.85, `sexual/minors` 0.1 and 0.3 | A score at or above `review` opens a case and leaves the item visible; at or above `hide` hides it at once |
| `moderation.premoderateNewAccounts` | off; first 3 posts, accounts younger than 2 days | Hold new accounts' first posts for review |
| `moderation.blockedTerms` | empty | The rules provider scores text containing one as `harassment` 0.9 |
| `recruiter.*` | 25 approaches per day, expiry 14 days, decline cooldown 30 days, 50 open jobs per company | Outreach volume |
| `messaging.*` | 20 requests per day, 3 messages per request | Message request limits |
| `trust.*` | auto-confirm 14 days, rating window 60 days, 3 complaints per 30 days | Engagements, ratings, complaints |
| `profile.publishThreshold` | 55 | Completeness needed to publish |

Staff content is never hidden automatically; it still gets a case. User reports alone
hide content only when three distinct reporters, ACTIVE and with accounts older than a day,
report it on the current OPEN case.

## The audit log

`/admin?area=audit` (ADMIN) lists every administrative and security change with the
operator's id, the entity and the data of the change: recruiter approvals and rejections,
company updates, complaint resolutions, rating hides, role changes, settings changes,
moderation actions, approach accepts and revokes, profile publishing. Filter by action,
actor or entity. Entries are append-only; nothing in the product edits or deletes them.

## What is not automated

- Nothing is removed or banned automatically: the pipeline only hides (restorably) and
  queues.
- Accounts, profiles and company pages are never hidden by reports or by the classifier.
- Recruiters are never approved automatically except through a VERIFIED company's trusted
  domain, and never with a free-mail address.
- No re-scan on demand; editing an item triggers a new scan.
