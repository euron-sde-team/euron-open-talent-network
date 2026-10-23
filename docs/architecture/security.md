# Security architecture

The controls Euron Open Talent has today, by area, with the file that implements each, and
an honest list of what it does not do yet. The STRIDE analysis built on these controls is in
[threat-model.md](threat-model.md); the contact-consent model has its own page,
[privacy-and-contact-consent.md](privacy-and-contact-consent.md). Paths are relative to the
repository root.

Report vulnerabilities as described in [`SECURITY.md`](../../SECURITY.md).

## 1. Authentication

| Control | Detail | Where |
| --- | --- | --- |
| Password storage | bcrypt, cost `BCRYPT_ROUNDS` (12; the production guard refuses less) | [`apps/api/src/security/passwords.ts`](../../apps/api/src/security/passwords.ts) |
| Password policy | 10 to 128 characters, not a single repeated character, must not contain the email local part or the username | same |
| Enumeration resistance | Unknown accounts run a bcrypt compare against a dummy hash, so "no such account" and "wrong password" take the same time and return the same `INVALID_CREDENTIALS`. `forgot-password` and `resend-verification` always answer `202` | [`apps/api/src/services/auth.service.ts`](../../apps/api/src/services/auth.service.ts) |
| Failure throttling (no lockout) | Failed sign-ins (wrong password, wrong code, unknown account) are counted in Redis: 5 per account and IP per 15 minutes (`login-fail-pair`), 50 per account per hour across IPs (`login-fail-account`). Once either is spent every attempt gets the same `429 RATE_LIMITED`, right password or not, existing account or not. Nothing is written to the account, so nobody can lock someone else out | `LOGIN_PAIR_BUDGET`, `LOGIN_ACCOUNT_BUDGET` in `auth.service.ts`; [`apps/api/src/middleware/rate-limit.ts`](../../apps/api/src/middleware/rate-limit.ts) |
| Two-factor | TOTP (RFC 6238, 6 digits, 30 s, one step of drift). The accepted time step is stored (`totp_last_step`) and any step at or below it is refused, so a code works once. The secret is stored AES-256-GCM encrypted (key derived with HKDF from `TOTP_ENCRYPTION_KEY`, the user id bound in as associated data). Enabling returns 10 single-use recovery codes, shown once and stored as HMACs. Disabling needs the password and a current code or a recovery code | [`apps/api/src/security/totp.ts`](../../apps/api/src/security/totp.ts), [`apps/api/src/repositories/recovery-code.repository.ts`](../../apps/api/src/repositories/recovery-code.repository.ts) |
| Registration | `settings.registration`: `OPEN` or `CLOSED` (403 `REGISTRATION_CLOSED`). Every new account gets a `DRAFT` profile that only its owner can publish | `signup` in `auth.service.ts` |
| Email verification | Required by default (`REQUIRE_EMAIL_VERIFICATION`); single-use token, stored hashed | `auth.service.ts`, [`apps/api/src/repositories/auth-token.repository.ts`](../../apps/api/src/repositories/auth-token.repository.ts) |
| Password reset | Single-use token, stored hashed; issuing a new one voids the old; a reset (and a password change) revokes every session, bumps `token_version` and disconnects every socket | same |
| Account deletion and export | `DELETE /api/users/me` (password, plus a code when two-factor is on) anonymises the account in one transaction: profile cleared to `DRAFT`, contact values nulled, unlocks revoked, approaches ended, open applications withdrawn, sessions and sockets cut. `GET /api/users/me/export` streams the person's own data, 3 per day | [`apps/api/src/services/account.service.ts`](../../apps/api/src/services/account.service.ts) |
| Admin bootstrap | `admin:create` promotes an existing account without touching its password, or creates one and emails a set-password link; it prints no password unless `--print-password` is passed | [`apps/api/src/services/admin-bootstrap.service.ts`](../../apps/api/src/services/admin-bootstrap.service.ts), [`apps/api/src/cli.ts`](../../apps/api/src/cli.ts) |

## 2. Sessions, cookies and CSRF

