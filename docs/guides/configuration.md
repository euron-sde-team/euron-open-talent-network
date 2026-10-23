# Configuration reference

Every setting the system reads, where it comes from, and what production requires. There are
four layers:

1. **API and worker environment**, parsed and validated by
   [`apps/api/src/core/config.ts`](../../apps/api/src/core/config.ts) (a zod schema; an invalid
   value stops the process at boot with the field name).
2. **Database connection variables**, resolved by
   [`apps/api/src/db/connection-config.ts`](../../apps/api/src/db/connection-config.ts).
3. **Web app environment**, read by the Next.js server
   ([`apps/web`](../../apps/web/next.config.ts)).
4. **Platform settings**, a JSON document in the `settings` table that admins edit at runtime
   ([Platform settings](#platform-settings)).

The same API image runs the HTTP server (`dist/index.js`), the worker (`dist/worker.js`), the
migration runner (`dist/migrate.js`) and the CLI (`dist/cli.js`); they all read the same
variables. Booleans accept `true`, `false`, `1`, `0` (an empty value is false) unless noted.

## API and worker

### Runtime and HTTP

| Variable | Default | Description | Production |
| --- | --- | --- | --- |
| `NODE_ENV` | `development` | `development`, `test` or `production`. In `production` the [production guard](#production-guard) throws instead of warning | `production` |
| `PORT` | `5016` | HTTP and Socket.IO port of the API process | any |
| `PRODUCT_NAME` | `Euron Open Talent` | Shown in emails, the TOTP issuer, the demo seed banner and the default network name | any |
| `APP_WEB_URL` | `http://localhost:3520` | The web app origin. Emailed links (verify, reset, digests) are built from it, and it is the CORS origin when `CORS_ORIGINS` is empty. `COOKIE_SECURE=auto` keys off its scheme | Required, must not point at localhost |
| `PUBLIC_API_URL` | `http://localhost:5016` | This API's public origin. Used only to build the signed URLs that `STORAGE=local` serves itself (`/api/media/local/<token>`) | Not used with `STORAGE=s3` (Terraform sets it to the app URL) |
| `CORS_ORIGINS` | empty | Comma-separated origins allowed to call the API with credentials and to connect over Socket.IO. Also the allowlist for the cross-site Origin check on non-GET requests | Required |
| `TRUST_PROXY` | `1` | Number of proxy hops Express trusts for `req.ip` (rate limits, audit IPs). Terraform sets 1 behind the ALB, 2 behind CloudFront and the ALB | Must match the real hop count |
| `LOG_LEVEL` | `info` | `fatal`, `error`, `warn`, `info`, `debug`, `trace` or `silent`. Under `NODE_ENV=test` the default `info` becomes silent | `info` |
| `TZ` | set in code | `index.ts`, `worker.ts` and `cli.ts` set `process.env.TZ = "UTC"` before anything else; compose and Terraform also pass `TZ=UTC` | `UTC` |

### Sessions and passwords

| Variable | Default | Description | Production |
| --- | --- | --- | --- |
| `JWT_SECRET` | a committed development value | HMAC key for access tokens (HS256) | Required: not the default, at least 32 characters, different from `REFRESH_SECRET` |
| `REFRESH_SECRET` | a committed development value | Kept distinct from `JWT_SECRET`. Refresh tokens themselves are random and stored hashed; this value seeds the HMAC key that signs `STORAGE=local` media links | Required: same rules |
| `TOTP_ENCRYPTION_KEY` | derived from a public constant | 32 bytes, base64 (`openssl rand -base64 32`). Encrypts TOTP secrets at rest (AES-256-GCM, key via HKDF) and keys the HMAC of recovery codes. Unset works for development and tests | Required: not the development default. Changing it makes every stored TOTP secret and recovery code unusable |
| `ACCESS_TOKEN_TTL_SECONDS` | `900` | Access token lifetime (15 minutes) | any |
| `REFRESH_TOKEN_TTL_DAYS` | `30` | Refresh cookie and session lifetime | any |
| `COOKIE_SECURE` | `auto` | `true`, `false` or `auto`. `auto` sets the `Secure` flag when `APP_WEB_URL` is `https://`. The compose stack sets `false` (plain HTTP) | `true` (Terraform) |
| `BCRYPT_ROUNDS` | `12` | bcrypt cost, 4 to 15. The test suite uses 4 | At least 12 |
| `REQUIRE_EMAIL_VERIFICATION` | `true` | Only the strings `true` and `false`. When true, sign-up returns 202 and the account stays `PENDING_VERIFICATION` until the emailed link is used | Terraform input `require_email_verification` (default true) |

### Database

| Variable | Default | Description | Production |
| --- | --- | --- | --- |
| `DATABASE_URL` | none | A static connection URL. When set it wins over everything below | Unset on AWS |
| `DATABASE_SECRET_ARN` | none | Secret-based mode: the RDS-managed secret (`{"username","password"}`). Used only when `DATABASE_URL` is unset | Set by Terraform |
| `DB_HOST`, `DB_NAME`, `DB_USER` | none | Required in secret mode | Set by Terraform |
| `DB_PORT` | `5432` | Port in secret mode | Set by Terraform |
| `DB_SSL` | `require` | Secret mode only: `disable`, `require` (encrypt, do not verify) or `verify-full` (needs `DB_SSL_CA_FILE`) | Terraform sets `require` |
| `DB_SSL_CA_FILE` | none | CA bundle path for `verify-full` | Optional |
| `DB_POOL_MAX` | `10` | Pool size per process (each API task and each worker task has its own pool) | Size against the database's connection limit |
| `MIGRATE_ON_BOOT` | `false` | Run pending migrations when the API starts, under the runner's advisory lock | Terraform default false: the `migrate` task runs them |

How the connection is resolved ([`connection-config.ts`](../../apps/api/src/db/connection-config.ts)):

- `DATABASE_URL` set: used as is (local, CI).
- Otherwise `DATABASE_SECRET_ARN` set: `pg` gets `host`, `port`, `database`, `user`, the TLS
  settings above, and `password` as an async function. It reads the secret from Secrets
  Manager for each new connection, caches it for 60 seconds (`PASSWORD_CACHE_MS`) and shares one
  in-flight request across a warming pool. A password RDS rotates is picked up without a
  restart.
- Neither set: it falls back to the compose database, `postgres://talent:talent@localhost:5482/talent`
  (`LOCAL_DATABASE_URL`). Set `DATABASE_URL` for anything else.

`DB_SSL` applies only to the secret mode; with `DATABASE_URL`, put TLS options in the URL.

### Redis and jobs

| Variable | Default | Description | Production |
| --- | --- | --- | --- |
| `REDIS_URL` | `redis://localhost:6419` | BullMQ queues, the Socket.IO adapter, rate limits and presence. `rediss://` for TLS | Injected from Secrets Manager (`rediss://` with the AUTH token) |
| `JOBS_MODE` | `queue` | `queue`: BullMQ, run by the worker process. `inline`: every job handler runs in the API process right after commit | `queue` |

With `JOBS_MODE=inline` handler errors are logged and swallowed (no retry), and the scheduled
maintenance jobs never run, because only `worker.ts` schedules them: no notification digests,
upload expiry, counter reconciliation, suspension lifting, and no talent housekeeping
(approaches never expire, engagements never auto-complete, ratings are not revealed when the
window closes, import input is not purged on schedule). The integration tests use it for determinism; the production guard
rejects it.

### Media storage

| Variable | Default | Description | Production |
| --- | --- | --- | --- |
| `STORAGE` | `local` | `local` (files under `DATA_DIR/media`, served by the API through HMAC-signed links) or `s3` | `s3` |
| `DATA_DIR` | `<cwd>/data` | Root for local media and the mail outbox. The image sets `/tmp/data` (read-only root filesystem on ECS); compose mounts a volume at `/app/data` | Only matters for `local` and `outbox` |
| `S3_BUCKET` | none | Media bucket | Required with `s3` |
| `S3_REGION` | `AWS_REGION` | Bucket region | Set by Terraform |
| `S3_PUBLIC_ENDPOINT` | none | Browser-reachable S3 endpoint used only to sign URLs (the emulator, `http://localhost:4587`) | Unset |
| `AWS_REGION` | `us-east-1` | Default region for every AWS client | Set by Terraform |
| `AWS_ENDPOINT_URL` | none | Points every AWS client at an emulator (path-style S3). Credentials come from the default chain (the ECS task role on AWS) | Unset |
| `SIGNED_URL_TTL_SECONDS` | `900` | Lifetime of presigned GET URLs (and local signed links). Presigned PUTs always last 600 seconds | any |

### Mail

| Variable | Default | Description | Production |
| --- | --- | --- | --- |
| `MAIL_MODE` | `outbox` | `outbox` (writes `.eml` files to `DATA_DIR/outbox`, sends nothing), `smtp`, or `ses` (SES v2, raw MIME) | `ses` or `smtp` |
| `MAIL_FROM` | `<PRODUCT_NAME> <no-reply@localhost>` | From address | Required unless `outbox`; must be a verified SES identity with `ses` |
| `SMTP_HOST`, `SMTP_PORT` (`587`), `SMTP_USER`, `SMTP_PASS` | none | SMTP relay. Port 465 uses implicit TLS | With `smtp` |
| `SES_REGION` | `AWS_REGION` | SES region | With `ses` |
| `SES_CONFIGURATION_SET` | none | Configuration set for delivery metrics and suppression | Set by Terraform |

Sending never throws into the caller: a failed send is logged and the request continues.

### Moderation

| Variable | Default | Description | Production |
| --- | --- | --- | --- |
| `MODERATION_PROVIDER` | `rules` | `rules` (no network: blocked terms, link spam, repeats), `openai`, or `stub` (the fake server in `apps/ai-stub`, tests only). This is only the initial value of the `moderation.provider` platform setting; see [the provider lives in settings](#the-moderation-provider-lives-in-settings) | Not `stub`; `openai` needs a real key |
| `OPENAI_API_KEY` | none | Key for OpenAI, shared by the `openai` moderation provider and `AI_PROVIDER=openai`. The value `set-me` (Terraform's placeholder) counts as unset | Injected from Secrets Manager when configured |
| `OPENAI_BASE_URL` | `https://api.openai.com/v1` | Base URL of an OpenAI-compatible API (`/moderations`, `/chat/completions`, `/audio/transcriptions`), for moderation and the AI layer | any |
| `OPENAI_MODERATION_MODEL` | `omni-moderation-latest` | Model sent with each moderation request | any |
| `MODERATION_STUB_URL` | `http://localhost:5109` | Base of the stub server for `MODERATION_PROVIDER=stub` (`/v1/moderations` is appended). Read at call time, so tests can point it at an ephemeral port | unused |

### AI

The AI layer drafts a profile from pasted text, a document or a voice note, proposes
evidence-gated badges and rewrites one field on request ("polish"). See
[ai.md](../architecture/ai.md).

| Variable | Default | Description | Production |
| --- | --- | --- | --- |
| `AI_PROVIDER` | `openai` | `openai`, `gemini`, `stub` (the HTTP fake in `apps/ai-stub`, tests and local) or `none`. With `none`, or a real provider without a usable key, AI is unavailable: `GET /api/meta` reports `ai: { import: false, polish: false }`, the web app hides the import wizard and polish buttons, and the endpoints answer `503 AI_UNAVAILABLE` | Not `stub`. Terraform: `openai` when a key is configured, else `none` |
| `OPENAI_MODEL` | `gpt-4o-mini` | Chat model for import, badges and polish (strict JSON schema output) | any |
| `OPENAI_TRANSCRIBE_MODEL` | `whisper-1` | Speech-to-text model for voice-note imports | any |
| `GEMINI_API_KEY` | none | Key for `AI_PROVIDER=gemini`. `set-me` counts as unset | Pass as a secret (`api_extra_secrets`) |
| `GEMINI_MODEL` | `gemini-2.5-flash` | Gemini model. PDFs, images and audio are sent inline (no transcription step, nothing stored provider-side) | any |
| `GEMINI_BASE_URL` | `https://generativelanguage.googleapis.com/v1beta` | Gemini API base | any |
| `AI_STUB_URL` | `http://localhost:5109` | Base of the stub server for `AI_PROVIDER=stub` (`/v1` is appended) | unused |

AI availability is decided by `aiAvailable()` in
[`core/config.ts`](../../apps/api/src/core/config.ts): `none` is off, `stub` is on, `gemini`
needs `GEMINI_API_KEY`, `openai` needs `OPENAI_API_KEY` (neither may be `set-me`). The
`import.enabled` platform setting can also turn the import off at runtime
(`503 IMPORT_DISABLED`).

### Privacy

| Variable | Default | Description | Production |
| --- | --- | --- | --- |
| `VIEW_HASH_SALT` | a committed development value | Salt for the HMAC of signed-out viewers' IPs in profile view counts (one row per viewer per profile per day), and of recruiter IPs in the contact access log. Raw IPs are never stored there | Required: not the default (Terraform generates it, secret `<name_prefix>/views`). Changing it only resets the de-duplication of the current day's views |

### Declared in `config.ts`, read elsewhere

Every variable is declared in the `config.ts` schema. These are also read outside the parsed
`config` object: the rate-limit switches live through `rateLimitEnv()` (so a test can turn limits
on for one case), and `MIGRATIONS_DIR` only by the migration runner.

| Variable | Read by | Description |
| --- | --- | --- |
| `RATE_LIMITS` | [`middleware/rate-limit.ts`](../../apps/api/src/middleware/rate-limit.ts) | `off` disables every rate limit. Default: `off` under `NODE_ENV=test`, `on` otherwise |
| `RATE_LIMIT_STORE` | same | Under `NODE_ENV=test` limits use memory unless this is `redis`. Outside tests they always use Redis |
| `MIGRATIONS_DIR` | [`db/migrate.ts`](../../db/migrate.ts) | Where the `.sql` files are (default `db/migrations` next to the runner). Terraform sets `/app/db/migrations` |
| `DEMO_PASSWORD` | [`demo/seed.ts`](../../apps/api/src/demo/seed.ts) (via `config`) | `demo:seed` only: the shared password of every demo account; random and printed once when unset. `make demo` passes `TALENT_DEMO_PASSWORD` from `deploy/compose/.env` |

Rate limits are stored in Redis so the budget is shared by every API task. If Redis is down, each
limiter falls back to an in-memory insurance limiter with the same budget (enforced per task)
instead of failing the request.

## Production guard

`assertProductionConfig` in [`core/config.ts`](../../apps/api/src/core/config.ts) runs at the
start of the API and worker processes (not the migration runner or the CLI). Outside production
it logs each problem as a warning; with `NODE_ENV=production` it refuses to start if any is
present:

| Problem | Condition |
| --- | --- |
| Committed default secret | `JWT_SECRET` or `REFRESH_SECRET` equals its development default |
| No TOTP key | `TOTP_ENCRYPTION_KEY` is unset (equals the derived development default) |
| Short secret | either is shorter than 32 characters |
| Shared secret | `JWT_SECRET` equals `REFRESH_SECRET` |
| No CORS allowlist | `CORS_ORIGINS` is empty |
| Localhost web URL | `APP_WEB_URL` contains `localhost` or `127.0.0.1` |
| Local media | `STORAGE=local` |
| Missing bucket | `STORAGE=s3` without `S3_BUCKET` |
| Mail not sent | `MAIL_MODE=outbox` |
| Missing sender | `MAIL_MODE` is not `outbox` and `MAIL_FROM` is empty |
| Missing OpenAI key | `MODERATION_PROVIDER=openai` without `OPENAI_API_KEY`, or with the placeholder `set-me` |
| Test moderation provider | `MODERATION_PROVIDER=stub` |
| Inline jobs | `JOBS_MODE=inline` |
| Test AI provider | `AI_PROVIDER=stub` |
| Default view salt | `VIEW_HASH_SALT` equals its committed development default |
| Weak hashing | `BCRYPT_ROUNDS` below 12 |

`AI_PROVIDER=openai` (or `gemini`) without a key is not a boot problem: AI is simply reported
unavailable and the manual editor is the only path. The guard checks the environment only; it
does not see the `moderation.provider` platform setting. That setting is covered at scan time instead: when it says `openai` but no real
`OPENAI_API_KEY` is configured (unset, or Terraform's `set-me` placeholder), the scan uses the
`rules` provider and logs a warning once per process, so content is still classified.

## Web app

The web image is built once and configured at request time: the server renders `/env.js` from
its own environment ([`app/env.js/route.ts`](../../apps/web/src/app/env.js/route.ts),
[`lib/runtime-env.ts`](../../apps/web/src/lib/runtime-env.ts)), and the browser reads it before
any client code runs. Precedence is runtime variable, then the `NEXT_PUBLIC_*` value inlined at
build time, then the default.

| Variable | Default | Description |
| --- | --- | --- |
| `PRODUCT_NAME` (or `NEXT_PUBLIC_PRODUCT_NAME`) | `Euron Open Talent` | Wordmark, titles, copy |
| `PUBLIC_API_URL` (or `NEXT_PUBLIC_API_URL`) | `/api` | The API base the browser calls, including `/api`. Same origin by default |
| `PUBLIC_SOCKET_URL` (or `NEXT_PUBLIC_SOCKET_URL`) | empty | Socket.IO origin; empty means the page's own origin |
| `API_INTERNAL_URL` | `http://localhost:5016` (image build arg: `http://api:5016`) | Where Next proxies `/api/*` and `/socket.io/*` ([`next.config.ts`](../../apps/web/next.config.ts)). Next evaluates rewrites at build time, so the value baked into the image is the one used; it is also a Docker build argument. On AWS the load balancer routes those paths to the API before they reach Next, so the proxy is not used there |
| `MEDIA_ORIGINS` | empty | Space or comma separated origins added to `img-src`, `media-src` and `connect-src` in the per-request Content-Security-Policy ([`middleware.ts`](../../apps/web/src/middleware.ts)). Must include the origin of presigned media URLs (the bucket, or Floci locally) or images and uploads are blocked |
| `NODE_ENV` | `production` in the image | Outside production the CSP also allows `'unsafe-eval'` and any `ws:`/`wss:` connection for development |
| `PORT`, `HOSTNAME` | `3000`, `0.0.0.0` in the image | Next standalone server |

Note the name clash: the web app's `PUBLIC_API_URL` is the API base for the browser
(`/api` by default), while the API's `PUBLIC_API_URL` is the API origin used for local media
links. They are different variables read by different processes; the compose file and
Terraform set the API's one only.

## Local compose stack

[`deploy/compose/.env`](../../deploy/compose/.env.example) is generated by `make env` and read by
every compose command in the Makefile.

| Variable | Default | Description |
| --- | --- | --- |
| `TALENT_JWT_SECRET`, `TALENT_REFRESH_SECRET` | random (64 characters) | Become the API's `JWT_SECRET` and `REFRESH_SECRET`. Compose refuses to start without them |
| `TALENT_TOTP_ENCRYPTION_KEY` | random (32 bytes, base64) | Becomes the API's `TOTP_ENCRYPTION_KEY`. Compose refuses to start without it; `make env` adds it to an older `.env` that lacks it |
| `TALENT_VIEW_HASH_SALT` | random (32 characters) | Becomes the API's `VIEW_HASH_SALT`. Compose refuses to start without it; `make env` adds it to an older `.env` |
| `TALENT_DEMO_PASSWORD` | random (`Demo-` plus 12 characters) | Shared demo password (`make demo`) |
| `TALENT_PRODUCT_NAME` | `Euron Open Talent` | `PRODUCT_NAME` for the API and web |
| `TALENT_LOG_LEVEL` | `info` | API and worker `LOG_LEVEL` |
| `TALENT_WEB_PORT` | `3520` | Web host port; also drives `APP_WEB_URL`, the API's `PUBLIC_API_URL`, `CORS_ORIGINS` and the bucket CORS origin |
| `TALENT_API_PORT`, `TALENT_PG_PORT`, `TALENT_REDIS_PORT` | `5016`, `5482`, `6419` | Host ports |
| `TALENT_MAILPIT_PORT`, `TALENT_SMTP_PORT` | `8036`, `1036` | Mailpit UI and SMTP host ports |
| `TALENT_FLOCI_PORT`, `TALENT_STUB_PORT` | `4587`, `5109` | Emulator and AI stub host ports |
| `AI_PROVIDER`, `OPENAI_API_KEY`, `OPENAI_MODEL`, `GEMINI_API_KEY`, `MODERATION_PROVIDER` | `stub`, empty, `gpt-4o-mini`, empty, `stub` | Interpolated into the API environment, so a line in `.env` switches the local stack to a real provider. `OPENAI_TRANSCRIBE_MODEL` and `GEMINI_MODEL` are not passed by the compose file and keep their defaults |

The compose files set `NODE_ENV=development` for the API on purpose: the stack links to
localhost and talks to an emulator, both of which the production guard refuses.

## Terraform inputs that become environment

[`modules/deployment/main.tf`](../../infra/terraform/modules/deployment/main.tf) builds the API
and worker environment (`api_environment`): `NODE_ENV=production`, `APP_WEB_URL`,
`PUBLIC_API_URL` and `CORS_ORIGINS` all set to `https://<domain>`, `TRUST_PROXY` (1, or 2 with
the CDN), `COOKIE_SECURE=true`, `JOBS_MODE=queue`, `STORAGE=s3` with the bucket, `MAIL_MODE=ses`
with `MAIL_FROM` derived from `product_name` and the email module's from address, the
`DATABASE_SECRET_ARN` connection set with `DB_SSL=require`, `MODERATION_PROVIDER`,
`AI_PROVIDER`, `OPENAI_MODEL`, `MIGRATE_ON_BOOT`, `MIGRATIONS_DIR`, `DB_POOL_MAX` and
`LOG_LEVEL`. `JWT_SECRET`, `REFRESH_SECRET` (secret `<name_prefix>/app`), `TOTP_ENCRYPTION_KEY`
(32 random bytes, base64, secret `<name_prefix>/totp`), `VIEW_HASH_SALT` (secret
`<name_prefix>/views`), `REDIS_URL` and (optionally) `OPENAI_API_KEY` (secret
`<name_prefix>/openai`) are injected from Secrets Manager, never written into the task
definition.

| Terraform input | Becomes |
| --- | --- |
| `product_name` | `PRODUCT_NAME` (API, worker, web) and the `MAIL_FROM` display name |
| `require_email_verification` | `REQUIRE_EMAIL_VERIFICATION` |
| `moderation_provider` | `MODERATION_PROVIDER` (default `openai` when a key or secret is configured, else `rules`) |
| `ai_provider` | `AI_PROVIDER` (default `openai` when a key or secret is configured, else `none`) |
| `openai_model` (module input) | `OPENAI_MODEL` (default `gpt-4o-mini`) |
| `migrate_on_boot` | `MIGRATE_ON_BOOT` |
| `db_pool_max` | `DB_POOL_MAX` |
| `log_level` | `LOG_LEVEL` |
| `api_extra_environment` | Merged over everything above, for example `OPENAI_MODERATION_MODEL`, `OPENAI_TRANSCRIBE_MODEL`, `GEMINI_MODEL` or `ACCESS_TOKEN_TTL_SECONDS`. Never put secrets here |
| `api_extra_secrets` (module input) | Extra ECS secret references for the api and worker, for example `GEMINI_API_KEY`; the execution role may read each one |

The web service gets `PRODUCT_NAME`, `API_INTERNAL_URL` (the app URL) and `MEDIA_ORIGINS` (the
bucket's regional and global virtual-hosted origins). The one-off `migrate` task gets
only the database settings plus `NODE_ENV`, `TZ`, `LOG_LEVEL`, `PRODUCT_NAME` and `APP_WEB_URL`.
The `admin` task gets the same plus the api's mail settings (`MAIL_MODE=ses`, `MAIL_FROM`,
`SES_REGION`, `SES_CONFIGURATION_SET`) and the `TOTP_ENCRYPTION_KEY` secret, so `admin:create`
emails a set-password link (see [deploy-aws.md](deploy-aws.md)). With `app_db_secret_arn` and
`app_db_username` set, the api and worker connect as that role instead of the master user
([operations.md](operations.md#least-privilege-database-role)).

## Platform settings

Runtime settings live in one JSON document, key `platform`, in the `settings` table
([`services/settings.service.ts`](../../apps/api/src/services/settings.service.ts)). The stored
document is merged over the defaults below, group by group (and key by key inside
`moderation.thresholds` and `moderation.premoderateNewAccounts`), and cached for 5 seconds per
process. Operators with the `settings` area (platform ADMIN only) read it with
`GET /api/admin/settings` and change it with `PATCH /api/admin/settings` (the settings area of
`/admin`); every change is audited.

### Network

| Setting | Default | Effect |
| --- | --- | --- |
| `networkName` | `PRODUCT_NAME` | The network's name in every email and in the public `GET /api/meta`, which the web app reads for page titles. The TOTP issuer keeps `PRODUCT_NAME` |
| `registration` | `OPEN` | `OPEN`: anyone signs up. `CLOSED`: nobody (`403 REGISTRATION_CLOSED`). Exposed by `GET /api/meta` |
| `analytics.timezone` | `UTC` | The day boundaries of the `/admin` overview KPIs and its CSV (an IANA zone name) |

### Profiles

| Setting | Default | Effect |
| --- | --- | --- |
| `profile.publishThreshold` | `55` | Completeness (0 to 100) a talent page needs before its owner can publish it (`422 PUBLISH_INCOMPLETE` below it). Publishing also needs at least one private contact channel (`422 PUBLISH_NO_CONTACT`). See [ADR 0019](../architecture/adr/0019-explicit-publish.md) |
| `profile.usernameCooldownDays` | `30` | How often a username can change (`429 USERNAME_COOLDOWN`). Old handles keep redirecting |

### Recruiters and jobs

| Setting | Default | Effect |
| --- | --- | --- |
| `recruiter.approachesPerDay` | `25` | Daily approach quota per recruiter (UTC day), unless the recruiter has a personal quota set in `/admin`. Approaches the classifier takes down do not count. Over it: `429 APPROACH_QUOTA` |
| `recruiter.approachExpiryDays` | `14` | A pending approach expires after this many days (housekeeping) |
| `recruiter.declineCooldownDays` | `30` | After a decline, the same recruiter waits this long to approach that person again (`409 APPROACH_COOLDOWN` with `cooldownUntil`) |
| `recruiter.maxOpenJobsPerCompany` | `50` | OPEN jobs per company, checked on every move to OPEN (`JOB_CAP_REACHED`) |
| `recruiter.freeMailDomains` | a list of common free-mail and disposable domains | Work emails on these domains can still apply, but the review queue flags them and they never auto-approve |
| `recruiter.allowDomainAutoApprove` | `true` | Platform switch for domain auto-approval: a recruiter whose confirmed work email is on a domain of a VERIFIED company with auto-approval on skips the review queue. Off: everyone is reviewed. See [recruiter-verification.md](recruiter-verification.md) |

### Messaging

| Setting | Default | Effect |
| --- | --- | --- |
| `messaging.requestsPerDay` | `20` | Message requests (first messages to people you have no connection, accepted approach or application with) one member may start per day |
| `messaging.requestMessageCap` | `3` | Messages a sender may write into a request before the recipient accepts (`DM_REQUEST_PENDING` after that) |

### Trust

| Setting | Default | Effect |
| --- | --- | --- |
| `trust.autoConfirmDays` | `14` | An engagement whose completion was requested and not answered within this many days completes automatically (housekeeping) |
| `trust.ratingWindowDays` | `60` | Ratings can be given from completion until this many days later; hidden ratings are revealed when it closes |
| `trust.complaintsPer30Days` | `3` | Complaints one member may file in 30 days (`429 COMPLAINT_LIMIT`) |

### AI import

| Setting | Default | Effect |
| --- | --- | --- |
| `import.enabled` | `true` | Off: the import wizard is hidden (`GET /api/meta` reports `ai.import: false`) and starting one answers `503 IMPORT_DISABLED`. Polish follows AI availability only |
| `import.perDay` | `5` | Imports one member may start per day |
| `import.retentionHours` | `72` | Raw input text, the upload link and the proposal of an import that was not applied are purged after this many hours (an applied import is purged at once) |

### Moderation

| Setting | Default | Effect |
| --- | --- | --- |
| `moderation.enabled` | `true` | Off: the scan job skips everything, so nothing is classified. Held posts still get their PREMODERATION case, which opens with the post |
| `moderation.provider` | `MODERATION_PROVIDER` at boot | The provider the scan job uses: `rules`, `openai` or `stub`. `openai` without a real key falls back to `rules` with a warning |
| `moderation.thresholds` | see below | Per category `{ review, hide }`, each 0 to 1 |
| `moderation.premoderateNewAccounts` | `{ enabled: false, firstPosts: 3, accountAgeDays: 2 }` | When enabled, posts by accounts younger than `accountAgeDays` with fewer than `firstPosts` published posts are held for review |
| `moderation.blockedTerms` | `[]` | Whole-word terms the `rules` provider scores as harassment |

The default thresholds:

| Category | review | hide |
| --- | --- | --- |
| `harassment` | 0.5 | 0.85 |
| `hate` | 0.4 | 0.8 |
| `violence` | 0.5 | 0.85 |
| `sexual` | 0.5 | 0.85 |
| `sexual/minors` | 0.1 | 0.3 |
| `self-harm` | 0.3 | 0.9 |
| `illicit` | 0.6 | 0.9 |
| `spam` | 0.6 | 0.9 |

### Validation

The PATCH body is validated strictly
([`controllers/admin.controller.ts`](../../apps/api/src/controllers/admin.controller.ts)):
unknown keys are rejected at every level, and every group is partial, so a patch carries only
what changes.

| Field | Allowed |
| --- | --- |
| `networkName` | 1 to 80 characters |
| `registration` | `OPEN` or `CLOSED` |
| `profile.publishThreshold`, `usernameCooldownDays` | 0 to 100; 0 to 365 |
| `recruiter.approachesPerDay`, `approachExpiryDays`, `declineCooldownDays`, `maxOpenJobsPerCompany` | 0 to 1000; 1 to 90; 0 to 365; 1 to 10000 |
| `recruiter.freeMailDomains` | at most 2000 lower-cased domain names |
| `messaging.requestsPerDay`, `requestMessageCap` | 0 to 1000; 1 to 20 |
| `trust.autoConfirmDays`, `ratingWindowDays`, `complaintsPer30Days` | 1 to 90; 1 to 365; 1 to 100 |
| `import.perDay`, `retentionHours` | 0 to 100; 1 to 720 |
| `analytics.timezone` | a known IANA time zone, or `UTC` |
| `moderation.thresholds` | at most 50 categories, names 1 to 60 characters, `review` and `hide` in 0..1 |
| `moderation.premoderateNewAccounts.firstPosts`, `accountAgeDays` | 0 to 100; 0 to 365 |
| `moderation.blockedTerms` | at most 500 entries of 1 to 100 characters |

Thresholds merge per key, so a category cannot be removed, only changed (setting `review` and
`hide` to 1 effectively disables it).

### The moderation provider lives in settings

The default document takes `moderation.provider` from `MODERATION_PROVIDER` when the process
starts. The first time an admin saves any setting, the whole merged document, provider
included, is written to the database. From then on the stored value wins and changing
`MODERATION_PROVIDER` in the environment has no effect. Switch providers with
`PATCH /api/admin/settings` and `{ "moderation": { "provider": "openai" } }` (or the settings
area), and make sure `OPENAI_API_KEY` is set on the worker (and on the API, for inline mode)
before you do. The production guard does not inspect this setting.

`AI_PROVIDER` is different: it is environment only, never stored in settings, and takes effect
when the processes restart.
