# Operations

Running a deployment day to day: health, logs, alarms, scaling, background jobs, backups,
migrations, secret rotation, AI cost, and the operator queues (recruiter approvals, moderation,
complaints). Paths refer to the Terraform in
[`infra/terraform`](../../infra/terraform) and the API in [`apps/api/src`](../../apps/api/src/index.ts).

## Health endpoints

| Endpoint | Meaning | Used by |
| --- | --- | --- |
| `GET /up` | Liveness: the process answers. No dependencies checked | Container health check in the image and the ECS task definition |
| `GET /api/ready` | Readiness: a `SELECT 1` on Postgres and a Redis `PING` both succeed. 503 otherwise | ALB target group health check of the api service |
| `GET /` (web) | The Next server answers | Web container and target group health check |

Both API endpoints are excluded from request logging ([`app.ts`](../../apps/api/src/app.ts)). The
worker has no HTTP port; its container health check is disabled and ECS only restarts it if the
process exits.

## Logs

The API and worker log JSON lines with pino ([`core/logger.ts`](../../apps/api/src/core/logger.ts)),
`base: { app: "open-talent" }`. Every HTTP request gets an id (the incoming `X-Request-Id` if
it is 8 to 64 word characters, else a new ULID), returned in the `X-Request-Id` header and in
every error body as `requestId`, so a user report can be matched to its log line. Paths of local
media links are masked as `/media/local/[signed]`.

Redacted before writing: `Authorization` and `Cookie` request headers, `Set-Cookie`, and any
field named `password`, `newPassword`, `currentPassword`, `passwordHash`, `password_hash`,
`token`, `refreshToken`, `accessToken`, `totp`, `totpSecret`, `totp_secret`, `secret`, `code`,
`recoveryCode`, `recoveryCodes`, `code_hash`, `apiKey`, `authorization` or `cookie`, at the top
level of the logged object and up to three levels below it (so `req.body.password` is masked).
Anything deeper is not covered, so still avoid logging whole nested payloads
([`core/logger.ts`](../../apps/api/src/core/logger.ts)).

On AWS each service writes to its own CloudWatch log group, encrypted with the deployment's KMS
key:

| Log group | Contents |
| --- | --- |
| `/open-talent/<name_prefix>/api` | API process |
| `/open-talent/<name_prefix>/worker` | Worker: job failures are logged with the job name and attempt count (and counted by the `worker-failed-jobs` alarm) |
| `/open-talent/<name_prefix>/web` | Next.js server |
| `/open-talent/<name_prefix>/migrate` | Migration runs |
| `/open-talent/<name_prefix>/admin` | `admin:create` runs (it emails a set-password link and logs no password; see [deploy-aws.md](deploy-aws.md)) |
| `/open-talent/<name_prefix>/redis-slow` | ElastiCache slow log |

RDS exports its `postgresql` log (statements slower than 1 s are logged,
`log_min_duration_statement = 1000`). VPC flow logs go to their own group. Retention is 14 days
in aws-dev and 365 in aws-prod (`log_retention_days`). Locally: `make logs SERVICE=api`.

## Alarms and dashboard

[`modules/observability`](../../infra/terraform/modules/observability/main.tf) creates an SNS
topic `<name_prefix>-alarms` (email subscription when `alarm_email` is set) and these alarms,
each over two evaluation periods unless noted, with OK notifications too:

| Alarm | Condition |
| --- | --- |
| `<svc>-5xx` (api, web) | More than 25 target 5xx responses in 5 minutes |
| `<svc>-unhealthy` (api, web) | Any unhealthy target in a minute |
| `<svc>-cpu`, `<svc>-memory` (api, web, worker) | Average above 85% for 5 minutes |
| `db-cpu` | RDS CPU above 80% |
| `db-storage` | Free storage below 5 GiB |
| `db-connections` | Connections above 80% of `db_max_connections` (200, so 160) |
| `worker-failed-jobs` | More than 5 failed job attempts in 5 minutes (one period; `failed_jobs_threshold`) |

[`modules/cache`](../../infra/terraform/modules/cache/main.tf) adds per-node Redis alarms to the
same topic: engine CPU above 80%, memory above 80% of maxmemory, any eviction, and more than
1000 connections. Redis runs with `maxmemory-policy noeviction` because BullMQ cannot lose job
keys, so the memory alarm means writes will soon fail, and an eviction alarm should never fire.