| Control | Detail |
| --- | --- |
| Access token | JWT HS256 signed with `JWT_SECRET`, 15 minutes (`ACCESS_TOKEN_TTL_SECONDS`), audience, issuer and algorithm pinned on verify. It carries only the user id and `token_version`, and lives in browser memory only ([`apps/api/src/security/tokens.ts`](../../apps/api/src/security/tokens.ts)) |
| Per-request revocation | Every authenticated request reloads the user and compares `token_version`, so ban, deactivation, password change, reset and "sign out everywhere" cut off access tokens at once. Role and status always come from that row, never from the token ([`apps/api/src/middleware/auth.ts`](../../apps/api/src/middleware/auth.ts)) |
| Refresh token | 32 random bytes in the `os_refresh` cookie: `httpOnly`, `SameSite=Lax`, `Path=/api/auth`, `Secure` whenever `APP_WEB_URL` is https (`COOKIE_SECURE=auto`). Only its SHA-256 is stored ([`apps/api/src/controllers/auth.controller.ts`](../../apps/api/src/controllers/auth.controller.ts)) |
| Rotation and reuse detection | Each refresh issues a new token in the same family and marks the old one rotated; presenting a rotated token more than 10 seconds later revokes the whole family and writes `session.reuse_detected` to the audit log |
| Session management | `GET /api/users/me/sessions` lists active sessions; one can be revoked, or all with `POST /api/auth/logout-all`, which also disconnects every socket (`session:revoked`) |
| CSRF | The access token is a bearer header a cross-site page cannot read or send. The cookie only reaches `/api/auth/*`, is `SameSite=Lax`, and any non-GET request with an `Origin` outside `CORS_ORIGINS` gets `403 CORS_ORIGIN_DENIED` before routing ([`apps/api/src/app.ts`](../../apps/api/src/app.ts)) |
| CORS | Credentials allowed only for `CORS_ORIGINS` (default `APP_WEB_URL`); the production guard requires it to be set. Deployed, the app is same-origin, so CORS is a second line |
| Cross-tab refresh | The client serialises refreshes with the Web Locks API so two tabs do not trip reuse detection ([`packages/api-client/src/http.ts`](../../packages/api-client/src/http.ts)) |

See [ADR 0005](adr/0005-refresh-rotation-cookie-and-memory-token.md).

## 3. Authorisation

### Platform roles

`users.role` is one of four values. Staff powers are grouped into `/admin` **areas**, and
one table decides which role opens which area, `AREAS` in
[`apps/api/src/domain/admin-permissions.ts`](../../apps/api/src/domain/admin-permissions.ts):

| Area | `ADMIN` | `MODERATOR` | `RECRUITER_OPS` | Covers |
| --- | --- | --- | --- | --- |
| `overview` | yes | yes | yes | KPIs and the CSV of the daily series |
| `recruiters` | yes | | yes | The recruiter approval queue: approve, reject with a reason, suspend, reinstate, per-recruiter quota |
| `companies` | yes | | yes | Verify, suspend, restore; company domains and auto-approval |
| `moderation` | yes | yes | | The case desk and appeals |
| `people` | yes | yes | | Account search, warn, suspend (ban needs `ADMIN`), profile suspend and restore, verification badges |
| `jobs` | yes | yes | yes | Close postings |
| `complaints` | yes | yes | | Complaint triage and resolution; hiding ratings |
| `settings` | yes | | | Platform settings, role changes, erasure |
| `audit` | yes | | | The audit trail |

`USER` opens no area. Every function in
[`apps/api/src/services/admin.service.ts`](../../apps/api/src/services/admin.service.ts)
starts with `requireArea(actor, area)` ([`apps/api/src/core/context.ts`](../../apps/api/src/core/context.ts)),
which answers 403 `FORBIDDEN_AREA`; the same table is sent to the web app
(`GET /api/admin/me`) so the sidebar shows only usable areas, but the server never relies on
the client hiding anything.

Further rules in the same places:

- Role changes: never your own (`CANNOT_CHANGE_OWN_ROLE`), never the last active admin
  (`LAST_ADMIN`, checked with every admin row locked so two concurrent demotions cannot both
  pass).
- Moderation actions ([`apps/api/src/services/moderation/actions.service.ts`](../../apps/api/src/services/moderation/actions.service.ts)):
  `MODERATOR` and `ADMIN` only (`RECRUITER_OPS` has no moderation powers); ban and unban are
  `ADMIN` only; nobody acts on their own account; admins are out of reach and moderators
  cannot act on moderators (`TARGET_PROTECTED`); acting needs an `ACTIVE` account; only an
  `ADMIN` may act on a case about their own content (`SELF_MODERATION`).
- Recruiter review: nobody reviews their own application (`SELF_REVIEW`), only
  `PENDING_REVIEW` rows can be decided, and a rejection needs a note (`NOTE_REQUIRED`).

Other helpers in `core/context.ts`: `requireActor`, `requireActive` (writes need an
`ACTIVE` account, 403 `ACCOUNT_RESTRICTED`), `requireStaff` (`MODERATOR` or `ADMIN`),
`requireAdmin`.

### Recruiters and company teams

- `requireRecruiter(actor)` ([`apps/api/src/services/recruiter.service.ts`](../../apps/api/src/services/recruiter.service.ts))
  loads the caller's own `recruiters` row by **session user id**, requires status `ACTIVE`
  and a company that is not `SUSPENDED`, or answers 403 `RECRUITER_REQUIRED`. Every
  recruiter capability (recruiter search filters, approaches, contact reveals, jobs,
  pipelines, notes, invitations) goes through it.
