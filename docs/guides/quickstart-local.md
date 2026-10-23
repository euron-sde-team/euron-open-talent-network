# Quickstart: run Euron Open Talent locally

This guide starts the complete stack on your machine: the web app, the API, the background
worker, PostgreSQL, Redis, a mail catcher, a deterministic fake AI provider (moderation,
profile import, badges and polish), and an AWS emulator (Floci) provisioned by the same
Terraform modules that build production. You do not need an AWS account or an AI provider key.

The stack is defined in [`deploy/compose/compose.yaml`](../../deploy/compose/compose.yaml)
(the cloud-agnostic base) plus [`deploy/compose/compose.floci.yaml`](../../deploy/compose/compose.floci.yaml)
(the emulated AWS overlay). The [`Makefile`](../../Makefile) wraps both.

## Prerequisites

| Requirement | Notes |
| --- | --- |
| Docker with Compose v2 | `make up` runs `docker compose ... up -d --build --wait` |
| GNU Make and `openssl` | `make env` generates local secrets with `openssl rand` ([`scripts/gen-local-env.sh`](../../scripts/gen-local-env.sh)) |
| Free host ports | 3520, 5016, 5482, 6419, 8036, 1036, 4587, 5109, all bound to `127.0.0.1` (see [Ports](#ports)) |
| Node 22 and pnpm 9.15.0 | Only to run tests or the apps outside Docker. Node is pinned in `.nvmrc`, pnpm in `package.json` (`packageManager`) |

To install pnpm through Corepack:

```bash
corepack enable
corepack prepare pnpm@9.15.0 --activate
pnpm install
```

## Start the stack

From the repository root:

```bash
make up
```

This does four things, in order:

1. `make env` writes `deploy/compose/.env` with random, local-only values for
   `TALENT_JWT_SECRET`, `TALENT_REFRESH_SECRET`, `TALENT_TOTP_ENCRYPTION_KEY`,
   `TALENT_VIEW_HASH_SALT` and `TALENT_DEMO_PASSWORD`. It never overwrites a value and never
   prints one; an older file only gains the keys added since it was written. Delete the file to
   regenerate everything.
2. Builds the images (the API image is used by `api`, `worker` and `migrate`; the web image;
   the AI stub) and starts Postgres, Redis, Mailpit, the AI stub and Floci.
3. A one-shot `terraform` container waits for Floci, then applies
   [`infra/terraform/envs/local-floci`](../../infra/terraform/envs/local-floci/main.tf): the
   media bucket `open-talent-local-media` with SSE-KMS and a CORS rule for
   `http://localhost:3520`, the KMS key, Secrets Manager secrets, a Route53 zone and the SES
   identity `talent.example.test` with DKIM. Its state lives in the `tfdata` volume.
4. The one-shot `migrate` container applies [`db/migrations`](../../db/migrations/0001_init.sql),
   then `api`, `worker` and `web` start. `--wait` returns when the services are healthy.

When it finishes, `make up` prints the URLs. Then seed demo data:

```bash
make demo
```

`make demo` runs `node dist/cli.js demo:seed` inside the API container
([`apps/api/src/demo/seed.ts`](../../apps/api/src/demo/seed.ts)) and prints the logins and the
shared password. It creates a fictional hiring network: 8 invented companies on reserved
`.example` domains (most verified, one recruiter application waiting in the review queue),
about 40 people with full talent pages (experience, education, skills with endorsements,
projects, links, open-to-work signals and private contact details), a connection graph and a
feed, applications at every pipeline stage, recruiter approaches (pending, accepted with shared
channels, declined), conversations, engagements with revealed double-blind ratings, and open
complaints. Avatars and logos are generated shapes, never photos. The seed goes through the
real services, so counters, notifications and moderation records are what real use would
produce. It refuses to run with `NODE_ENV=production`, and a second run only prints the logins.

Every demo account shares one password. `make demo` prints it; it is also
`TALENT_DEMO_PASSWORD` in `deploy/compose/.env`:

```bash
grep TALENT_DEMO_PASSWORD deploy/compose/.env
```

## Sign in

Open <http://localhost:3520> and sign in with one of the demo emails and the demo password.

| Who | Email | What they show |
| --- | --- | --- |
| Admin | `admin@example.com` | Platform ADMIN: every area of `/admin` (settings, audit, erasure) |
| Moderator | `quinn.avery@example.com` | MODERATOR: the case desk, complaints, people and jobs areas |
| Recruiter operations | `rowan.pike@example.com` | RECRUITER_OPS: the recruiter approval queue and companies |
| Recruiter | `harper.lindqvist@example.com` | OWNER of the Northwind Labs company page: jobs, pipelines, talent search, approaches |
| Candidate | `juniper.vale@example.com` | A member with a published talent page (about 30 more are seeded) |

[walkthrough.md](walkthrough.md) is a guided tour through these accounts.

To try sign-up instead, use any address: registration is open by default and email
verification is required (`REQUIRE_EMAIL_VERIFICATION=true` in the compose file), so the
verification link arrives in Mailpit. A new account starts with a DRAFT talent page; nothing
is published until its owner publishes it.

## Where things are

| What | URL |
| --- | --- |
| Web app | <http://localhost:3520> |
| API readiness | <http://localhost:5016/api/ready> |
| Mailpit (every email the stack sends) | <http://localhost:8036> |
| Floci (S3, SES, KMS, Secrets Manager) | <http://localhost:4587> |
| AI stub | <http://localhost:5109/health> |
| PostgreSQL | `postgres://talent:talent@localhost:5482/talent` |
| Redis | `redis://localhost:6419` |

The browser only talks to the web app. Next.js proxies `/api/*` and `/socket.io/*` to the API
([`apps/web/next.config.ts`](../../apps/web/next.config.ts)), so the refresh cookie is
first-party exactly as it is behind the load balancer on AWS. The API port is published for
`curl` and the test tools.

### Mail

With the Floci overlay the API runs with `MAIL_MODE=ses`. The emulator's SES relays every
message to Mailpit (`FLOCI_SERVICES_SES_SMTP_HOST: mailpit`), so verification emails, password
resets, recruiter work-email codes and notification digests all show up at
<http://localhost:8036>.

### Media

With the Floci overlay `STORAGE=s3`. Presigned upload and download URLs point at
`http://localhost:4587` (`S3_PUBLIC_ENDPOINT`), while the API talks to the emulator on the
compose network. The web app's Content-Security-Policy allows that origin through
`MEDIA_ORIGINS`.

### AI and moderation

The compose file sets `AI_PROVIDER=stub` and `MODERATION_PROVIDER=stub`. Both point at
[`apps/ai-stub`](../../apps/ai-stub/README.md), a dependency-free fake that speaks the OpenAI
wire format:

- **Profile import** (paste text, upload a resume or a voice note at `/profile/setup`) returns a
  proposal built from the text with simple patterns (`Title at Company (2019-2023)`, known
  skills, URLs, schools), so the import wizard works end to end with no key.
- **Badges**: the stub proposes one badge that quotes the text verbatim and one decoy whose
  quote is not in the text; the API drops the decoy, which is the evidence gate at work.
- **Moderation** scores are low unless the text carries a marker such as
  `[[mod:harassment=0.97]]`, or an image URL contains `flag-image`. Post something with a marker
  to see a case open on the moderation desk.
- The marker `[[ai:fail]]` anywhere in the input makes the stub answer 500, for error paths.

To use a real model locally, put `AI_PROVIDER=openai` and `OPENAI_API_KEY=...` (or
`AI_PROVIDER=gemini` and `GEMINI_API_KEY=...`) in `deploy/compose/.env` and run `make up` again;
`AI_PROVIDER=none` hides the AI features. See [configuration.md](configuration.md#ai) and
[ai.md](../architecture/ai.md). The moderation pipeline is in
[moderation.md](../architecture/moderation.md).

## Create an administrator

To promote your own account (or create one) on the local stack:

```bash
make admin EMAIL=you@example.com
```

This runs `node dist/cli.js admin:create --email ...` in the API container
([`apps/api/src/cli.ts`](../../apps/api/src/cli.ts),
[`services/admin-bootstrap.service.ts`](../../apps/api/src/services/admin-bootstrap.service.ts)).
Because the local stack sends mail (`MAIL_MODE=ses`), the CLI does not print a password: it
emails a set-password link, which lands in Mailpit, and prints that it did so. If the link
cannot be sent, it creates nothing, prints why and exits non-zero; rerun with
`--print-password` on your own machine to get a one-time password instead. For an existing
email the command only promotes the account to ADMIN and sets it ACTIVE and verified; its
password is left as it is (use "Forgot password" if you need a new one).

Other staff roles (MODERATOR, RECRUITER_OPS) are given from the people area of `/admin` by an
ADMIN.

## Day-to-day commands

| Command | Does |
| --- | --- |
| `make ps` | Status of every container |
| `make logs SERVICE=api` | Tail one service (`api`, `worker`, `web`, `migrate`, `floci`, `terraform`, `ai-stub`, ...) |
| `make down` | Stop the stack and delete its volumes |
| `make help` | List every target |

### Running the apps outside Docker

For fast edit loops, start only the dependencies and run the apps with pnpm:

```bash
docker compose --env-file deploy/compose/.env -f deploy/compose/compose.yaml up -d --wait postgres redis mailpit ai-stub
pnpm --filter @open-talent/api dev          # API on 5016 (tsx watch)
pnpm --filter @open-talent/api dev:worker   # worker
pnpm --filter @open-talent/web dev          # web on 3520 (next dev)
```

Outside compose the API reads its own environment: without `DATABASE_URL` it connects to the
compose Postgres on 5482, `REDIS_URL` defaults to `redis://localhost:6419`, and the defaults
are `STORAGE=local`, `MAIL_MODE=outbox` and `AI_PROVIDER=openai` (unavailable without a key).
Export `AI_PROVIDER=stub`, `MODERATION_PROVIDER=stub` and `MAIL_MODE=smtp` with `SMTP_PORT=1036`
to match the compose behaviour. Apply migrations with `pnpm db:migrate` first.

## Ports

Every published port is bound to `127.0.0.1` and can be changed in `deploy/compose/.env` (or
your shell) if it clashes with something else:

| Service | Host port | Variable |
| --- | --- | --- |
| Web | 3520 | `TALENT_WEB_PORT` |
| API | 5016 | `TALENT_API_PORT` |
| PostgreSQL | 5482 | `TALENT_PG_PORT` |
| Redis | 6419 | `TALENT_REDIS_PORT` |
| Mailpit UI | 8036 | `TALENT_MAILPIT_PORT` |
| Mailpit SMTP | 1036 | `TALENT_SMTP_PORT` |
| Floci | 4587 | `TALENT_FLOCI_PORT` |
| AI stub | 5109 | `TALENT_STUB_PORT` |

Changing `TALENT_WEB_PORT` also changes `APP_WEB_URL`, `PUBLIC_API_URL`, `CORS_ORIGINS` and the
bucket CORS origin, because the compose files and the `terraform` one-shot derive them from it.
Run `make down` first so the bucket is recreated with the new origin.

## Reset

```bash
make down    # deletes the database, Redis, media, emulator and Terraform state volumes
make up
make demo
```

`make down` removes every volume (`pgdata`, `redisdata`, `mediadata`, `flocidata`, `tfdata`), so
the next `make up` starts from an empty database and a freshly provisioned emulator.
`deploy/compose/.env` survives, so the demo password stays the same.

## Next steps

- [Walkthrough: a tour with the demo accounts](walkthrough.md)
- [Local stack against real AWS](local-with-aws.md)
- [Deploy to AWS](deploy-aws.md)
- [Configuration reference](configuration.md)
- [Testing](testing.md)
- [Troubleshooting](troubleshooting.md)
