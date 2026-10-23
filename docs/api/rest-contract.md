# REST contract

The route table the API implements and the web app consumes. Response shapes are the
DTOs in [`packages/types/src/index.ts`](../../packages/types/src/index.ts),
[`talent.ts`](../../packages/types/src/talent.ts) and
[`admin.ts`](../../packages/types/src/admin.ts); this page names them. Request bodies are
the zod schemas in [`apps/api/src/controllers`](../../apps/api/src/controllers), which are
strict: an unknown field is a `400 VALIDATION_FAILED`, not silently dropped.

The generated reference is [`openapi.yaml`](openapi.yaml). It is produced by
[`scripts/gen-openapi.ts`](../../scripts/gen-openapi.ts) (`make openapi` or `pnpm openapi`;
`pnpm openapi --check` exits non-zero when it is stale), which reads the `MOUNTS` table in
[`apps/api/src/routes/index.ts`](../../apps/api/src/routes/index.ts) and every
`router.<method>(...)` line in the route files, so every endpoint and its auth guard come
from the source. Rate limits and bodies are not in the generated file; they are on this
page.

## Conventions

- Everything is under `/api` and speaks JSON. Authenticated calls send
  `Authorization: Bearer <accessToken>`. The access token is a short-lived JWT returned in
  the body of every sign-in and refresh (`AuthResult.expiresIn` seconds); the web app keeps
  it in memory only. The refresh token travels only in the httpOnly cookie `os_refresh`,
  scoped to `/api/auth` ([`auth.controller.ts`](../../apps/api/src/controllers/auth.controller.ts)).
- Every response carries `X-Request-Id` (a client value matching `^[\w-]{8,64}$` is kept,
  otherwise a new ULID). The same id is in every error body.
- Lists return `Page<T>` (`{ items, nextCursor }`). Pass `?cursor=<nextCursor>` until it is
  `null`. `?limit=` is 1 to 50; the default is 20 (25 in `/api/admin`). Cursors are opaque
  (keyset, never OFFSET) and no list returns a total count. A malformed cursor is
  `400 INVALID_CURSOR`.
- Errors return `ApiError` (`{ error, code, details?, requestId }`). Clients switch on `code`;
  `error` is human copy and may change. Validation failures are `400 VALIDATION_FAILED` with
  `details.fields: { path, message }[]`. Generic codes: `BAD_REQUEST`, `UNAUTHENTICATED`,
  `FORBIDDEN`, `NOT_FOUND`, `CONFLICT`, `UNPROCESSABLE`, `PAYLOAD_TOO_LARGE` (JSON bodies are
  capped at 1 MB), `RATE_LIMITED`, `INTERNAL` (no detail, only the request id).
- A non-GET request with a foreign `Origin` header is `403 CORS_ORIGIN_DENIED`.
- Identity always comes from the token. No body field names the acting user, recruiter or
  company.
- Writes need an ACTIVE account. A suspended user can read and appeal but not write:
  `403 ACCOUNT_RESTRICTED`.
- Media is never referenced by URL. Upload first (`/api/media/uploads`), then pass upload ids
  (`mediaIds`, `resumeUploadId`, `uploadId`, `evidenceUploadIds`, ...).
- Visibility: a block in either direction makes the other person's profile, content,
  jobs and approaches answer 404 (never 403, which would confirm they exist). A profile
  that is not PUBLISHED or UNLISTED is a 404 to everyone but its owner and staff.
- Contact details (email, phone, WhatsApp) appear in exactly two responses: the owner's
  `MyProfile` and a logged `ContactReveal`. No other DTO carries them
  ([privacy-and-contact-consent.md](../architecture/privacy-and-contact-consent.md)).

### Access levels used in the tables

| Level | Meaning |
| --- | --- |
| public | signed out works (`optionalAuth`); the answer depends on the viewer when signed in |
| user | any signed-in account (`authenticate`) |
| recruiter | an ACTIVE recruiter of a company that is not suspended (`requireRecruiter`, otherwise `403 RECRUITER_REQUIRED`) |
| company admin | a recruiter with team role OWNER or ADMIN (otherwise `403 NOT_COMPANY_ADMIN`) |
| staff | platform MODERATOR or ADMIN |
| area: x | an operator whose role may open `/admin` area x ([`domain/admin-permissions.ts`](../../apps/api/src/domain/admin-permissions.ts)); otherwise `403 FORBIDDEN_AREA` |

Rate limits are written as `name budget/window` and are keyed by user when signed in,
by IP otherwise (`ip` marks the ones always keyed by IP). Exceeding one is
`429 RATE_LIMITED`. Some services consume a second, named budget inside the call; those
are listed too.

## Health

| Method | Path | Access | Response |
| --- | --- | --- | --- |
| GET | `/up` | public | Liveness: the process is up |
| GET | `/api/ready` | public | Readiness: Postgres and Redis answer, otherwise 503 |

## Auth: `/api/auth`

