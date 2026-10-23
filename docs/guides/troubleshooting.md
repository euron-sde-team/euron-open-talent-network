# Troubleshooting

Problems people actually hit, grouped by where they show up. For the local stack, start with
`make ps` and `make logs SERVICE=<name>`.

## Local stack

### A port is already in use

`make up` fails with `bind: address already in use`. Every host port is configurable in
`deploy/compose/.env` (or your shell): `TALENT_WEB_PORT` (3520), `TALENT_API_PORT` (5016),
`TALENT_PG_PORT` (5482), `TALENT_REDIS_PORT` (6419), `TALENT_MAILPIT_PORT` (8036),
`TALENT_SMTP_PORT` (1036), `TALENT_FLOCI_PORT` (4587), `TALENT_STUB_PORT` (5109, the AI stub). If you change
`TALENT_WEB_PORT`, run `make down` first: the bucket CORS rule and the API's origins are derived
from it when the stack is provisioned. The test scripts read the same variables.

### `BucketAlreadyExists` from the `terraform` one-shot

Seen after a `make up` that was interrupted (Ctrl-C, a laptop sleeping) while the `terraform`
container was applying. The emulator keeps its data in the `flocidata` volume, and Terraform
keeps its state in the separate `tfdata` volume
([`compose.floci.yaml`](../../deploy/compose/compose.floci.yaml)). An interrupted apply can leave
the bucket created in Floci but missing from the state, so the next apply tries to create it
again. Reset both together:

```bash
make down    # removes flocidata and tfdata (and the database and media volumes)
make up
```

`make logs SERVICE=terraform` shows the apply output.

### `run make env first`

Compose refuses to start because `TALENT_JWT_SECRET`, `TALENT_REFRESH_SECRET`,
`TALENT_TOTP_ENCRYPTION_KEY` or `TALENT_VIEW_HASH_SALT` is unset. Run `make env` (or `make up`,
which runs it). It never overwrites a value; on an older `deploy/compose/.env` it only adds the
missing keys. Delete the file to regenerate everything.

### Stale `.terraform` directories

`make tf-validate`, `make tf-lint` or a local `terraform` fails with errors about missing or
mismatched providers, or broken symlinks under `.terraform/providers`. Each environment has a
git-ignored `infra/terraform/envs/<env>/.terraform` directory. When there is no local
`terraform`, the Makefile runs the pinned container, which installs Linux provider binaries
there; a later local (for example macOS) `terraform`, or a run with a plugin cache directory
that does not exist at the same path, then finds providers or symlinks it cannot use. Delete
the directory and initialise again:

```bash
rm -rf infra/terraform/envs/*/.terraform
make tf-validate
```

The local stack's own Terraform is not affected: the `terraform` one-shot uses
`TF_DATA_DIR=/tfdata`, not the directory in the source tree.

### Which database does it connect to without `DATABASE_URL`?

Running the API or `pnpm db:migrate` outside compose without `DATABASE_URL` (and without
`DATABASE_SECRET_ARN`) connects to the compose Postgres,
`postgres://talent:talent@localhost:5482/talent`
([`connection-config.ts`](../../apps/api/src/db/connection-config.ts)). Set `DATABASE_URL` to
use anything else.

## Media

### Presigned upload fails with `BadDigest` (or a checksum error)

AWS SDK v3 adds a CRC32 checksum of the body to presigned PUT URLs by default. The browser then
uploads the real file and S3 rejects it with `BadDigest`. The API's S3 clients are created with
`requestChecksumCalculation: "WHEN_REQUIRED"`
([`integrations/storage.ts`](../../apps/api/src/integrations/storage.ts)), which turns this off.
If you write another S3 client that presigns uploads, set the same option.

### Upload blocked by CORS, or images do not display

- The bucket CORS rule must list the web origin. Locally the `terraform` one-shot sets
  `http://localhost:<TALENT_WEB_PORT>`; on AWS it is the app URL plus
  `media_cors_extra_origins`.
- The web Content-Security-Policy must allow the storage origin: `MEDIA_ORIGINS`
  (`http://localhost:4587` locally, the bucket's virtual-hosted origin on AWS). A CSP violation in
  the browser console names the missing origin.
- Presigned GET URLs expire after `SIGNED_URL_TTL_SECONDS` (15 minutes). A tab left open shows
  broken images until the page refetches.

### `MEDIA_TYPE_MISMATCH` or `MEDIA_SIZE_MISMATCH` on complete

The API checks what landed in storage: the size must equal the declared `sizeBytes`, and the
first bytes must match the declared type. A renamed file (a PNG uploaded as `.jpg`) fails the
sniff. See [media.md](../architecture/media.md).

## Realtime

### WebSocket does not connect behind a proxy

Socket.IO lives at `/socket.io` on the same origin as the web app. Through any proxy:

- route `/socket.io/*` to the API (not to Next) and pass the `Upgrade` and `Connection`
  headers; otherwise the client falls back to HTTP long-polling;
- keep the idle timeout above Socket.IO's 25 second ping interval (the ALB uses 120 s,
  CloudFront an origin read timeout of 60 s);