The dashboard `<name_prefix>` shows request and error counts, p50 and p99 latency, CPU and
memory per service, and database CPU, connections and latency. SES publishes send, delivery,
bounce and complaint counts per configuration set (namespace `AWS/SES`).

The worker publishes no metrics of its own. `worker-failed-jobs` comes from a CloudWatch Logs
metric filter on the worker log group: every failed attempt is logged by
[`worker.ts`](../../apps/api/src/worker.ts) as a pino error line (`"level":50`) with a `job`
field, and the filter `{ $.job = * && $.level = 50 }` counts those lines into
`OpenTalent/<name_prefix>` `FailedJobs`. Worker errors without a `job` field (boot,
side-effect flushes) are not counted. A job retried 5 times counts 5, so a single poisoned job
can fire the alarm on its own; a worker failing every job (for example a moderation provider
rejecting the key) fires it within minutes. To see which jobs, run in CloudWatch Logs Insights
on the worker group:

```
fields @timestamp, job, attempts, msg
| filter level = 50 and ispresent(job)
| sort @timestamp desc
```

Still not covered: queue depth and job age (a worker that is down, rather than failing, shows
as a growing backlog in Redis but trips no alarm beyond the service's own health). Check failed
jobs as described under [Moderation queue](#moderation-queue).

## Scaling

| Component | How it scales |
| --- | --- |
| api | ECS target tracking on 60% average CPU, between `api_min_count` and `api_max_count` (1 to 2 dev, 2 to 10 prod). Stateless: sessions are in Postgres, fan-out in Redis. The ALB cookie keeps a Socket.IO polling session on one task |
| worker | Same policy (1 dev, 2 to 6 prod). Each worker process runs one BullMQ worker per queue: concurrency 8 for `moderation`, 4 for each of `media`, `notifications`, `maintenance`, `feed` and `import` ([`worker.ts`](../../apps/api/src/worker.ts)) |
| web | Same policy (1 to 2 dev, 2 to 6 prod) |
| Database | Vertical: `db_instance_class`; storage autoscales to `db_max_allocated_storage` |
| Redis | Vertical: `cache_node_type` |

Every API and worker process holds its own pool of up to `DB_POOL_MAX` (10) connections. At the
prod maximums (10 api + 6 worker tasks) that is 160, which is exactly the `db-connections` alarm
threshold. Raise `db_max_connections` in the observability module if your instance allows more,
or lower `db_pool_max`.

## Background jobs

Jobs are named handlers with a JSON payload
([`jobs/registry.ts`](../../apps/api/src/jobs/registry.ts)); the queue is the first segment of
the name. Every job gets 5 attempts with exponential backoff from 5 seconds; the last 1000
completed and 5000 failed jobs per queue are kept in Redis. Services enqueue only after their
transaction commits ([ADR 0009](../architecture/adr/0009-after-commit-effects.md)).

| Queue | Jobs | Enqueued by |
| --- | --- | --- |
| `moderation` | `moderation.scan` | Every create and edit of a post, comment, direct message, job and approach; company page edits; account profile edits (name, photo); publishing or editing a talent page |
| `media` | `media.process` (re-encode images without EXIF, thumbnails, durations) | Upload completion |
| `notifications` | `notifications.email` (the "while you were away" digest) | Schedule |
| `feed` | `feed.fanout` (the "new posts" pill for the author's network) | New posts |
| `import` | `import.run` (AI profile import: extract, generate, score badges) | `POST /api/profiles/me/imports`. The payload is the import id only; the file stays in storage |
| `maintenance` | the schedules below | Schedule |

Scheduled jobs are registered by every worker at boot with a fixed job id per schedule
([`worker.ts`](../../apps/api/src/worker.ts)), so running more workers does not duplicate them:

| Job | Every | What it does |
| --- | --- | --- |
| `maintenance.talent-housekeeping` | 15 minutes | Pending approaches past `expires_at` become EXPIRED; ACTIVE engagements whose completion request went unanswered for `trust.autoConfirmDays` complete; ratings of engagements whose rating window closed are revealed (and the ratee's average updated); AI import input older than `import.retentionHours` is purged; recruiter email codes expired for over a day are deleted ([`housekeeping.service.ts`](../../apps/api/src/services/housekeeping.service.ts)) |
| `maintenance.expire-uploads` | 30 minutes | Deletes uploads still PENDING after 24 hours, rejected ones, and finished uploads nothing references 48 hours after creation (rows and objects) |
| `maintenance.lift-suspensions` | 5 minutes | Ends timed account suspensions that ran out |
| `maintenance.reconcile-counters` | 6 hours | Recomputes every denormalised counter (connections, followers, posts, comments, reactions, company members and open jobs, job applications, endorsements) from the rows and fixes only those that drifted ([`counters.service.ts`](../../apps/api/src/services/counters.service.ts)) |
| `notifications.email` | 15 minutes | Emails one digest per user of notifications unread for over an hour and never emailed (at most one digest per user per 6 hours, 10 lines). Message requests and approaches appear as generic lines, never their text. Users who turned digests off are skipped |

Every step is a conditional update, so a job that runs twice, or on two workers at once, is
harmless. With `JOBS_MODE=inline` none of the schedules run.

## AI cost controls

The AI layer ([ai.md](../architecture/ai.md)) is the only part of the system whose cost grows
with what members do rather than with infrastructure. The levers:

| Lever | Where | Effect |
| --- | --- | --- |
| Turn it off | `AI_PROVIDER=none` (environment, restart) | No AI calls at all; the web app hides the import wizard and polish |
| Turn the import off | `import.enabled = false` (platform setting, immediate) | Import refuses (`503 IMPORT_DISABLED`); polish stays available while AI is |
| Imports per member per day | `import.perDay` (default 5) | Rate limited in Redis, shared by every API task |
| Polish per member per day | 50, fixed in [`import.service.ts`](../../apps/api/src/services/import.service.ts) | Rate limited the same way |
| Model | `OPENAI_MODEL` (default `gpt-4o-mini`), `OPENAI_TRANSCRIBE_MODEL`, `GEMINI_MODEL` | Pick the cheapest model that drafts well enough |
| Input size | [`integrations/ai/extract-text.ts`](../../apps/api/src/integrations/ai/extract-text.ts) | Document text is clamped before it reaches the model; pasted text is at most 30000 characters |

Each import records its `provider`, `model`, `tokens_in` and `tokens_out` on the
`profile_imports` row, so spend can be totalled with SQL. Moderation calls (`openai` provider)
are separate and are made on every create and edit; the `rules` provider makes none.

## Backups and recovery

### Database

RDS automated backups are kept 3 days in aws-dev and 14 in aws-prod (backup window 03:00 to
04:00 UTC), with point-in-time recovery inside that window. aws-prod runs Multi-AZ with
deletion protection; destroying it with protection off takes a final snapshot
`<name_prefix>-db-final` (aws-dev skips it). To restore, create a new instance from a snapshot
or a point in time, then point the deployment at it (or swap it in place of the original
identifier) and roll the services.

### Redis

ElastiCache snapshots are kept 1 day in aws-dev and 7 in aws-prod (window 02:00 to 03:00 UTC).
Redis holds no data that cannot be rebuilt, but losing it (or restoring an old snapshot) loses:

- queued and delayed jobs: scans, media processing, digests not yet run (content that was never
  scanned stays `UNCHECKED`; images never processed stay `COMPLETE` with their original bytes);
- queued imports (they stay QUEUED; the member can start a new one);
- the repeatable schedules (recreated when a worker restarts);
- presence (everyone appears offline until their next heartbeat, at most 30 seconds);
- rate-limit counters (budgets reset, including approach-send, contact-reveal and import
  budgets; the approach quota itself is counted from the `approaches` rows, so it survives);
- in-flight Socket.IO fan-out (clients refetch on reconnect).

### Media

The bucket has versioning on in AWS environments. Deleted or replaced objects remain as
noncurrent versions for 30 days (`noncurrent_version_days`), then expire; incomplete multipart
uploads are removed after a day. Current objects are never expired by the bucket: the API's
`maintenance.expire-uploads` job deletes pending uploads older than 24 hours, rejected uploads,
and finished uploads nothing references 48 hours after creation.

## Migrations

[`db/migrate.ts`](../../db/migrate.ts) applies `db/migrations/NNNN_*.sql` in filename order, each
in its own transaction, recording `name` and a SHA-256 checksum in `schema_migrations`.
Migrations are forward-only: an applied file must never change (the runner stops with
`changed after it was applied`); add a new file instead. A Postgres advisory lock (key `727101`)
makes concurrent runs safe: the second waits, then finds nothing to do.

| Where | How |
| --- | --- |
| Local compose | The `migrate` one-shot runs before `api` and `worker` start |
| AWS | `make aws-deploy` runs the migrate task before rolling out; `make aws-migrate ENV=...` runs it alone |
| Anywhere | `pnpm db:migrate` (or `--status` to list applied and pending) with `DATABASE_URL` set |
| On boot | `MIGRATE_ON_BOOT=true` makes each API task run them under the same lock (off by default) |

Because the migrate task runs before the new code rolls out, write migrations that the old code
tolerates (add columns and tables first, drop them in a later release).

## Rotating secrets

| Secret | Where | Rotate by | Effect |
| --- | --- | --- | --- |
| `JWT_SECRET` | `<name_prefix>/app` | Put a new secret version (keep `REFRESH_SECRET`, 32+ characters, different), then force a new deployment of api and worker | Every outstanding access token fails verification. Clients get `TOKEN_INVALID` and silently refresh with their cookie, so users stay signed in |
| `REFRESH_SECRET` | `<name_prefix>/app` | Same procedure | Refresh tokens are random values stored as SHA-256 hashes, not signed with this key, so sessions keep working. The value seeds the HMAC key for `STORAGE=local` media links only, which AWS does not use |
| Redis AUTH token | `<name_prefix>/redis` (whole `REDIS_URL`) | `terraform apply -replace=module.talent.module.cache.random_password.auth`, then roll api and worker | ElastiCache rotates with `auth_token_update_strategy = ROTATE`; tasks pick up the new `REDIS_URL` only when restarted |
| RDS master password | RDS-managed secret | Rotated by RDS | No action: the API reads the secret for each new connection and caches it for 60 seconds, so new connections use the new password and existing ones keep working |
| Application database role | `<name_prefix>/db-app` (when you created one, see below) | `ALTER ROLE ... PASSWORD`, then `put-secret-value` at once | Same per-connection read: new connections fail for at most the 60 s cache window; existing ones keep working |
| `TOTP_ENCRYPTION_KEY` | `<name_prefix>/totp` | Not rotated in place: it encrypts every stored TOTP secret, so a new key makes the existing ones unreadable | Rotate only with a re-encryption step in the API (none ships today); losing or replacing the key forces every user with two-factor sign-in to enroll again |
| CloudFront origin header | Terraform state only (`random_password.origin_verify`) | `terraform apply -replace='module.talent.random_password.origin_verify[0]'` | CloudFront and the listener rules update in the same apply; while the distribution change propagates (minutes), some requests can get 403 |
| `VIEW_HASH_SALT` | `<name_prefix>/views` | Put a new secret version, then roll api and worker | Only the de-duplication of today's signed-out profile views and the IP hashes of new contact-log rows change; nothing breaks |
| `OPENAI_API_KEY` | `<name_prefix>/openai` | `aws secretsmanager put-secret-value ...`, then roll api and worker | ECS injects secrets at task start, so running tasks keep the old key until replaced. The same key serves moderation and the AI layer |

The application secrets ignore later Terraform changes (`ignore_changes = [secret_string]`), so
a manual rotation is not rolled back by the next apply. To force a new deployment:

```bash
aws ecs update-service --cluster <cluster> --service api --force-new-deployment
aws ecs update-service --cluster <cluster> --service worker --force-new-deployment
```

Terraform state also contains the generated values; keep the state backend private.

## Least-privilege database role

By default the api and worker connect as the RDS master user (`talent_admin`), so a
compromised task has full DDL rights over the database. The recommended post-deploy step is a
non-master application role with data rights only, while migrations keep the master user. It is
deliberately not automated in Terraform: the role lives inside Postgres, and Terraform would
need a network path and credentials into the private database to manage it.

**1. Create the role.** Connect as the master user from somewhere inside the VPC (a bastion,
an SSM session, or a one-off task) with TLS (`sslmode=require`), using the password from the
RDS-managed secret. The endpoint and that secret's ARN:

```bash
aws rds describe-db-instances --db-instance-identifier <name_prefix>-db \
  --query 'DBInstances[0].[Endpoint.Address,MasterUserSecret.SecretArn]' --output text
```

Generate the new role's password first (`openssl rand -base64 33 | tr -d '/+='`) and keep it
out of shell history. Then, in the `talent` database:

```sql
-- Data rights only: no CREATE, no ownership, no DDL.
CREATE ROLE talent_app LOGIN PASSWORD '<generated password>';
GRANT CONNECT ON DATABASE talent TO talent_app;
GRANT USAGE ON SCHEMA public TO talent_app;

-- Everything that exists now.
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO talent_app;
GRANT USAGE, SELECT, UPDATE ON ALL SEQUENCES IN SCHEMA public TO talent_app;
GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA public TO talent_app;

-- Everything later migrations create. Migrations run as talent_admin, so the defaults are
-- set FOR ROLE talent_admin.
ALTER DEFAULT PRIVILEGES FOR ROLE talent_admin IN SCHEMA public
  GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO talent_app;
ALTER DEFAULT PRIVILEGES FOR ROLE talent_admin IN SCHEMA public
  GRANT USAGE, SELECT, UPDATE ON SEQUENCES TO talent_app;
ALTER DEFAULT PRIVILEGES FOR ROLE talent_admin IN SCHEMA public
  GRANT EXECUTE ON FUNCTIONS TO talent_app;

-- Postgres 15+ already denies CREATE on public to PUBLIC; make it explicit.
REVOKE CREATE ON SCHEMA public FROM PUBLIC;
```

Check it: `SET ROLE talent_app; SELECT count(*) FROM users;` works, and
`CREATE TABLE t (x int);` fails with `permission denied for schema public`.

**2. Store its credentials as a second secret**, encrypted with the deployment's KMS key, in the
same `{"username","password"}` shape as the RDS-managed secret (the API reads the `password`
field):

```bash
aws secretsmanager create-secret --name <name_prefix>/db-app \
  --kms-key-id alias/<name_prefix> \
  --secret-string '{"username":"talent_app","password":"<generated password>"}'
```

**3. Point the api and worker at it** in `terraform.tfvars`, then `make aws-deploy` (or
`terraform apply` and a forced new deployment):

```hcl
app_db_secret_arn = "arn:aws:secretsmanager:<region>:<account>:secret:<name_prefix>/db-app-XXXXXX"
app_db_username   = "talent_app"
```

The deployment module then sets `DATABASE_SECRET_ARN` and `DB_USER` of the api and worker to
that secret and role, and their task role may read only that secret. The migrate and admin tasks
keep the master secret. Keep `migrate_on_boot = false` (the default): with it on, the API would
try to run migrations as `talent_app` and fail. To go back, remove the two lines and apply.

## Operator queues

Three queues need people. Who works them, and how, is in the playbooks:

| Queue | Area of `/admin` | Roles | Playbook |
| --- | --- | --- | --- |
| Recruiter approvals and companies | recruiters, companies | RECRUITER_OPS, ADMIN | [recruiter-verification.md](recruiter-verification.md) |
| Moderation cases and appeals | moderation | MODERATOR, ADMIN | [moderation-playbook.md](moderation-playbook.md) |
| Complaints and ratings | complaints | MODERATOR, ADMIN | [moderation-playbook.md](moderation-playbook.md) |

`GET /api/admin/stats` (the overview) counts pending recruiter reviews, open cases and open
complaints; `GET /api/moderation/stats` counts open cases, open appeals and today's actions.
Connected staff also get the open-case count live (`moderation:queue` socket event).

Operational points about moderation:

- **Thresholds and provider** are platform settings, not environment
  ([configuration.md](configuration.md#platform-settings)). After the first settings save,
  changing `MODERATION_PROVIDER` has no effect; switch with `PATCH /api/admin/settings`.
- **Content stuck `UNCHECKED`.** The scan job throws on provider failure so BullMQ retries it
  (5 attempts, exponential backoff from 5 s). After the last attempt the item stays `UNCHECKED`
  and visible, with no case. Typical causes: an invalid OpenAI key, the provider unreachable
  through the NAT, or moderation switched off. A placeholder or missing OpenAI key with
  `moderation.provider = openai` does not fail scans: the `rules` provider is used and a warning
  is logged once per process. Held (pre-moderated) posts do not depend on the scan: their
  PREMODERATION case opens in the same transaction as the post.
- **Re-scanning.** There is no re-scan endpoint. Editing a post, comment, message, job, company
  page or talent page enqueues a new scan; otherwise act on the item from a report or case.
- **Failed jobs** are kept in Redis (the last 5000 per queue, `removeOnFail`), completed ones
  the last 1000. Inspect them with any BullMQ tool or `redis-cli` (`bull:<queue>:failed`).

## Routine checks

- The alarm topic has a confirmed subscription.
- SES is out of the sandbox and the domain identity shows DKIM verified.
- The worker log shows no repeating job failures (the `worker-failed-jobs` alarm is quiet).
- `GET /api/moderation/stats` shows no growing backlog of open cases or appeals, and the
  recruiter approval queue and open complaints in the `/admin` overview are being worked.
- AI spend (token totals on `profile_imports`) is where you expect it.
- RDS storage and connection headroom.
- Images in ECR are within the lifecycle limit you want for rollbacks.