| Method | Path | Access | Limit | Body | Response and notable codes |
| --- | --- | --- | --- | --- | --- |
| POST | `/signup` | public | `auth 10/60s ip` | `{ email, username, displayName, password }` | 201 `AuthResult`, or 202 `{ verificationRequired, email }` when `REQUIRE_EMAIL_VERIFICATION` is on. `409 EMAIL_TAKEN`, `USERNAME_TAKEN`, `USERNAME_RESERVED`, `400 WEAK_PASSWORD`, `DISPLAY_NAME_INVALID` (a name that is only an email or a phone number), `403 REGISTRATION_CLOSED` |
| POST | `/verify-email` | public | `auth 10/60s ip` | `{ token }` | `AuthResult`. `400 TOKEN_INVALID` |
| POST | `/resend-verification` | public | `auth-mail 5/h ip` | `{ email }` | 202, whether or not the account exists |
| POST | `/login` | public | `auth 10/60s ip` | `{ login, password, totp? \| recoveryCode? }` | `AuthResult`, or `{ totpRequired: true }`. `401 INVALID_CREDENTIALS`, `INVALID_TOTP`, `INVALID_RECOVERY_CODE`, `403 EMAIL_NOT_VERIFIED`, `ACCOUNT_BANNED`, `ACCOUNT_DEACTIVATED`. After 5 failures per account and IP in 15 minutes, or 50 per account in an hour, every attempt answers the same `429 RATE_LIMITED` (no lockout) |
| POST | `/refresh` | refresh cookie | `auth-refresh 60/60s ip` | | `AuthResult` and a rotated cookie. `401 SESSION_EXPIRED`; reusing a rotated token revokes the whole session family |
| POST | `/logout` | refresh cookie | | | 204 |
| POST | `/logout-all` | user | | | 204. Bumps `token_version`, disconnects every socket (`session:revoked` `SIGNED_OUT`) |
| POST | `/forgot-password` | public | `auth-mail 5/h ip` | `{ email }` | 202 |
| POST | `/reset-password` | public | `auth 10/60s ip` | `{ token, password }` | 204. Signs out every session |
| POST | `/change-password` | user | `auth 10/60s ip` | `{ currentPassword, newPassword }` | 204. Signs out every session and socket |
| GET | `/me` | user | | | `Me` |
| POST | `/totp/setup` | user | | | `{ secret, otpauthUrl }`. `409 TOTP_ALREADY_ENABLED` |
| POST | `/totp/enable` | user | `auth 10/60s ip` | `{ code }` | `{ recoveryCodes: string[] }` (ten single-use codes, shown once). `400 TOTP_NOT_STARTED`, `INVALID_TOTP` |
| POST | `/totp/disable` | user | `auth 10/60s ip` | `{ password, code }` or `{ password, recoveryCode }` | 204. `TOTP_NOT_ENABLED`, `INVALID_CREDENTIALS`, `INVALID_TOTP` |
| POST | `/totp/recovery-codes` | user | `auth 10/60s ip` | `{ password, code }` | `{ recoveryCodes }`, replacing every earlier code |

## Account and graph: `/api/users`

| Method | Path | Access | Limit | Body / query | Response and notable codes |
| --- | --- | --- | --- | --- | --- |
| GET | `/me` | user | | | `Me` (includes `recruiter`, `profileStatus`, `profileCompleteness`, `messageRequestPolicy`) |
| PATCH | `/me` | user | | `{ displayName?, avatarUploadId?, coverUploadId?, messageRequestPolicy?: ANYONE \| RECRUITERS \| NOBODY, emailDigest? }` | `Me`. `400 DISPLAY_NAME_INVALID` |
| DELETE | `/me` | user | `account-delete 5/h` | `{ password, totp? \| recoveryCode? }` | 204. Deactivates and anonymises the account (content stays as "Deleted user"; unlocks revoked, pending approaches and open applications closed). `409 OWNER_MUST_TRANSFER` (only OWNER of a company with other active members), `409 LAST_ADMIN`, `400 INVALID_CREDENTIALS`, `TOTP_REQUIRED`, `INVALID_TOTP` |
| GET | `/me/export` | user | `account-export 3/day` | | A JSON download of your own data, streamed in pages |
| GET | `/me/bookmarks` | user | | cursor | `Page<Post>` |
| GET | `/me/blocks` | user | | | `UserSummary[]` |
| GET | `/me/sessions` | user | | | `{ id, userAgent, ip, createdAt, lastUsedAt, current }[]` |
| DELETE | `/me/sessions/:id` | user | | | 204 |
| GET | `/:username/posts` | public | | cursor | `Page<Post>` |
| GET | `/:username/followers` | public | | cursor | `Page<FollowEntry>` |
| GET | `/:username/following` | public | | cursor | `Page<FollowEntry>` |
| POST | `/:id/follow` | user | `follows 60/60s` | | 204. `400 SELF_ACTION` |
| DELETE | `/:id/follow` | user | `follows 60/60s` | | 204 |
| POST | `/:id/block` | user | | | 204. In the same transaction: follows both ways and the connection end, live contact unlocks either way are revoked, pending approaches between the two become BLOCKED |
| DELETE | `/:id/block` | user | | | 204 |

## Talent profiles: `/api/profiles`

Every `me` route edits the caller's own profile. Edits are limited by `profile-edit 120/10min`.