- with more than one API task, keep load balancer stickiness on: a long-polling session must
  stay on the task that opened it until it upgrades.

The client tries WebSocket first and polling second
([`packages/api-client/src/socket.ts`](../../packages/api-client/src/socket.ts)).

### Socket connects then drops with `INVALID` or `MISSING`

The handshake carries the in-memory access token (`auth.token`). After 15 minutes the token
expires; the client must refresh and reconnect (`reconnectWithFreshToken`). A
`session:revoked` event before a disconnect means a ban, a suspension or a sign-out everywhere.

## Sign-in and sessions

### `403 CORS_ORIGIN_DENIED`

Every non-GET request that carries an `Origin` header outside `CORS_ORIGINS` (or `APP_WEB_URL`
when `CORS_ORIGINS` is empty) is refused ([`app.ts`](../../apps/api/src/app.ts)). Check that the
browser's origin, including scheme and port, is listed exactly.

### Signed out on every page load, or a refresh loop

- The refresh cookie `os_refresh` is `Secure` when `COOKIE_SECURE=true` (or `auto` with an
  `https` `APP_WEB_URL`). Over plain HTTP the browser drops it, so every refresh returns 401.
  Locally the compose file sets `COOKIE_SECURE=false`.
- The cookie is scoped to `/api/auth` on the API's origin. If the browser calls the API on a
  different site than the page, `SameSite=Lax` keeps the cookie off cross-site requests; serve
  the API on the same origin (the default) as the web app does.
- Presenting a refresh token that was already rotated more than 10 seconds ago revokes the
  whole session family (reuse detection). Two clients sharing one session can trigger this.

### Sign-in answers `429 RATE_LIMITED`

Accounts are never locked. Failed sign-ins (wrong password, wrong TOTP or recovery code, unknown
account) are throttled in Redis: 5 failures per account and IP in 15 minutes, and 50 per account
per hour across all IPs. Once either budget is spent every attempt gets the same
`429 RATE_LIMITED`, even with the right password, whether or not the account exists. Wait for the
window to pass, or sign in from another network (the per-IP budget is separate). A successful
sign-in clears the per-IP count. The route also has its own `auth` limit of 10 requests per minute
per IP.

### No verification or reset email