- `requireCompanyAdmin(r)` adds team role `OWNER` or `ADMIN` for company page edits, team
  roles and removal, and posting as the company (403 `NOT_COMPANY_ADMIN`). Only an owner can
  remove an owner; the last owner of a team with other members must hand over before leaving
  or deleting their account (409 `OWNER_MUST_TRANSFER`).
- Team data is scoped by `company_id = recruiter.company_id` in every query: jobs,
  applications, pipeline columns, notes. Another company's ids are 404, so they cannot be
  probed.
- A user recruits for at most one company (`recruiters.user_id` is unique); a work email
  belongs to one recruiter (`work_email` unique, 409 `WORK_EMAIL_TAKEN`).

Verification is described in [ADR 0015](adr/0015-recruiter-verification-work-email-and-review.md)
and the operator guide [recruiter-verification.md](../guides/recruiter-verification.md).

### Ownership

Every write that touches a person's own data filters by the session user, never by an id in
the body: profiles (`user_id = actor.id`), applications (`candidate_id = actor.id` for the
candidate), approaches (`candidate_id = actor.id` to accept, decline, revoke; the
recruiter row for withdraw and reveal), imports (`user_id = actor.id`), uploads
(`owner_id = actor.id` to complete, delete or attach), invitations, saved items, sessions.
A row that does not belong to the caller is a 404.

### Visibility rules in SQL

[`apps/api/src/repositories/visibility.ts`](../../apps/api/src/repositories/visibility.ts)
expresses the rules every read applies as reusable Kysely expressions and helpers:

- `notBlocked(viewerId, column)` and `isBlockedEitherWay(a, b)`: no block in either
  direction. Feeds, comments, reaction lists, the directory and search, profiles, network
  lists, mentions, presence, DM history, notifications, approaches, applications, invites and
  contact reveals all apply it.
- `canReadPost(viewer)`: `CONNECTIONS`-only posts for the author's connections and staff.