| Method | Path | Access | Limit | Body / query | Response and notable codes |
| --- | --- | --- | --- | --- | --- |
| GET | `/me` | user | | | `MyProfile` (the owner's full view, including `contact`, `sectionVisibility`, `publishThreshold`, `missing`) |
| PATCH | `/me` | user | `profile-edit` | `{ headline?, about?, currentTitle?, currentCompany?, location?, countryCode?, timezone?, yearsExperience?, languages?, rate?: { min, max, currency, period } }` | `MyProfile`. `400 RATE_INVALID` |
| PUT | `/me/open-to-work` | user | `profile-edit` | `{ mode: OFF \| RECRUITERS \| PUBLIC, roles?, employmentTypes?, workplaceTypes?, availableFrom? }` | `MyProfile` |
| PUT | `/me/contact` | user | `profile-edit` | `{ email, phone, whatsapp }` (each nullable; phones in `+<digits>` international form) | `MyProfile`. Private: never in a `Profile` |
| PUT | `/me/visibility` | user | `profile-edit` | `{ experience?, education?, projects?, skills?, certifications?, links? }`, each `PUBLIC \| CONNECTIONS \| RECRUITERS` | `MyProfile` |
| PUT | `/me/cover` | user | `profile-edit` | `{ uploadId \| null }` | `MyProfile` |
| PUT | `/me/sections/:section` | user | `profile-edit` | `{ items: [...] }` for `experience` (max 30), `education` (15), `projects` (20), `skills` (50), `certifications` (30), `links` (15). Months are `YYYY-MM` | `MyProfile`. The whole list is replaced in order. `400 MONTH_INVALID`, `DATES_INVALID`, `URL_INVALID` (every URL goes through `safeUrl`) |
| POST | `/me/status` | user | | `{ status: PUBLISHED \| UNLISTED \| DRAFT }` | `MyProfile`. `422 PUBLISH_INCOMPLETE` (completeness below `settings.profile.publishThreshold`, `details: { completeness, threshold }`), `422 PUBLISH_NO_CONTACT` (no private contact channel), `403 PROFILE_SUSPENDED`. Nothing else ever publishes a profile ([ADR 0019](../architecture/adr/0019-explicit-publish.md)) |
| PUT | `/me/username` | user | `username-change 5/day` | `{ username }` | `MyProfile`. `409 USERNAME_INVALID`, `USERNAME_RESERVED`, `USERNAME_TAKEN` (with `details.suggestions`), `429 USERNAME_COOLDOWN` (`details.retryAt`). The old handle is kept in `username_history` |
| GET | `/username-check` | public | `username-check 60/60s ip` | `?u=` | `{ available, reason: INVALID \| RESERVED \| TAKEN \| null, suggestions }` |
| GET | `/me/analytics` | user | | | `ProfileAnalytics` |
| GET | `/me/contact-log` | user | | | `ContactAccessEntry[]`: every reveal of your details, by recruiter, company and channel |
| PATCH | `/me/badges/:badgeId` | user | | `{ visible }` | `MyProfile` |
| GET | `/me/resume.pdf`, `/me/resume.docx` | user | `resume-export 20/h` | | The file (`Content-Disposition: attachment`, `Cache-Control: no-store`), rendered in-process ([ADR 0018](../architecture/adr/0018-in-process-resume-export.md)) |
| POST | `/me/imports` | user | `profile-import <settings.import.perDay>/day` (in the service) | `{ text? (max 30000), uploadId? }` (an `IMPORT` upload) | 202 `ProfileImport` (QUEUED). `503 IMPORT_DISABLED`, `503 AI_UNAVAILABLE`, `400 IMPORT_EMPTY`, `IMPORT_TOO_SHORT`, `MEDIA_INVALID`, `MEDIA_NOT_READY` |
| GET | `/me/imports/latest` | user | | | `ProfileImport \| null` |
| GET | `/me/imports/:id` | user | | | `ProfileImport`. `404 IMPORT_NOT_FOUND` |
| POST | `/me/imports/:id/apply` | user | | `{ sections?: ProfileSection[], basics?: boolean, badges?: boolean }` | `ProfileImport` (APPLIED; raw input purged). `409 IMPORT_NOT_READY` |
| POST | `/me/polish` | user | `ai-polish 50/day` (in the service) | `{ field: headline \| about \| experience \| project, text }` | `{ text }`, a suggestion, never saved. `503 AI_UNAVAILABLE`, `502 AI_FAILED` |
| PUT | `/skills/:skillId/endorsement` | user | `endorse 120/h` | | `{ endorsementCount, endorsedByViewer }`. `403 NOT_CONNECTED` (only connections endorse), `400 SELF_ACTION` |
| DELETE | `/skills/:skillId/endorsement` | user | | | Same shape |
| GET | `/:username` | public | | | `Profile` for this viewer: sections outside the viewer's audience are emptied and listed in `hiddenSections`; `openToWork` only when the mode admits the viewer; `viewer.messaging` and, for an ACTIVE recruiter, `viewer.recruiter`. `404 PROFILE_NOT_FOUND`. **A renamed handle answers `301 PROFILE_MOVED` with `details.username`** (the current handle); the web app redirects `/in/<old>` to it |
| POST | `/:username/view` | public | `profile-view 120/60s ip` | | 204. Counted once per viewer per profile per day; signed-out viewers are keyed by an HMAC of the IP with `VIEW_HASH_SALT` |
| GET | `/:username/ratings` | public | | | `Rating[]`: revealed, not hidden ratings received |

## Network: `/api/network`

| Method | Path | Access | Limit | Body / query | Response and notable codes |
| --- | --- | --- | --- | --- | --- |
| POST | `/connections` | user | `connect 60/h`, plus a per-day budget in the service | `{ userId, note? (max 300) }` | `{ state: PENDING_OUTGOING \| CONNECTED, connectionId }`. Requesting someone who already requested you accepts theirs (one row per `pair_key`). `400 SELF_ACTION`, `404` across a block, `409 CONNECTION_RACE` |
| GET | `/connections` | user | | cursor | `Page<NetworkEntry>` |
| DELETE | `/connections/:userId` | user | | | 204 |
| GET | `/invitations` | user | | `direction=received \| sent`, cursor | `Page<NetworkEntry>` |
| POST | `/invitations/:id/accept` | user | | | 204 |
| POST | `/invitations/:id/ignore` | user | | | 204. Quiet: the requester still sees it as pending and cannot resend for a cooldown |
| DELETE | `/invitations/:id` | user | | | 204 (withdraw your own request) |
| GET | `/suggestions` | user | | | `NetworkEntry[]` |
| GET | `/mutual/:userId` | user | | | `NetworkEntry[]` |
| GET | `/of/:username` | public | | cursor | `Page<NetworkEntry>`: a visible person's connections |

## Companies: `/api/companies`

| Method | Path | Access | Limit | Body / query | Response and notable codes |
| --- | --- | --- | --- | --- | --- |
| GET | `/` | public | | `q?`, `industry?`, cursor | `Page<CompanySummary>` |
| GET | `/:slug` | public | | | `Company` (`manage` with domains and auto-approve only for company admins and staff). A SUSPENDED company is `404 COMPANY_NOT_FOUND` to everyone but staff, recruiter ops and its own team |
| PATCH | `/:slug` | company admin of this company | `company-edit 60/10min` | `{ name?, tagline?, about?, website?, industry?, sizeBand?, headquarters?, foundedYear?, logoUploadId?, coverUploadId?, domains?, autoApproveDomain? }` | `Company`. `403 NOT_COMPANY_ADMIN`, `400 URL_INVALID`. Verification itself is an operator action (`/api/admin/companies/:id`) |
| GET | `/:slug/team` | public | | | `TeamMember[]` (pending members only for company admins and operators) |
| PATCH | `/team/:recruiterId` | company admin | | `{ role: OWNER \| ADMIN \| RECRUITER }` | `TeamMember[]`. `403 OWNER_ONLY` (only an owner changes admins and owners), `409 LAST_OWNER` |
| DELETE | `/team/:recruiterId` | company admin | | | 204. `400 SELF_ACTION` (use `DELETE /api/recruiter/me`), `403 OWNER_ONLY` |
| PUT | `/:slug/follow` | user | `follows 60/60s` | | `Company` |
| DELETE | `/:slug/follow` | user | | | `Company` |
| GET | `/:slug/people` | public | | cursor | `Page<UserSummary>` |
| GET | `/:slug/jobs` | public | | `status?`, cursor | `Page<Job>` (DRAFT and moderated jobs for the team and staff only) |
| GET | `/:slug/posts` | public | | cursor | `Page<Post>` |

## Recruiter workspace: `/api/recruiter`

All routes need a signed-in account. Registration and verification are for anyone; the
workspace routes need an ACTIVE recruiter. The full flow is in
[recruiter-verification.md](../guides/recruiter-verification.md).

| Method | Path | Access | Limit | Body / query | Response and notable codes |
| --- | --- | --- | --- | --- | --- |
| POST | `/register` | user (ACTIVE) | `recruiter-register 10/day` | `{ companySlug? \| newCompany?: { name, website?, industry?, sizeBand?, headquarters? }, workEmail, title?, note? }` (exactly one of `companySlug`, `newCompany`) | 201 `RecruiterAccount` (EMAIL_PENDING; a six-digit code is emailed to the work email). `400 COMPANY_CHOICE`, `EMAIL_INVALID`, `URL_INVALID`, `404 COMPANY_NOT_FOUND`, `403 COMPANY_SUSPENDED`, `409 ALREADY_RECRUITER`, `WORK_EMAIL_TAKEN` |
| GET | `/me` | user | | | `RecruiterAccount` (any status, with `quota`). `404 NOT_A_RECRUITER` |
| PATCH | `/me` | user | | `{ title? }` | `RecruiterAccount` |
| POST | `/me/code` | user | `recruiter-code 5/h` | | 204, a new code (earlier ones stop working). `400 NOT_EMAIL_PENDING` |
| POST | `/me/verify` | user (ACTIVE) | `recruiter-verify 20/h` | `{ code }` (six digits) | `RecruiterAccount`, now PENDING_REVIEW or (domain auto-approval) ACTIVE. `400 CODE_WRONG` (`details.attemptsLeft`), `400 CODE_EXPIRED`, `429 CODE_LOCKED` (more than 5 attempts on one code), `400 NOT_EMAIL_PENDING` |
| DELETE | `/me` | user | | | 204. Leave the company: pending approaches withdrawn, live unlocks revoked, posted jobs reassigned to a teammate or closed. `409 OWNER_MUST_TRANSFER` |
| GET | `/saved` | recruiter | | cursor | `Page<TalentCard & { note, savedAt }>` |
| PUT | `/saved/:username` | recruiter | | `{ note? }` | 204 |
| DELETE | `/saved/:username` | recruiter | | | 204 |
| GET | `/searches` | recruiter | | | Saved searches |
| POST | `/searches` | recruiter | | `{ name, query: { q?, skills?, location?, openToWork?, employment?, workplace?, minYears?, maxYears?, sort? } }` | 201. `400 TOO_MANY_SEARCHES` (50) |
| DELETE | `/searches/:id` | recruiter | | | 204 |
| GET | `/notes/:candidateId` | recruiter | | | `CandidateNote[]`: the team's private notes, never shown to the candidate |
| POST | `/notes` | recruiter | `notes 200/h` | `{ applicationId? \| candidateId?, body, rating? (1 to 5) }` | 201 `CandidateNote`. `400 CANDIDATE_REQUIRED` |

## Approaches and contact consent: `/api/approaches`

The lifecycle and its guarantees are in
[privacy-and-contact-consent.md](../architecture/privacy-and-contact-consent.md) and
[ADR 0014](../architecture/adr/0014-consent-based-contact-unlock.md).

| Method | Path | Access | Limit | Body / query | Response and notable codes |
| --- | --- | --- | --- | --- | --- |
| POST | `/` | recruiter | `approach-send 60/h` | `{ username, roleTitle, message (30 to 3000), jobId?, employmentType?, salary? }` | 201 `Approach` (PENDING, expires after `settings.recruiter.approachExpiryDays`). `409 APPROACH_ALREADY_PENDING`, `409 APPROACH_COOLDOWN` (`details.cooldownUntil`, after a decline), `429 APPROACH_QUOTA` (daily quota; approaches the classifier flags do not count), `409 APPROACH_NOT_PUBLISHED` (also what a block reads as), `404 PROFILE_NOT_FOUND`, `400 JOB_NOT_SHAREABLE`, `SALARY_INVALID` |
| GET | `/received` | user | | `status?`, cursor | `Page<Approach>`: approaches to you (ones moderation flagged never appear) |
| GET | `/sent` | recruiter | | `status?`, cursor | `Page<Approach>` |
| GET | `/:id` | user (candidate or sending recruiter) | | | `Approach`. `404 APPROACH_NOT_FOUND` |
| POST | `/:id/viewed` | candidate | | | 204 (sets `viewedAt` once) |
| POST | `/:id/accept` | candidate (ACTIVE) | | `{ channels: (EMAIL \| PHONE \| WHATSAPP)[] }` (1 to 3) | `Approach` (ACCEPTED, `unlockedChannels`, `threadId` of a new APPROACH thread). `400 CHANNELS_REQUIRED`, `400 CHANNEL_NOT_SET` (`details.missing`: a channel you have not filled in), `409 APPROACH_NOT_PENDING`, `409 APPROACH_EXPIRED` |
| POST | `/:id/decline` | candidate | | `{ reason? }` | `Approach` (DECLINED; the cooldown starts). `409 APPROACH_NOT_PENDING` |
| POST | `/:id/block` | candidate | | | 204. Marks it BLOCKED and blocks the recruiter |
| POST | `/:id/revoke` | candidate | | | `Approach` (`unlockRevoked: true`; the thread stays, the reveal stops working). `409 NOTHING_SHARED` |
| POST | `/:id/withdraw` | sending recruiter | | | `Approach` (WITHDRAWN). `409 APPROACH_NOT_PENDING` |
| GET | `/:id/contact` | sending recruiter | `contact-reveal 120/h` | | `ContactReveal` with only the shared channels (`whatsappLink` as `https://wa.me/<digits>`), `Cache-Control: no-store`. Every channel returned writes a `contact_access_log` row the candidate sees. `403 CONTACT_NOT_SHARED` (not accepted, revoked, or a block) |

## Jobs: `/api/jobs`

| Method | Path | Access | Limit | Body / query | Response and notable codes |
| --- | --- | --- | --- | --- | --- |
| GET | `/` | public | `job-search 120/60s ip` | `q?`, `location?`, `workplace?`, `employment?`, `seniority?` (comma lists), `skills?` (comma list, up to 10), `company?` (slug), `salaryMin?`, `postedWithinDays?` (1 to 90), `sort=recent \| relevance`, cursor | `Page<Job>` (OPEN, PUBLISHED jobs of companies that are not suspended) |
| GET | `/recommended` | user | | | `Job[]`: open jobs sharing a skill with your profile or matching an open-to-work role, excluding ones you applied to |
| GET | `/saved` | user | | cursor | `Page<Job>` |
| GET | `/invites` | user | | | `JobInvite[]` |
| POST | `/invites/:id/respond` | user | | `{ response: VIEWED \| INTERESTED \| DECLINED }` | `{ jobId }` |
| POST | `/` | recruiter | `job-create 30/day` | `{ title, description (30 to 12000), employmentType, workplaceType, seniority?, location?, countryCode?, salary?, skills? (30), openings?, screeningQuestions? (10: { prompt, kind: TEXT \| YES_NO, required }), closesAt?, publish? }` | 201 `Job` (DRAFT, or OPEN with `publish: true`). `409 JOB_CAP_REACHED` (`settings.recruiter.maxOpenJobsPerCompany`), `400 TOO_MANY_QUESTIONS`, `SALARY_INVALID` |
| GET | `/:id` | public | | | `Job` (with `viewer.application`, `viewer.matchScore`, `viewer.canManage`). `404 JOB_NOT_FOUND` for drafts and moderated jobs outside the team |
| PATCH | `/:id` | recruiter of the job's company | | any field of the create body | `Job`. `403 JOB_REMOVED`. Editing an OPEN job's text re-runs moderation |
| POST | `/:id/status` | recruiter of the job's company | | `{ status: OPEN \| CLOSED \| FILLED }` | `Job`. `409 JOB_CAP_REACHED` (checked on every move to OPEN), `403 JOB_UNDER_REVIEW`, `400 JOB_STATUS_INVALID` |
| PUT | `/:id/save` | user | | | 204 |
| DELETE | `/:id/save` | user | | | 204 |
| POST | `/:id/invites` | recruiter of the job's company | `job-invite 100/day` | `{ username, message? }` | 204. `400 JOB_NOT_OPEN`, `404 PROFILE_NOT_FOUND` (unpublished or blocked), `409 ALREADY_APPLIED`, `ALREADY_INVITED` |
| POST | `/:id/apply` | user (ACTIVE) | `apply 50/day` | `{ coverNote?, answers?: { questionId, answer }[], resumeUploadId? }` (a `RESUME` upload) | 201 `MyApplication`. Easy Apply stores a snapshot of your profile and a skill match score. `409 JOB_NOT_OPEN` (closed or past `closesAt`), `409 ALREADY_APPLIED`, `422 ANSWERS_INVALID` (`details.problems`: `MISSING`, `NOT_YES_NO`, `TOO_LONG`, `UNKNOWN_QUESTION`), `400 OWN_COMPANY`, `MEDIA_INVALID`, `MEDIA_IN_USE` |
| GET | `/:id/pipeline` | recruiter of the job's company | | | `PipelineColumn[]`: every stage with its count and the 30 most recently moved cards |
| GET | `/:id/pipeline/:stage` | recruiter of the job's company | | cursor | `Page<Application>` for one stage |

## Applications: `/api/applications`

Stage rules are `canMoveStage` in [`domain/pipeline.ts`](../../apps/api/src/domain/pipeline.ts);
see [hiring-pipeline.md](../architecture/hiring-pipeline.md).

| Method | Path | Access | Limit | Body / query | Response and notable codes |
| --- | --- | --- | --- | --- | --- |
| GET | `/mine` | user | | `open=true \| false`, cursor | `Page<MyApplication>` (stage and timeline only; team notes never appear) |
| POST | `/bulk-move` | recruiter | `pipeline-move 600/h` | `{ ids (1 to 100), to, reason?, note? }` | `Application[]`. All or nothing. `400 TOO_MANY` |
| GET | `/:id` | recruiter of the company | | | `Application` (team view) |
| POST | `/:id/withdraw` | the candidate | | | `MyApplication` (WITHDRAWN). `409 STAGE_FINAL`, `STAGE_NOT_ALLOWED`, `APPLICATION_CHANGED` |
| POST | `/:id/move` | recruiter of the company | `pipeline-move 600/h` | `{ to, reason?, note? }` | `Application`. `409 SAME_STAGE`, `STAGE_FINAL` (from HIRED or WITHDRAWN), `STAGE_NOT_ALLOWED`, `REASON_REQUIRED` (moving to REJECTED), `APPLICATION_CHANGED` (a teammate moved the card first: the update is conditional on the stage it was read in) |
| POST | `/:id/thread` | the candidate or a recruiter of the company | | | `{ threadId }`: finds or opens the APPLICATION conversation. `409 APPLICATION_WITHDRAWN` |

## Trust: `/api/trust`

| Method | Path | Access | Limit | Body | Response and notable codes |
| --- | --- | --- | --- | --- | --- |
| GET | `/engagements` | user | | | `Engagement[]` you are part of |
| POST | `/engagements` | user | `engagement 30/day` | `{ approachId? \| applicationId?, title }` | 201 `Engagement` (PROPOSED). From an ACCEPTED approach (either side) or a HIRED application (the hiring team). `400 SOURCE_REQUIRED`, `409 APPROACH_NOT_ACCEPTED`, `NOT_HIRED`, `ENGAGEMENT_EXISTS`, `403 NOT_HIRING_TEAM` |
| POST | `/engagements/:id/confirm` | a side | | | `Engagement`; ACTIVE once both sides confirmed. `409 ENGAGEMENT_STATE` |
| POST | `/engagements/:id/cancel` | a side | | | `Engagement` (only while PROPOSED) |
| POST | `/engagements/:id/complete` | a side | | | `Engagement`; the other side confirms (or the housekeeping job completes it after `trust.autoConfirmDays`) |
| POST | `/engagements/:id/dispute` | the other side | | | `Engagement` (DISPUTED) |
| POST | `/engagements/:id/rating` | a side | | `{ score (1 to 5), subScores?: { communication, quality, reliability, professionalism }, comment? }` | `Engagement`. Hidden until both sides rated or the window closes. `409 ENGAGEMENT_NOT_COMPLETE`, `RATING_WINDOW_CLOSED`, `RATING_REVEALED` (never editable after reveal), `RATING_ALREADY_EDITED` (one edit before reveal) |
| POST | `/complaints` | user | `complaints 5/day`, plus `settings.trust.complaintsPer30Days` | `{ againstUsername, category, description (20 to 3000), engagementId? \| approachId? \| applicationId?, evidenceUploadIds? }` | 201 `{ id }`. `400 CONTEXT_REQUIRED`, `404 NO_RELATIONSHIP` (the named dealing is not between you two), `409 COMPLAINT_EXISTS`, `429 COMPLAINT_LIMIT` |
| GET | `/complaints` | user | | | `Complaint[]` you filed |

## Search: `/api/search`

| Method | Path | Access | Limit | Query | Response |
| --- | --- | --- | --- | --- | --- |
| GET | `/people` | public | `search 90/60s ip` | `q?`, `skills?` (comma list), `location?`, `openToWork=true`, `employment?`, `workplace?`, `minYears?`, `maxYears?`, `sort=relevance \| recent \| experience`, cursor | `Page<TalentCard>`: PUBLISHED profiles of ACTIVE accounts, minus blocks. The open-to-work filter matches RECRUITERS-mode profiles only for an ACTIVE recruiter |
| GET | `/facets` | public | | | `DirectoryFacets` (cached 5 minutes) |
| GET | `/` | public | `search 90/60s ip` | `q` | `SearchResults` (`people`, `jobs`, `companies`) |

## Posts: `/api/posts`

| Method | Path | Access | Limit | Body / query | Response and notable codes |
| --- | --- | --- | --- | --- | --- |
| GET | `/feed` | user | | `sort=latest \| top`, cursor | `Page<Post> & { suggestedIds }`: your network, topped up with suggested public posts |
| POST | `/` | user | `posts 10/60s` | `{ body, kind?: POST \| HIRING \| OPEN_TO_WORK \| JOB \| MILESTONE, visibility?: PUBLIC \| CONNECTIONS, companyId?, jobId?, mediaIds?, sharedPostId? }` | 201 `Post`. `400 EMPTY_POST`, `JOB_REQUIRED`, `JOB_KIND_MISMATCH`, `JOB_NOT_SHAREABLE`, `SHARE_NOT_ALLOWED` (only PUBLIC originals are reposted), `403 NOT_COMPANY_ADMIN` (posting as a company). A held post (pre-moderation) is created `PENDING_REVIEW` |
| GET | `/:id` | public | | | `Post` |
| PATCH | `/:id` | author | `posts 10/60s` | `{ body?, visibility? }` | `Post`. `403 NOT_AUTHOR`, `POST_UNDER_REVIEW` |
| DELETE | `/:id` | author, or staff | | | 204 |
| PUT | `/:id/reaction` | user | `reactions 120/60s` | `{ type }` | `{ reaction, reactionCount, reactionCounts }` |
| DELETE | `/:id/reaction` | user | `reactions 120/60s` | | same |
| GET | `/:id/reactions` | public | | `type?`, cursor | `Page<{ user, type }>` |
| POST | `/:id/bookmark`, DELETE same | user | | | 204 |
| POST | `/:id/hide` | user | | | 204 ("not interested", your feed only) |
| GET | `/:id/comments` | public | | cursor | `Page<Comment>` (oldest first) |
| POST | `/:id/comments` | user | `comments 30/60s` | `{ body, parentId?, mediaId? }` | 201 `Comment`. `400 EMPTY_COMMENT` |

## Comments: `/api/comments`

| Method | Path | Access | Limit | Body | Response |
| --- | --- | --- | --- | --- | --- |
| GET | `/:id/replies` | public | | cursor | `Page<Comment>` |
| PATCH | `/:id` | author | `comments 30/60s` | `{ body }` | `Comment`. `403 NOT_AUTHOR` |
| DELETE | `/:id` | author, the post's author, or staff | | | 204 |
| PUT | `/:id/reaction`, DELETE same | user | `reactions 120/60s` | `{ type }` | reaction state |

## Messaging: `/api/dms`

All routes need a signed-in account. Who may start a conversation is `canMessage` in
[`domain/can-message.ts`](../../apps/api/src/domain/can-message.ts) ([ADR 0006](../architecture/adr/0006-can-message-rule.md));
who may send into one is [`domain/dm-send.ts`](../../apps/api/src/domain/dm-send.ts).

| Method | Path | Limit | Body / query | Response and notable codes |
| --- | --- | --- | --- | --- |
| GET | `/threads` | | `folder=inbox \| requests \| archived`, cursor | `Page<Thread>` |
| POST | `/threads` | `dm-request <settings.messaging.requestsPerDay>/day` when it becomes a request (in the service) | `{ userId }` | `Thread` (find or create the 1:1 thread). `403 DM_NOT_ALLOWED` with `details.reason` (`SELF`, `BLOCKED`, `NOT_CONNECTED`, `RECIPIENT_UNAVAILABLE`, `RECIPIENT_CLOSED_REQUESTS`, `SENDER_RESTRICTED`) |
| GET | `/threads/:id` | | | `Thread`. `404 THREAD_NOT_FOUND` |
| PATCH | `/threads/:id` | | `{ mutedUntil?, archived? }` | `Thread` |
| GET | `/threads/:id/messages` | | cursor | `Page<Message>` |
| POST | `/threads/:id/messages` | `dm-send 30/60s`, and 600/h in the service | `{ body?, replyToId?, mediaIds? }` | 201 `Message`. `403 DM_NOT_ALLOWED`, `403 DM_REQUEST_PENDING` (a request is capped at `settings.messaging.requestMessageCap` messages until accepted), `400 MESSAGE_EMPTY`, `MESSAGE_TOO_LONG`, `TOO_MANY_ATTACHMENTS`, `REPLY_INVALID` |
| POST | `/threads/:id/read` | | | 204 |
| POST | `/threads/:id/accept` | | | `Thread`. `400 NOT_REQUESTED` |
| POST | `/threads/:id/decline` | | | 204 |
| GET | `/threads/:id/media` | | cursor | `Page<Media>` |
| GET | `/threads/:id/search` | | `q` | `Message[]` |
| PATCH | `/messages/:id` | | `{ body }` | `Message`. `400 MESSAGE_DELETED`, `MESSAGE_EMPTY` |
| DELETE | `/messages/:id` | | | 204 |
| PUT | `/messages/:id/reactions/:emoji`, DELETE same | | | `Message`. `400 MESSAGE_NOT_REACTABLE` |
| GET | `/unread` | | | `{ inbox, requests }` |
| GET | `/eligibility/:userId` | | | `MessagingEligibility` |
| GET | `/contacts` | | | `{ user, online, lastSeenAt }[]` |

## Media: `/api/media`

See [media.md](../architecture/media.md).

| Method | Path | Access | Limit | Body | Response and notable codes |
| --- | --- | --- | --- | --- | --- |
| POST | `/uploads` | user | `media-create 60/10min` | `{ purpose, fileName, mimeType, sizeBytes }` (`purpose`: POST, COMMENT, DM, AVATAR, COVER, COMPANY_LOGO, COMPANY_COVER, PROJECT_COVER, RESUME, IMPORT, EVIDENCE) | 201 `{ uploadId, put }` (a presigned PUT bound to the type and exact length). `400 MEDIA_TYPE_NOT_ALLOWED`, `MEDIA_EXTENSION_MISMATCH`, `MEDIA_PURPOSE_MISMATCH`, `MEDIA_EMPTY`, `413 MEDIA_TOO_LARGE` |
| POST | `/uploads/:id/complete` | owner | | | `Media`. The stored object is checked: `400 UPLOAD_MISSING`, `MEDIA_SIZE_MISMATCH`, `MEDIA_TYPE_MISMATCH` (magic bytes), `MEDIA_REJECTED` |
| DELETE | `/uploads/:id` | owner | | | 204. `409 MEDIA_IN_USE` |
| PUT | `/local/:token` | signed token | | raw bytes | 204. Local storage only (`STORAGE=local`); `403 UPLOAD_LINK_INVALID`, `UPLOAD_LINK_MISMATCH` |
| GET | `/local/:token` | signed token | | | The bytes. Local storage only; `403 MEDIA_LINK_INVALID` |
| GET | `/:id` | public | | | `Media` when the viewer may see what it is attached to. Import files and complaint evidence: owner and staff only |

## Notifications: `/api/notifications`

| Method | Path | Access | Query | Response |
| --- | --- | --- | --- | --- |
| GET | `/` | user | `unread=true`, cursor | `Page<Notification>` (`href` is a web path) |
| GET | `/unread-count` | user | | `{ unread }` |
| GET | `/counts` | user | | `NotificationCounts` (`notifications`, `messages`, `messageRequests`, `connectionRequests`) |
| POST | `/read-all` | user | | 204 |
| POST | `/:id/read` | user | | 204 |

## Reports: `/api/reports`

| Method | Path | Access | Limit | Body | Response and notable codes |
| --- | --- | --- | --- | --- | --- |
| POST | `/` | user | `reports 20/h` | `{ targetType: POST \| COMMENT \| DM_MESSAGE \| USER \| PROFILE \| COMPANY \| JOB \| APPROACH, targetId, reason, details? }` | 201 `{ id }`. `404 TARGET_NOT_FOUND` (also for anything the reporter cannot see), `409 ALREADY_REPORTED`, `400 CANNOT_REPORT_SELF` |

## Moderation: `/api/moderation`

All routes need a signed-in account. See [moderation.md](../architecture/moderation.md).

| Method | Path | Access | Limit | Body / query | Response and notable codes |
| --- | --- | --- | --- | --- | --- |
| GET | `/cases` | staff | | `status?`, `source?: AI \| REPORT \| PREMODERATION`, `targetType?`, cursor | `Page<ModerationCase>` (priority first) |
| GET | `/cases/:id` | staff, or the subject (author view) | | | `ModerationCase`. `404 CASE_NOT_FOUND` |
| POST | `/cases/:id/actions` | staff (BAN, UNBAN: admin) | | `{ action, reason?, suspendDays? }` | `ModerationCase`. `403 STAFF_ONLY`, `SELF_MODERATION`, `TARGET_PROTECTED`, `400 CANNOT_MODERATE_SELF`, `SUSPEND_DAYS_REQUIRED`, `INVALID_ACTION`, `409 CASE_RESOLVED`, `INVALID_TRANSITION` |
| POST | `/cases/:id/assign` | staff | | `{ userId \| null }` | `ModerationCase`. `400 ASSIGNEE_NOT_STAFF` |
| POST | `/cases/:id/appeal` | the subject (suspended accounts too) | `appeals 10/h` | `{ statement (10 to 2000) }` | 201 `Appeal`. `409 ALREADY_APPEALED`, `400 NOT_APPEALABLE`, `APPEAL_WINDOW_CLOSED` (30 days) |
| GET | `/history` | staff | | `targetType`, `targetId` | `ModerationActionRecord[]` |
| GET | `/me` | user | | cursor | `Page<ModerationCase>` about you (author view: no raw scores, no moderator, never reporters) |
| GET | `/appeals` | staff | | `status?`, cursor | `Page<Appeal>` |
| POST | `/appeals/:id/decide` | staff | | `{ status: UPHELD \| OVERTURNED, note? }` | `Appeal`. `409 APPEAL_DECIDED`, `APPEAL_CONFLICT`, `403 SELF_MODERATION` |
| GET | `/stats` | staff | | | `ModerationStats` |

## Administration: `/api/admin`

Every route needs a signed-in account; every service function starts with
`requireArea(actor, area)`. ADMIN opens every area; MODERATOR opens overview, moderation,
people, jobs and complaints; RECRUITER_OPS opens overview, recruiters, companies and jobs.
Every change writes an `audit_log` row with the operator's id.

| Method | Path | Area | Body / query | Response and notable codes |
| --- | --- | --- | --- | --- |
| GET | `/me` | any signed-in | | `{ role, areas: AdminPermissions }`, so the web app shows only the areas the operator can open |
| GET | `/settings` | settings | | `PlatformSettings` |
| PATCH | `/settings` | settings | a partial `PlatformSettings` (strict; thresholds need `review <= hide`) | `PlatformSettings` |
| GET | `/stats` | overview | `from?`, `to?` (dates) | `AdminStats`. `400 RANGE_INVALID`, `RANGE_TOO_LONG` (over a year) |
| GET | `/stats.csv` | overview | same | CSV of the daily series |
| GET | `/users` | people | `q?`, `status?`, `role?`, cursor | `Page<AdminUserRow>` |
| PATCH | `/users/:id` | settings | `{ role }` | `AdminUserRow`. `403 CANNOT_CHANGE_OWN_ROLE`, `409 LAST_ADMIN` |
| POST | `/users/:id/warn` | people | `{ reason }` | `AdminUserRow` |
| POST | `/users/:id/suspend` | people | `{ days (1 to 3650), reason }` | `AdminUserRow`. `409 ALREADY_BANNED` |
| POST | `/users/:id/unsuspend` | people | | `AdminUserRow`. `409 NOT_SUSPENDED` |
| POST | `/users/:id/ban` | people (and the platform ADMIN role) | `{ reason }` | `AdminUserRow`. `403 STAFF_ONLY` for non-admins |
| POST | `/users/:id/unban` | people (ADMIN role) | | `AdminUserRow`. `409 NOT_BANNED` |
| POST | `/users/:id/profile/suspend` | people | `{ reason }` | `AdminUserRow`. `409 ALREADY_SUSPENDED` |
| POST | `/users/:id/profile/restore` | people | | `AdminUserRow` (the profile returns UNLISTED, so its owner republishes deliberately). `409 NOT_SUSPENDED` |
| POST | `/users/:id/badges` | people | `{ label, rationale? }` | 201 `{ id }` (a VERIFICATION badge, source ADMIN) |
| DELETE | `/badges/:id` | people | | 204 |
| POST | `/users/:id/erase` | settings | `{ reason }` | 204. Anonymises the account. `400 SELF_ACTION`, `403 TARGET_PROTECTED` (demote admins first) |
| GET | `/recruiters` | recruiters | `status?` (default PENDING_REVIEW, oldest first), `q?`, cursor | `Page<AdminRecruiterRow>` (with `domainMatches`, `freeMail`, `applicationNote`) |
| POST | `/recruiters/:id/review` | recruiters | `{ decision: APPROVE \| REJECT, note? }` | 204. `400 NOTE_REQUIRED` (rejecting), `403 SELF_REVIEW`, `409 NOT_PENDING_REVIEW` |
| POST | `/recruiters/:id/suspend` | recruiters | `{ reason }` | 204. Pending approaches withdrawn, every live unlock revoked. `409 ALREADY_SUSPENDED` |
| POST | `/recruiters/:id/reinstate` | recruiters | | 204. `409 NOT_REINSTATABLE` |
| PUT | `/recruiters/:id/quota` | recruiters | `{ quota: 0 to 1000 \| null }` (null = platform default) | 204 |
| GET | `/companies` | companies | `status?`, `q?` (name, slug or a domain), cursor | `Page<AdminCompanyRow>` |
| PATCH | `/companies/:id` | companies | `{ status?: VERIFIED \| UNVERIFIED \| SUSPENDED, reason?, domains?, autoApproveDomain? }` | `AdminCompanyRow`. Suspending withdraws the company's pending approaches and closes its open jobs. `400 REASON_REQUIRED` |
| GET | `/jobs` | jobs | `status?`, `q?`, cursor | `Page<Job>` |
| POST | `/jobs/:id/close` | jobs | `{ reason }` | 204. `409 JOB_NOT_OPEN` |
| GET | `/complaints` | complaints | `status?`, cursor | `Page<AdminComplaintRow>` (with `priorComplaintsAgainst`) |
| POST | `/complaints/:id/resolve` | complaints | `{ status: UNDER_REVIEW \| ACTION_TAKEN \| DISMISSED, note?, action?: { kind: WARN \| SUSPEND, days? } }` | 204. Both sides are notified on a final status. `400 NOTE_REQUIRED`, `403 SELF_REVIEW`, `409 COMPLAINT_RESOLVED` |
| POST | `/ratings/:id/hide` | complaints | `{ reason }` | 204. The ratee's average is recomputed |
| GET | `/audit` | audit | `action?`, `actorId?`, `entityType?`, `entityId?`, cursor | `Page<AuditEntry>` |

## Meta: `/api/meta`

| Method | Path | Access | Response |
| --- | --- | --- | --- |
| GET | `/` | public | `NetworkMeta`: `networkName`, `registration`, `ai: { import, polish }` (false when `AI_PROVIDER=none` or no usable key, so the web app hides the import wizard and polish buttons). Cached 30 seconds |

## Socket handshake

The Socket.IO gateway is on `/socket.io` on the API origin. The client sends the access
token in `handshake.auth.token`; it is checked by the same function as HTTP. A refused
connection gets `connect_error` with the code as its message: `MISSING`, `INVALID`,
`BANNED`, `DEACTIVATED`, or `TOO_MANY_CONNECTIONS` (over 20 live sockets per user).
Clients never join rooms by name: they ask (`thread:subscribe`, `job:subscribe`,
`post:subscribe`) and the server applies the REST rule, answering `RATE_LIMITED` past 30
requests per socket per 10 seconds. Events, rooms and presence are in
[realtime.md](../architecture/realtime.md); the typed maps are `ServerToClientEvents` and
`ClientToServerEvents` in [`packages/types/src/index.ts`](../../packages/types/src/index.ts).
