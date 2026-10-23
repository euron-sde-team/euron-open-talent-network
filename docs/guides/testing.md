# Testing

Five layers, each runnable locally with one command:

| Layer | Command | Needs |
| --- | --- | --- |
| Unit tests (every package) | `make test` (`pnpm test`) | Node 22, pnpm |
| API integration tests | `make test-integration` | Docker (Postgres and Redis from compose) |
| Integration tests under every backend | `make test-matrix` | The full local stack (`make up`) and `redis-cli` on the host |
| Browser end-to-end tests | `make e2e` (or `pnpm e2e`) | The full local stack with demo data, Playwright browsers |
| Browser QA by hand | `make up && make demo` | A browser |

Plus static gates: `make lint`, `make typecheck`, the OpenAPI check, the Terraform checks and
the sanitization scan.

## Unit tests

```bash
make test          # turbo run test: every package's vitest suite
pnpm --filter @open-talent/api test
```

API unit tests live in [`apps/api/test/unit`](../../apps/api/test/unit) and pin the pure rules
in [`apps/api/src/domain`](../../apps/api/src/domain) and the integrations that can run
without a database:

| Area | Examples |
| --- | --- |
| Talent pages | completeness and the publish gate, section audiences, open-to-work visibility, the Bayesian rating display (`profile.test.ts`); months and years of experience (`months.test.ts`); usernames and reserved handles; display-name cleaning (no emails or phone numbers in names); `safeUrl` |
| Recruiting | work-email domain matching, free-mail detection and the review route (`recruiter-verification.test.ts`); approach blocks, rating edits, windows and reveal (`trust.test.ts`); `canMoveStage` and skill match (`pipeline.test.ts`); screening answers |
| Messaging | `canMessage` (`can-message.test.ts`), sending into a thread and the request cap (`dm-send.test.ts`), unread math |
| AI | the proposal sanitiser, PII stripping, `aiAvailable` (`ai-sanitiser.test.ts`); the evidence gate for badges (`badges.test.ts`) |
| Moderation | `decideModeration`, the report auto-hide threshold, the providers against the in-process AI stub (OpenAI wire format), the rules provider |
| Platform | `/admin` area permissions, media allowlist and magic bytes, mentions, search text, ranking, slugs, logger redaction, request hardening |

The shared packages have their own suites:
[`packages/api-client/test`](../../packages/api-client/test/http.test.ts) (the HTTP client's
refresh dance, pagination, the socket controller, uploads) and
[`packages/ui/test`](../../packages/ui/test/components.test.tsx). The web app's component and
utility tests are in [`apps/web/test`](../../apps/web/test/setup.ts).

## Integration tests

```bash
make test-integration
```

This runs [`scripts/test-db.sh`](../../scripts/test-db.sh) (starts the compose Postgres and Redis
if nothing answers on ports 5482 and 6419), then the suite with:

```bash
TEST_DATABASE_URL=postgres://talent:talent@localhost:5482/talent_test \
TEST_REDIS_URL=redis://localhost:6419/1 \
pnpm test:integration
```

How it works ([`vitest.integration.config.mts`](../../vitest.integration.config.mts)):

- The real Express app and Socket.IO gateway run in-process (supertest and `socket.io-client`)
  against a real Postgres and Redis ([`harness.ts`](../../apps/api/test/integration/harness.ts)).
- The global setup drops and recreates the database, then applies every migration once per
  run. [`guard.ts`](../../apps/api/test/integration/guard.ts) refuses any `TEST_DATABASE_URL`
  whose database name does not end in `_test`.
- [`env.ts`](../../apps/api/test/integration/env.ts) sets `NODE_ENV=test`, `JOBS_MODE=inline`
  (job handlers run right after commit, so assertions are deterministic), `BCRYPT_ROUNDS=4`, and
  defaults of `STORAGE=local`, `MAIL_MODE=outbox`, `MODERATION_PROVIDER=rules`, unless the
  environment overrides them. Mail is read back from the in-memory outbox.
- `AI_PROVIDER` is not set, so AI is unavailable by default. The import suite starts the AI
  stub in-process on an ephemeral port and switches the live config to `stub` for its own
  tests.
- Rate limits are off unless a test turns them on (`RATE_LIMITS`, `RATE_LIMIT_STORE=redis`).
- Files share one database, so they run one at a time (`fileParallelism: false`); every test
  creates its own people, companies and jobs and never depends on another.
  [`talent-fixtures.ts`](../../apps/api/test/integration/talent-fixtures.ts) builds them
  through the public API: a published talent page, an ACTIVE recruiter of a new company, an
  OPEN job, an application, a pending approach.

Run one file:

```bash
TEST_DATABASE_URL=postgres://talent:talent@localhost:5482/talent_test \
  pnpm exec vitest run --config vitest.integration.config.mts approaches
```

The suites ([`apps/api/test/integration`](../../apps/api/test/integration)) cover auth and
sessions, users and blocks, the network, talent pages and imports, recruiters and companies,
approaches and contact unlock, jobs and applications, trust (engagements, ratings,
complaints), search, posts and comments, DMs, media, notifications, reports, moderation,
appeals, admin, audit, authorization across roles, request hardening, and the realtime
gateway.

## The backend matrix

```bash
make up            # Postgres, Redis, Floci, Mailpit and the AI stub must be reachable
make test-matrix
```

[`scripts/test-matrix.sh`](../../scripts/test-matrix.sh) runs the whole integration suite 12
times, once per combination:

| Option | Values |
| --- | --- |
| `STORAGE` | `local`, `s3` (Floci) |
| `MAIL_MODE` | `outbox`, `smtp` (Mailpit), `ses` (Floci, relayed to Mailpit) |
| `MODERATION_PROVIDER` | `rules`, `stub` |