Every post list starts from `postRepo.visible()`, so a new feed cannot forget either rule
([`apps/api/src/repositories/post.repository.ts`](../../apps/api/src/repositories/post.repository.ts)).
Profiles follow per-section audiences and open-to-work modes decided in one presenter
([privacy-and-contact-consent.md](privacy-and-contact-consent.md#2-who-sees-which-section)).

### Direct messages

Who may message whom is the pure `canMessage()` in
[`apps/api/src/domain/can-message.ts`](../../apps/api/src/domain/can-message.ts): no self,
an `ACTIVE` sender and recipient, no block either way (never waived, staff included), staff
for support, and otherwise a reason to talk (a connection, an accepted approach, an
application link) or a message request admitted by the recipient's policy (`ANYONE`,
`RECRUITERS`, `NOBODY`), capped at `settings.messaging.requestMessageCap` messages until
accepted ([ADR 0006](adr/0006-can-message-rule.md)). Every send re-evaluates it with fresh
facts through `directSendDecision()` ([`apps/api/src/domain/dm-send.ts`](../../apps/api/src/domain/dm-send.ts)).
Thread ids are 404 to non-participants.

### Realtime

The gateway authenticates the handshake with the same function as HTTP, puts each socket in
its own `user:<id>` room (and `staff` for staff), and lets clients join other rooms only
through subscribe events checked with the REST read rule ([realtime.md](realtime.md)):
`thread:` for participants, `job:` for ACTIVE recruiters of the job's company, `post:` for
readers of the post. A block takes both people's sockets out of their 1:1 `thread:` room
(`fx.leave`). `presence:query` answers only for people the viewer could know about,
minus blocks. At most 20 live sockets per user and 30 subscribe or presence requests per 10
seconds per socket ([`apps/api/src/realtime/gateway.ts`](../../apps/api/src/realtime/gateway.ts)).

## 4. Rate limits

Limits are stored in Redis (`rate-limiter-flexible`), so the budget is shared by every API
task. Signed-in callers are keyed by user, others by IP
([`apps/api/src/middleware/rate-limit.ts`](../../apps/api/src/middleware/rate-limit.ts)). A
spent budget is `429 RATE_LIMITED` with `Retry-After`. Each Redis limiter has an in-memory
insurance limiter with the same budget, used while Redis is not ready, so an outage degrades
to per-task limits instead of 500s.

Route limits (in `apps/api/src/routes/*.routes.ts`):

| Name | Budget | Applies to |
| --- | --- | --- |
| `auth` | 10 / min / IP | sign-up, sign-in, verify, reset, change password, TOTP enable, disable and new recovery codes |
| `auth-mail` | 5 / h / IP | forgot password, resend verification |
| `auth-refresh` | 60 / min / IP | refresh |
| `profile-edit` | 120 per 10 min | every profile editor write |
| `username-change`, `username-check` | 5 / day, 60 / min / IP | username |
| `profile-view` | 120 / min / IP | view counting |
| `resume-export` | 20 / h | PDF and DOCX export |
| `endorse` | 120 / h | skill endorsements |
| `approach-send` | 60 / h | new approaches (plus the daily quota, section 5) |
| `contact-reveal` | 120 / h | `GET /api/approaches/:id/contact` |
| `recruiter-register`, `recruiter-code`, `recruiter-verify` | 10 / day, 5 / h, 20 / h | recruiter sign-up, code resend, code check |
| `notes` | 200 / h | team notes |
| `job-create`, `job-invite`, `job-search` | 30 / day, 100 / day, 120 / min / IP | jobs |
| `apply` | 50 / day | Easy Apply |
| `pipeline-move` | 600 / h | single and bulk moves |
| `engagement`, `complaints` | 30 / day, 5 / day | trust |
| `company-edit` | 60 per 10 min | company page edits |
| `connect`, `follows` | 60 / h, 60 / min | network |
| `posts`, `comments`, `reactions` | 10 / min, 30 / min, 120 / min | feed |
| `dm-send` | 30 / min | messages |
| `media-create` | 60 per 10 min | upload creation |
| `search` | 90 / min / IP | people search and typeahead |
| `reports`, `appeals` | 20 / h, 10 / h | moderation |
| `account-delete`, `account-export` | 5 / h, 3 / day | account lifecycle |

Service-level budgets: `dm-request` (`settings.messaging.requestsPerDay`, default 20 per
day), `dm-send` (600 per hour), `connection-request` (per day), `media-upload` (120 per
hour), `profile-import` (`settings.import.perDay`, default 5), `ai-polish` (50 per day),
`complaintsPer30Days` (default 3, 429 `COMPLAINT_LIMIT`), and the sign-in failure budgets.

With CloudFront in front, Terraform sets `TRUST_PROXY=2` (one hop otherwise), so `req.ip` is
the viewer address as CloudFront saw it, not a client-supplied `X-Forwarded-For` entry. The
WAF adds a per-IP limit at the edge (`rate_limit_per_5_minutes` in
[`infra/terraform/modules/cdn/main.tf`](../../infra/terraform/modules/cdn/main.tf)).

## 5. Controls

What the code does to keep the talent flows honest. Each is a property you can check in the
named file.

| Control | What the system does | Where |
| --- | --- | --- |
| Identity from the token | Every service takes an `Actor` built from the verified token and the reloaded user row. No endpoint accepts a user id, recruiter id or company id in the body to say who is acting; the recruiter is always the caller's own row | [`apps/api/src/core/context.ts`](../../apps/api/src/core/context.ts), `requireRecruiter` |
| Strict input | Every controller parses with zod; bodies use `.strict()`, so unknown fields are a 400 `VALIDATION_FAILED`, never silently ignored or spread into a row. Ids must match the ULID pattern; lengths are bounded in the schema and again by database CHECKs | [`apps/api/src/core/validate.ts`](../../apps/api/src/core/validate.ts), `apps/api/src/controllers/*.ts`, [`db/migrations/0001_init.sql`](../../db/migrations/0001_init.sql) |
| Conditional state changes | Transitions are `UPDATE ... WHERE status = <expected>` and check the affected row count: accept, decline and withdraw of an approach (`WHERE status = 'PENDING'`), revoke (`WHERE revoked_at IS NULL`), pipeline moves (`WHERE stage = <from>`, 409 `APPLICATION_CHANGED`), engagement confirmation, recruiter reinstatement, import runs (`WHERE status = 'QUEUED'`), housekeeping. Two concurrent requests can never both win | [`apps/api/src/services/approach.service.ts`](../../apps/api/src/services/approach.service.ts), [`apps/api/src/services/application.service.ts`](../../apps/api/src/services/application.service.ts), [`apps/api/src/services/trust.service.ts`](../../apps/api/src/services/trust.service.ts) |
| Uniqueness by constraint | Races are settled by the database: `ON CONFLICT DO NOTHING` against unique indexes for one pending approach per pair (partial index), one application per job and person, one invite per job and person, one engagement per approach or application, one open complaint per engagement, one connection per pair (`pair_key`), one 1:1 thread per pair (`direct_key`), one open moderation case per target | same, and [`db/migrations/0001_init.sql`](../../db/migrations/0001_init.sql) |
| Row locks where counting | Sends lock the recruiter row so the daily quota is exact; publishing a job locks the company row so the open-job cap is exact; role changes lock admin rows | `send()`, `assertOpenCapacity()` in [`apps/api/src/services/job.service.ts`](../../apps/api/src/services/job.service.ts), `changeRole()` |
| Open-job cap on every open | The cap (`maxOpenJobsPerCompany`) is checked whenever a job moves to `OPEN`, including reopening a closed one | `setStatus()` in `job.service.ts` |
| Blocks everywhere, and cascading | A block hides both people from each other in every read (section 3), and in the same transaction removes follows both ways and the connection, revokes contact unlocks either way and marks pending approaches `BLOCKED` | [`apps/api/src/repositories/block.repository.ts`](../../apps/api/src/repositories/block.repository.ts) |
| 404, not 403 | Anything hidden by a block, a draft or unpublished state, another company's scope or moderation answers 404, so existence cannot be probed. A blocked recruiter's approach attempt answers `APPROACH_NOT_PUBLISHED`, the same as an unpublished profile | `getPublic` in [`apps/api/src/services/profile.service.ts`](../../apps/api/src/services/profile.service.ts), `readableJob`, `approachBlock` in [`apps/api/src/domain/trust.ts`](../../apps/api/src/domain/trust.ts) |
| Contact details never in public DTOs | Contact values exist only in `MyProfile` (owner) and a `ContactReveal`; the public presenter never selects them | [`apps/api/src/presenters/profile.presenter.ts`](../../apps/api/src/presenters/profile.presenter.ts) |
| Consent per channel, logged | A reveal needs an ACCEPTED approach by this recruiter row, an unrevoked unlock and no block; returns only the chosen channels; logs each channel to `contact_access_log`, which the candidate reads | `revealContact()`, `contactLog()` |
| Quota counted from rows | The approach quota counts today's rows, excluding those moderation marked `FLAGGED`, so a rejected approach is refunded and the counter cannot drift | `sentToday()` in `approach.service.ts` |
| Expiry checked at use | Accepting checks `expires_at` itself instead of trusting the housekeeping sweep | `accept()` |
| Explicit publish | A profile is public only after its owner publishes it, with completeness at or above the threshold and a contact channel; the import never publishes | `setStatus()` in `profile.service.ts`, [ADR 0019](adr/0019-explicit-publish.md) |
| Work-email codes | Six digits from `crypto.randomInt`, 15 minute expiry, single use, bound to one recruiter; only an HMAC (keyed from `TOTP_ENCRYPTION_KEY`) is stored; attempts are counted with one atomic `UPDATE ... SET attempts = attempts + 1 ... RETURNING` before comparing, so parallel guesses cannot exceed 5; comparison is constant time; the code is mailed directly, never queued, so it never sits in Redis | [`apps/api/src/services/recruiter.service.ts`](../../apps/api/src/services/recruiter.service.ts), [`apps/api/src/domain/recruiter-verification.ts`](../../apps/api/src/domain/recruiter-verification.ts) |
| Free mail cannot prove membership | Free-mail and disposable domains (`settings.recruiter.freeMailDomains`) never auto-approve and are flagged in the review queue (`freeMail`, `domainMatches`) | `reviewRoute()`, `isFreeMail()` |
| Safe URLs | Every URL on a profile, project, certification, link or company page, and every URL the AI proposes, goes through `safeUrl()`: http or https only, a real host, no credentials, no control characters or whitespace, at most 500 characters | [`apps/api/src/domain/safe-url.ts`](../../apps/api/src/domain/safe-url.ts) |
| Clean display names | Emails, URLs and phone-like runs are removed from display names at write time | [`apps/api/src/domain/display-name.ts`](../../apps/api/src/domain/display-name.ts) |
| AI output is data, not instructions | The model's JSON is sanitised field by field (lengths clamped, months parsed, URLs through `safeUrl`, emails and phones stripped); badges survive only with a verbatim quote from the input and confidence at least 0.6; nothing is applied until the owner picks sections | [`apps/api/src/integrations/ai/schema.ts`](../../apps/api/src/integrations/ai/schema.ts), [`apps/api/src/domain/badges.ts`](../../apps/api/src/domain/badges.ts), [ai.md](ai.md) |
| Salted IP hashes | Signed-out profile views and contact reveals store an HMAC of the IP keyed with `VIEW_HASH_SALT`, never the IP | `recordView`, `revealContact` |
| Uploads by id, bytes verified | Content, resumes, imports and complaint evidence reference uploads by id only, owned by the caller and of the right purpose; on completion the stored size and magic bytes must match the declaration; SVG and markup are refused | [`apps/api/src/services/media-attach.service.ts`](../../apps/api/src/services/media-attach.service.ts), [`apps/api/src/domain/media-rules.ts`](../../apps/api/src/domain/media-rules.ts) |
| Complaints need a relationship | A complaint must name an approach, application or engagement that links the two people (404 `NO_RELATIONSHIP` otherwise), is capped per 30 days, and carries evidence as upload ids, never URLs | `fileComplaint()` in `trust.service.ts` |
| Ratings resist retaliation | Double blind until both rated or the window closed; one edit before reveal, none after; one rating per side per engagement; engagements need both sides to confirm; the displayed score is a Bayesian average | [`apps/api/src/domain/trust.ts`](../../apps/api/src/domain/trust.ts), `displayRating()` in [`apps/api/src/domain/profile.ts`](../../apps/api/src/domain/profile.ts) |
| Team-only data stays with the team | Candidate DTOs never include stage notes, team notes, note ratings, match detail or rejection reasons | [`apps/api/src/presenters/application.presenter.ts`](../../apps/api/src/presenters/application.presenter.ts) |
| Search input escaped | Text becomes a prefix tsquery of letters and digits only; `ILIKE` input has `%`, `_` and `\` escaped; only indexed columns are matched | [`apps/api/src/domain/search-text.ts`](../../apps/api/src/domain/search-text.ts), [`apps/api/src/repositories/text-search.ts`](../../apps/api/src/repositories/text-search.ts) |
| Parameterised SQL | All SQL goes through Kysely with bound parameters; raw `sql` fragments interpolate values as parameters and identifiers only from fixed names in code | `apps/api/src/repositories`, `apps/api/src/services` |
| Audit trail with the operator | Every admin and security-relevant change writes `audit_log` with the acting user's id, the IP where known, and the data changed; moderation actions also write `moderation_actions` | [`apps/api/src/services/audit.service.ts`](../../apps/api/src/services/audit.service.ts) |
| Settings validated | Admin settings are validated strictly (bounded numbers, thresholds in 0..1 with `review <= hide`, bounded lists) so a bad value cannot break the scanner or the quotas | [`apps/api/src/controllers/admin.controller.ts`](../../apps/api/src/controllers/admin.controller.ts) |
| Emails escape values | Every value interpolated into HTML mail is escaped | [`apps/api/src/integrations/mail/templates.ts`](../../apps/api/src/integrations/mail/templates.ts) |

## 6. Media

| Control | Detail |
| --- | --- |
| Allowlist | Declared MIME type must be on the list; SVG, HTML, XML, JavaScript, shell and executable types and extensions are refused by name ([`apps/api/src/domain/media-rules.ts`](../../apps/api/src/domain/media-rules.ts)) |
| Purpose decides kinds | Avatars, covers, logos and project covers accept images; `RESUME` PDF and documents; `IMPORT` PDF, documents, images and audio; `EVIDENCE` images and PDF |
| Size | Per-kind limits (images 15 MB, video 200 MB, audio 50 MB, PDF and documents 25 MB) checked on the declaration and again on the stored object |
| Bytes, not claims | On complete, the stored object's size must equal the declared size and its first bytes must match the type's magic number and must not look like markup; otherwise the object is deleted |
| No URLs from clients | Content references media by upload id only; claims check owner, purpose, status and that the upload is not attached elsewhere ([`apps/api/src/services/media-attach.service.ts`](../../apps/api/src/services/media-attach.service.ts)) |
| Private bucket | Block Public Access, bucket-owner-enforced ownership, SSE-KMS, TLS-only bucket policy, CORS for the app origin only ([`infra/terraform/modules/storage/main.tf`](../../infra/terraform/modules/storage/main.tf)) |
| Signed reads | Every response signs fresh GET URLs that expire after `SIGNED_URL_TTL_SECONDS` (900); `GET /api/media/:id` requires being able to see what the upload is attached to; import files and complaint evidence are visible only to their owner and staff |
| Metadata | Images are re-encoded without metadata (EXIF and GPS dropped) and are shown to nobody but the uploader until that has happened (`READY`); an undecodable HEIC is rejected |

Details: [media.md](media.md).

## 7. Headers and CSP

- **API**: Helmet with `default-src 'none'` and `frame-ancestors 'none'`, `X-Powered-By`
  off, `Cross-Origin-Resource-Policy: cross-origin` (signed local media); JSON bodies capped
  at 1 MB.
- **Web app**: a per-request CSP with a nonce and `strict-dynamic`, `object-src 'none'`,
  `frame-ancestors 'none'`, `base-uri 'self'`, `form-action 'self'`; images, media and
  `connect-src` allowed only for `'self'`, the socket origin and the `MEDIA_ORIGINS` list
  ([`apps/web/src/middleware.ts`](../../apps/web/src/middleware.ts)), plus static headers in
  [`apps/web/next.config.ts`](../../apps/web/next.config.ts).
- **Edge**: with the CDN, a managed security-headers response policy; the ALB drops invalid
  header fields and uses a TLS 1.2+ policy; port 80 only redirects.

## 8. Secrets and the production guard

`assertProductionConfig()` in [`apps/api/src/core/config.ts`](../../apps/api/src/core/config.ts)
runs at API and worker boot and throws when `NODE_ENV=production` and any of these holds:

| Problem | Why it matters |
| --- | --- |
| `JWT_SECRET` or `REFRESH_SECRET` is the committed development default, or shorter than 32 characters | Anyone could mint access tokens |
| `JWT_SECRET` equals `REFRESH_SECRET` | Rotating one must not rotate the other |
| `TOTP_ENCRYPTION_KEY` unset (the default is derived from a public constant) | TOTP secrets, recovery codes and recruiter code HMACs would be computable from the source |
| `VIEW_HASH_SALT` is the committed default | Signed-out viewers' IP hashes could be reversed by brute force over the IPv4 space |
| `CORS_ORIGINS` not set; `APP_WEB_URL` on localhost | Wrong links, non-`Secure` cookies |
| `STORAGE=local`, or `STORAGE=s3` without `S3_BUCKET` | Media on a container disk |
| `MAIL_MODE=outbox`, or a real mode without `MAIL_FROM` | Verification and recruiter codes never delivered |
| `MODERATION_PROVIDER=openai` without a usable `OPENAI_API_KEY`, or `MODERATION_PROVIDER=stub` | Every scan would fail or be fake |
| `AI_PROVIDER=stub` | A test double would write profile proposals |
| `JOBS_MODE=inline` | Background work on the request path, no retries, no housekeeping |
| `BCRYPT_ROUNDS` below 12 | Weaker password hashes |

On AWS the secrets never appear in a task definition or a log: `JWT_SECRET`,
`REFRESH_SECRET`, `TOTP_ENCRYPTION_KEY` (its own secret), `VIEW_HASH_SALT` (its own secret),
`REDIS_URL` with the AUTH token, and `OPENAI_API_KEY` when enabled are Secrets Manager values
injected by the ECS execution role
([`infra/terraform/modules/secrets/main.tf`](../../infra/terraform/modules/secrets/main.tf),
[`infra/terraform/modules/cache/main.tf`](../../infra/terraform/modules/cache/main.tf)). The
database password is the RDS-managed master secret, read for each new connection and cached
60 seconds, so RDS can rotate it without a redeploy
([`apps/api/src/db/connection-config.ts`](../../apps/api/src/db/connection-config.ts)). The
generated values are in Terraform state; protect the state backend.

Out of the box the api and worker connect as the RDS master user. The recommended
post-deploy step is a data-only application role; the runbook is in
[operations.md](../guides/operations.md).

Locally, `make env` writes random secrets to `deploy/compose/.env` (git-ignored)
([`scripts/gen-local-env.sh`](../../scripts/gen-local-env.sh)).

## 9. Logging

- Structured JSON (pino) with a request id on every line and in every error response
  ([`apps/api/src/core/logger.ts`](../../apps/api/src/core/logger.ts)).
- Redacted before writing: `authorization` and `cookie` headers, `set-cookie`, and any field
  named in `SECRET_KEYS` (passwords, tokens, TOTP secrets, `code`, recovery codes,
  `code_hash`, `apiKey` and more) at the top level or up to three levels deep, checked by
  [`apps/api/test/unit/logger-redaction.test.ts`](../../apps/api/test/unit/logger-redaction.test.ts).
  The `code` key covers recruiter work-email codes in request bodies.
- 500 responses carry only the request id; the stack trace stays in the log.
- On AWS, logs go to KMS-encrypted CloudWatch log groups with `log_retention_days` per
  environment.

## 10. Infrastructure controls

| Control | Where |
| --- | --- |
| One customer-managed KMS key with rotation encrypts RDS, Redis, S3, Secrets Manager, ECR and CloudWatch Logs; usage granted per role | [`modules/kms`](../../infra/terraform/modules/kms/README.md), [`modules/deployment/main.tf`](../../infra/terraform/modules/deployment/main.tf) |
| Media bucket: private, TLS-only policy, SSE-KMS, versioning, app-origin CORS | [`modules/storage/main.tf`](../../infra/terraform/modules/storage/main.tf) |
| RDS: private subnets, not public, TLS forced, encrypted, deletion protection and Multi-AZ in prod | [`modules/database/main.tf`](../../infra/terraform/modules/database/main.tf) |
| Redis: private subnets, TLS in transit, AUTH token, encrypted at rest, `noeviction` | [`modules/cache/main.tf`](../../infra/terraform/modules/cache/main.tf) |
| Network: tasks, RDS and Redis in private subnets; security groups by group, never by CIDR; narrow egress; VPC flow logs | [`modules/network`](../../infra/terraform/modules/network/README.md), [`modules/service/main.tf`](../../infra/terraform/modules/service/main.tf) |
| Least-privilege task roles: media objects, the one mail identity, the DB secret | [`modules/deployment/main.tf`](../../infra/terraform/modules/deployment/main.tf) |
| Containers: read-only root filesystem, non-root user, ECS Exec disabled | [`modules/service/main.tf`](../../infra/terraform/modules/service/main.tf), [`infra/docker/api.Dockerfile`](../../infra/docker/api.Dockerfile) |
| Edge: TLS at the ALB; optional CloudFront with a WAF, and then the ALB accepts only CloudFront with a generated origin header | [`modules/edge/main.tf`](../../infra/terraform/modules/edge/main.tf), [`modules/cdn/main.tf`](../../infra/terraform/modules/cdn/main.tf) |
| Images: ECR with immutable tags and scan on push | [`modules/ecr/main.tf`](../../infra/terraform/modules/ecr/main.tf) |
| Mail: SES identity with DKIM, custom MAIL FROM, a configuration set requiring TLS | [`modules/email/main.tf`](../../infra/terraform/modules/email/main.tf) |

## 11. Supply chain and CI

- [`.github/workflows/checks.yml`](../../.github/workflows/checks.yml) runs on every push and
  pull request with read-only permissions: lint, typecheck and unit tests across packages,
  Terraform format and validation, the OpenAPI reference check and the sanitization scan.
- [`scripts/check-sanitization.sh`](../../scripts/check-sanitization.sh) (`make sanitize`)
  fails on cloud credentials, private keys, account and resource ids, real email addresses,
  public IPs and committed env files in any file git would commit;
  [`.gitleaks.toml`](../../.gitleaks.toml) configures gitleaks.
- The full pipeline in [`.github/workflows-full/`](../../.github/workflows-full/README.md)
  (opt-in for forks) adds integration tests on Postgres and Redis, image builds, checkov,
  tflint, gitleaks, CodeQL and the end-to-end suite.
- Dependencies are pinned by `pnpm-lock.yaml`, with overrides for known vulnerable ranges in
  [`package.json`](../../package.json); only `esbuild` and `sharp` may run install scripts.

## Known limitations

Gaps found by reading the code, not design goals. They are rated in
[threat-model.md](threat-model.md).

**Accounts and sessions**

1. **Signing out does not end the access token.** `logout` revokes the refresh family, but an
   issued access token stays valid for up to 15 minutes (only `logout-all`, password change,
   reset, deletion and bans bump `token_version`).
2. **The account-wide sign-in budget can be spent by others**: 50 failures in an hour from any
   IPs throttle that account everywhere until the hour passes. Nothing is locked.
3. **`TOTP_ENCRYPTION_KEY` has no rotation path.** Changing it voids every TOTP secret and
   recovery code, and any outstanding recruiter code.
4. **Admin bootstrap trusts the mailbox** that receives the set-password link.

**Contact consent**

5. **A reveal cannot be taken back.** Revoking stops future reveals; it cannot erase what a
   recruiter already copied. The access log is the mitigation: the candidate sees exactly
   what was seen and when.
6. **The reveal budget is generous**: 120 per hour per recruiter, but each reveal needs a
   separate accepted approach, so this bounds repeat reads, not breadth.

**Recruiters and pipelines**

7. **Recruiter verification proves a mailbox, not employment.** A confirmed work email on the
   company domain plus human review (or domain auto-approval for a VERIFIED company) is the
   bar; someone who controls a mailbox at a company can pass it. Phone verification is not
   wired to any provider.
8. **`job:` rooms are not re-checked after a team change.** Removing or suspending a
   recruiter ends their REST access at once, but a socket already subscribed to a job board
   keeps receiving `pipeline:card` events until it unsubscribes or reconnects.
9. **Team notes are company-wide**: every ACTIVE recruiter of the company reads every note
   about a candidate; there is no per-job or per-author restriction.

**Ratings and complaints**

10. **Ratings are as honest as engagements.** Two colluding accounts can confirm an
    engagement and rate each other; the Bayesian average and the need for an accepted
    approach or a hire with a verified recruiter limit, but do not prevent, this.

**Media and AI**

11. **Video, audio and documents keep their metadata** (only images are re-encoded). Resumes
    are PDFs or documents, so their author metadata stays.
12. **Signed media URLs outlive permission changes** until `SIGNED_URL_TTL_SECONDS` runs out.
13. **Import content goes to the AI provider** chosen by `AI_PROVIDER` (OpenAI or Gemini):
    resumes and voice notes leave the deployment for processing. `AI_PROVIDER=none` turns
    the feature off.

**Operations**

14. **`JOBS_MODE=inline` swallows job errors** and runs no schedules, so approaches do not
    expire and imports are not purged; the production guard flags it.
15. **During a Redis outage rate limits are per task.**
16. **The API connects to Postgres as the RDS master user by default** until the operator
    creates the application role.
17. **No queue-depth alarm**: a stopped worker shows only as missing side effects (no
    expiries, no imports, images never shown).