See [Mail](#mail).

## Mail

- **Recruiter work-email code not arriving.** The code is sent directly, not through a queue
  (so it never sits in Redis), to the work email given at registration. Locally it lands in
  Mailpit at <http://localhost:8036> like every other message; the demo and test addresses are
  on `.example` domains, which only Mailpit receives. On AWS the SES points below apply,
  including the sandbox. `POST /api/recruiter/me/code` sends a new one (5 per hour) and
  invalidates the previous code. See [Recruiters](#recruiters).
- **Locally**, every message lands in Mailpit at <http://localhost:8036>, relayed by the
  emulator's SES. Empty? `make logs SERVICE=api` shows `mail` errors.
- **`MAIL_MODE=outbox`** sends nothing: messages are written to `DATA_DIR/outbox/*.eml` (in the
  container, `/tmp/data` or the mounted `/app/data`). This is the default when `MAIL_MODE` is
  unset. On AWS every task that sends mail (api, worker, and the `admin` bootstrap task) gets
  `MAIL_MODE=ses` from Terraform ([deploy-aws.md](deploy-aws.md)).
- **No set-password link after `make aws-admin`**: the admin task sends it through SES like any
  other mail, so the sandbox, suppression and identity points below apply. Its log group
  `/open-talent/<name_prefix>/admin` shows the send error, if any.
- **SES sandbox**: a new account delivers only to verified addresses. Request production access.
- **Suppression list**: the configuration set suppresses addresses that bounced or complained.
  A user who once bounced gets nothing until removed from the account-level suppression list.
- **`MAIL_FROM`** must be an address on the verified identity (`mail_domain`). With
  `make up-aws` it comes from `.env.aws` (required there); an exported `MAIL_FROM` in your
  shell would win over the file ([local-with-aws.md](local-with-aws.md)).
- Mail failures never fail the request that caused them, so a sign-up succeeds even when the
  verification email did not go out. Use "resend verification".

## Talent pages

### Publishing answers `422 PUBLISH_INCOMPLETE`, `PUBLISH_NO_CONTACT` or `403 PROFILE_SUSPENDED`

Publishing is always the owner's explicit action, and it is gated
([`domain/profile.ts`](../../apps/api/src/domain/profile.ts), `publishBlock`):

| Code | Meaning | Fix |
| --- | --- | --- |
| `PUBLISH_INCOMPLETE` | Completeness is below `profile.publishThreshold` (default 55). The body carries `completeness` and `threshold` | Fill in what `missing` on `GET /api/profiles/me` lists (headline, about, photo, skills, a role, a project, education, links, a contact channel, each worth points) |
| `PUBLISH_NO_CONTACT` | No private contact channel (email, phone or WhatsApp) is set | Add one with `PUT /api/profiles/me/contact`. It stays private; recruiters see it only after the owner accepts an approach and shares that channel |
| `PROFILE_SUSPENDED` | A moderator suspended the page | The owner can appeal from their moderation history; restoring makes it UNLISTED, and the owner republishes |

An UNLISTED page opens by direct link but stays out of the directory and search. A renamed
username answers `301 PROFILE_MOVED` with the new handle in `details.username`, so links to the
old `/in/<username>` keep working.

### The AI import wizard or the polish buttons are missing

The web app shows them only when `GET /api/meta` reports `ai.import` / `ai.polish` as true.
That needs `AI_PROVIDER` other than `none` and a usable key (`aiAvailable()` in
[`core/config.ts`](../../apps/api/src/core/config.ts)): `OPENAI_API_KEY` for `openai`,
`GEMINI_API_KEY` for `gemini`. A key of `set-me` (the Terraform placeholder) counts as no key.
The import additionally needs the `import.enabled` platform setting. Terraform defaults
`AI_PROVIDER` to `none` when no OpenAI key or secret is configured
([deploy-aws.md](deploy-aws.md#ai-import-badges-polish-and-moderation)).

### An import stays QUEUED, or ends FAILED

- **Stays QUEUED**: `import.run` runs on the worker (`import` queue). With `JOBS_MODE=queue` and
  no worker, nothing picks it up. The wizard follows progress through `import:status` socket
  events (EXTRACTING, GENERATING, SCORING, READY).
- **FAILED, "We could not read any text in that file"**: a scanned PDF with no text layer, or an
  empty document. A photo of a resume (an image upload) goes to the vision model instead; or
  paste the text.
- **FAILED, "We could not find anything about your work in that input"**: the model returned no
  headline, roles or skills.
- **FAILED, "The AI could not process this input. Try pasting the text instead."**: the provider
  call failed (bad key, quota, timeout). The worker log has the detail (`profile import failed`).
- **FAILED, "Expired"**: housekeeping purged an import that was never applied, after
  `import.retentionHours`.
- **Start errors**: `400 IMPORT_EMPTY`, `400 IMPORT_TOO_SHORT` (under 60 characters with no
  file), `400 MEDIA_NOT_READY` (the upload has not completed), `429` (over `import.perDay`),
  `503 AI_UNAVAILABLE`, `503 IMPORT_DISABLED`.
- **Badges missing from a proposal** is usually the evidence gate working: a badge survives only
  when its quote appears verbatim in the input and its confidence is at least 0.6
  ([`domain/badges.ts`](../../apps/api/src/domain/badges.ts)). With the AI stub, one decoy badge
  is always dropped on purpose.
- **Polish answers `502 AI_FAILED`**: the provider call failed; the field is unchanged.

## Recruiters

### Work-email code errors

| Code | Meaning |
| --- | --- |
| `400 CODE_WRONG` | Wrong code; `details.attemptsLeft` says how many tries remain (5 per code) |
| `429 CODE_LOCKED` | Five wrong tries on this code. Ask for a new one |
| `400 CODE_EXPIRED` | No live code (they last 15 minutes) or it was replaced. Ask for a new one |
| `400 NOT_EMAIL_PENDING` | The account is not waiting for a code (already confirmed, under review, or never registered) |
| `409 WORK_EMAIL_TAKEN` | Another recruiter already uses that work email |
| `409 ALREADY_RECRUITER` | The account already has a recruiter record that is not REJECTED or EMAIL_PENDING |

After a correct code the account is either ACTIVE at once (domain auto-approval) or
PENDING_REVIEW in the `/admin` recruiter queue. Why one and not the other is explained in
[recruiter-verification.md](recruiter-verification.md).

### `403 RECRUITER_REQUIRED`

Searching with recruiter filters, approaching, posting jobs and opening pipelines need an
ACTIVE recruiter record whose company is not SUSPENDED. `GET /api/recruiter/me` shows the
status (and a review note when REJECTED or SUSPENDED).

### Approach errors

| Code | Meaning |
| --- | --- |
| `409 APPROACH_NOT_PUBLISHED` | The talent page is not PUBLISHED or UNLISTED. A block between the two answers the same, on purpose: a blocked recruiter learns nothing |
| `409 APPROACH_ALREADY_PENDING` | One pending approach per recruiter and candidate |
| `409 APPROACH_COOLDOWN` | The candidate declined within `recruiter.declineCooldownDays`; `details.cooldownUntil` says when |
| `429 APPROACH_QUOTA` | The recruiter's daily quota is spent (UTC day). Approaches the classifier took down are refunded |
| `400 JOB_NOT_SHAREABLE` | The attached job is not an OPEN job of the recruiter's company |
| `409 APPROACH_NOT_PENDING`, `409 APPROACH_EXPIRED` | Accept, decline or withdraw on an approach that already moved on or expired |
| `400 CHANNELS_REQUIRED`, `400 CHANNEL_NOT_SET` | Accepting needs at least one channel, and each chosen channel must be filled in on the profile (`details.missing`) |
| `403 CONTACT_NOT_SHARED` | Reveal without a live unlock: not accepted, revoked by the candidate, or a block |
| `409 NOTHING_SHARED` | Revoke with no live unlock |

## Hiring pipeline

### A card move answers `409 APPLICATION_CHANGED`

Someone else moved the card first. Every move is a conditional update on the stage the mover
saw, so two teammates dragging the same card cannot both win. Refresh the board (open boards
also receive `pipeline:card` events for teammates' moves). Other move answers come from
`canMoveStage` ([`domain/pipeline.ts`](../../apps/api/src/domain/pipeline.ts)):
`STAGE_FINAL` (HIRED and WITHDRAWN are final), `STAGE_NOT_ALLOWED` (for example a team move to
WITHDRAWN, or out of REJECTED to anything but SCREENING), `REASON_REQUIRED` (rejecting needs a
reason), `SAME_STAGE`. A bulk move takes at most 100 cards and is all or nothing. See
[hiring-pipeline.md](../architecture/hiring-pipeline.md).

### Applying answers `409 JOB_NOT_OPEN`, `ALREADY_APPLIED` or `422 ANSWERS_INVALID`

The job is not OPEN (or its `closes_at` passed), the person already applied (one application
per job), or a screening answer is missing, too long, or not `YES`/`NO` for a yes/no question
(`details.problems` lists each one). Recruiters cannot apply to their own company's jobs
(`400 OWN_COMPANY`).

### The pipeline board does not update live

The board subscribes with `job:subscribe`. The gateway answers `NOT_FOUND` unless the socket's
user is an ACTIVE recruiter of the job's company, so a recruiter still under review, removed
from the team, or signed in as another account gets no live updates. `GET /api/jobs/:id/pipeline`
applies the same rule (`403 RECRUITER_REQUIRED` or `404 JOB_NOT_FOUND`). `RATE_LIMITED` means more than 30 subscribe or presence
requests from one socket in 10 seconds. See [realtime.md](../architecture/realtime.md).

## Boot and configuration

### `Refusing to start with an insecure configuration`

With `NODE_ENV=production` the API and worker stop when a check fails; the message lists every
problem. The checks are in [configuration.md](configuration.md). Outside production the same
problems are logged as `config:` warnings.

### `Invalid configuration`

A variable failed validation (for example `PORT=abc`, an `APP_WEB_URL` that is not a URL, or
`REQUIRE_EMAIL_VERIFICATION=1`, which only accepts `true` or `false`). The message names the
field.

## Moderation and jobs

### Content never gets a verdict (`UNCHECKED`)

- The provider fails: wrong `OPENAI_API_KEY`, provider unreachable, or the stub not running.
  Scans retry 5 times and then give up; the worker log shows the error. (A provider of `openai`
  with no key, or Terraform's `set-me` placeholder, does not fail: the scan uses the `rules`
  provider and the log says so once per process.)
- Moderation is switched off (`moderation.enabled = false` in platform settings).
- You changed `MODERATION_PROVIDER` but an admin had already saved settings: the stored
  `moderation.provider` wins ([configuration.md](configuration.md#platform-settings)).
- With `JOBS_MODE=queue`, no worker is running.

### A held post never shows up for review

Its PREMODERATION case is opened in the same transaction as the post, whatever the scan job does,
so it is in the queue even with moderation off or a failing provider. Only platform staff
(MODERATOR, ADMIN) see the queue; RECRUITER_OPS has no moderation area.

### `JOBS_MODE=inline` surprises

Inline mode runs handlers in the API process after commit and swallows their errors: a failed
scan, media process or import is not retried. Scheduled jobs never run, because only the worker
schedules them: no digests, upload expiry, counter reconciliation or suspension lifting, and no
talent housekeeping (approaches never expire, engagements never auto-complete, ratings are not
revealed when their window closes). Use `queue` for anything but tests.

### Rate limits during a Redis outage

Rate limits are kept in Redis. When Redis is unreachable each limiter falls back to an in-memory
insurance limiter with the same budget, so requests keep working and limits are enforced per API
task (the effective budget multiplies by the number of tasks) until Redis returns. `/api/ready`
still returns 503 meanwhile.