Each row gets its own database (`talent_matrix_NN_test`) and its own Redis logical database
(1 to 12, flushed first with `redis-cli`, which must be installed on the host), so no state
carries over. It prints a table and exits non-zero if any row fails.

Narrow it down:

```bash
make test-matrix ONLY=s3           # only rows whose label contains "s3"
make test-matrix ONLY="mail=ses"   # one mail mode
make test-matrix FILTER=media      # pass a file filter to vitest
```

The script checks that every dependency answers first and tells you to `make up` otherwise.

## Browser end-to-end tests

```bash
make e2e                       # = make up, make demo, then pnpm e2e
pnpm e2e                       # against a stack that is already up and seeded
pnpm e2e tests/01-auth.spec.ts # one spec
E2E_HEADED=1 pnpm e2e          # watch it
```

Playwright is configured in [`e2e/playwright.config.ts`](../../e2e/playwright.config.ts):
Chromium at 1440x900, base URL `E2E_BASE_URL` (default `http://localhost:3520`), one worker
because the specs share one stack and its platform settings, no retries locally (one on CI),
traces and screenshots kept on failure, HTML report in `e2e/.report`, artefacts in
`e2e/.results`.

[`e2e/helpers.ts`](../../e2e/helpers.ts) sets tests up through the REST API (`E2E_API_URL`,
default `http://localhost:5016/api`), never the database, and reads mail back from Mailpit
(`E2E_MAILPIT_URL`, default `http://localhost:8036`). The demo password is read from
`deploy/compose/.env` (`TALENT_DEMO_PASSWORD`) or `E2E_DEMO_PASSWORD`; it is never written in
a test. Each simulated person gets their own client address (`X-Forwarded-For`, honoured by
the local stack's single trusted proxy hop), so the per-IP sign-in budgets apply per person.

The specs live in [`e2e/tests`](../../e2e/tests) and are being extended together with the web
app.

## Browser QA by hand

The demo seed is built for manual checks: every flow has data at every state. Sign in as the
accounts in [quickstart-local.md](quickstart-local.md#sign-in) (the password is printed by
`make demo`) and follow [walkthrough.md](walkthrough.md). Things worth checking on every
change that touches them:

- **Privacy**: a candidate's contact details never appear on `/in/<username>`, in search, or in
  an application; they appear for a recruiter only after the candidate accepts an approach and
  shares that channel, and the reveal shows up in the candidate's contact log.
- **Sections and open-to-work**: switch a section's audience (PUBLIC, CONNECTIONS, RECRUITERS)
  and the open-to-work mode, then view the page signed out, as a connection and as a
  recruiter.
- **Pipeline**: open the same job's board in two browsers as two recruiters of the company and
  move a card; the other board updates, and the candidate's `/jobs/applications` timeline shows
  the stage without the team note.
- **Messaging**: message someone you are not connected to and check it lands in their requests
  (or is refused under their policy).

### AI stub markers

The stub ([`apps/ai-stub`](../../apps/ai-stub/README.md)) is deterministic, so the same input
always gives the same output:

| Input | Result |
| --- | --- |
| `[[mod:harassment=0.97]]` (any category, several allowed) in text | That moderation score; everything else scores 0.01. Use a value above the category's `hide` threshold to see an automatic hide, between `review` and `hide` for a review case |
| An image URL containing `flag-image` | `sexual=0.99` (local signed media URLs are decoded to check the storage key) |
| Import text with lines like `Title at Company (2019-2023)`, known skill names, URLs, schools | A proposal with those roles, skills, links and education |
| Any import | One badge that quotes the text verbatim (kept) and one decoy whose quote is not in the text (dropped by the evidence gate) |
| A voice note | A fixed transcript |
| `[[ai:fail]]` anywhere | HTTP 500, for error paths (the import ends FAILED, polish answers `502 AI_FAILED`) |

## API reference check

`pnpm openapi` (`make openapi`) regenerates [`docs/api/openapi.yaml`](../api/openapi.yaml) from
the route files with [`scripts/gen-openapi.ts`](../../scripts/gen-openapi.ts);
`pnpm openapi --check` fails when the committed file does not match the routes.

## Infrastructure checks

| Command | Does |
| --- | --- |
| `make tf-fmt` (`CHECK=1` to only check) | `terraform fmt -recursive` |
| `make tf-validate` | `fmt -check`, then `init -backend=false` and `validate` for `local-floci`, `aws-dev` and `aws-prod` |
| `make tf-lint` | tflint on every module and environment (plugins cached in a Docker volume) |
| `make tf-security` | checkov with [`infra/terraform/.checkov.yaml`](../../infra/terraform/.checkov.yaml); any unskipped finding fails. Each skip is justified inline next to the resource |
| `make sanitize` | [`scripts/check-sanitization.sh`](../../scripts/check-sanitization.sh): scans committable files for credentials, account ids, real email addresses and IPs |

Without a local `terraform`, the Makefile uses the pinned `hashicorp/terraform:1.16.6`
container (see [troubleshooting.md](troubleshooting.md#stale-terraform-directories) for stale
`.terraform` directories).

## Continuous integration

[`.github/workflows/checks.yml`](../../.github/workflows/checks.yml) runs on pushes to `main` and
on pull requests: lint, typecheck, unit tests, `pnpm openapi --check`, the sanitization scan,
and Terraform `fmt` and `validate` for every environment.

The full pipeline is kept in [`.github/workflows-full`](../../.github/workflows-full/README.md) so it
does not run upstream: integration tests on Postgres and Redis service containers, gitleaks,
CodeQL and `pnpm audit`, tflint and checkov, multi-architecture image builds, and the e2e
workflow (the matrix plus the browser tests on the emulated stack). Move the files into
`.github/workflows/` in a fork to enable them.
