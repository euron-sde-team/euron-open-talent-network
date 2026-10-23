# Local stack against real AWS

`make up` runs everything against the Floci emulator. `make up-aws` runs the same local
containers against real AWS resources instead: media goes to a real S3 bucket and mail through
real SES. Use it to check behaviour that an emulator cannot prove (bucket policies, KMS,
SES deliverability) before deploying, or to debug against an `aws-dev` environment.

The overlay is [`deploy/compose/compose.aws.yaml`](../../deploy/compose/compose.aws.yaml), on top
of the same base [`compose.yaml`](../../deploy/compose/compose.yaml) used by the quickstart.

## What stays local and what does not

| Component | `make up` | `make up-aws` |
| --- | --- | --- |
| Web, API, worker, migrate | containers | containers |
| PostgreSQL | container | container |
| Redis | container | container |
| AI stub | container (`AI_PROVIDER=stub`, `MODERATION_PROVIDER=stub`) | container; `AI_PROVIDER` stays `stub` unless you override it, `MODERATION_PROVIDER` comes from `.env.aws` |
| Mailpit | receives all mail | still running, but mail goes through real SES |
| Media | Floci S3 | your real bucket (`STORAGE=s3`) |
| Mail | Floci SES, relayed to Mailpit | real SES (`MAIL_MODE=ses`) |

The database stays local, so `make up-aws` never touches the `aws-dev` RDS instance or its
data.

## Prerequisites

- An AWS profile with credentials for the target account. The overlay mounts `~/.aws`
  read-only into the `api`, `worker` and `migrate` containers and sets `AWS_PROFILE`
  (default `default`).
- A media bucket and an SES identity. The simplest source is an `aws-dev` deployment
  ([deploy-aws.md](deploy-aws.md)); any bucket and verified identity you created yourself work
  too.
- The bucket's CORS rule must allow the local web origin, or browser uploads fail. In
  `infra/terraform/envs/aws-dev/terraform.tfvars` set:

  ```hcl
  media_cors_extra_origins = ["http://localhost:3520"]
  ```

  and apply. The deployment module adds these origins to the app origin
  ([`modules/deployment/main.tf`](../../infra/terraform/modules/deployment/main.tf)).
- While SES is in the sandbox, it delivers only to verified addresses. Verify the addresses
  you will sign up with (and the work emails you will use for recruiter codes), or request
  production access.

## Configure

```bash
cp deploy/compose/.env.aws.example deploy/compose/.env.aws
```

Fill in the values from `terraform output` in `infra/terraform/envs/aws-dev`
([`.env.aws.example`](../../deploy/compose/.env.aws.example)):

| Variable | Value |
| --- | --- |
| `AWS_REGION`, `S3_REGION`, `SES_REGION` | The deployment region |
| `S3_BUCKET` | `terraform output media_bucket` |
| `SES_CONFIGURATION_SET` | `terraform output mail_configuration_set` |
| `MEDIA_ORIGINS` | `https://<bucket>.s3.<region>.amazonaws.com` (the web CSP must allow presigned media URLs) |
| `MAIL_FROM` | `Euron Open Talent <no-reply@<your verified SES domain>>` (required: SES refuses an unverified sender) |
| `MODERATION_PROVIDER` | `rules` in the example; `stub` uses the local stub container, `openai` also needs an `OPENAI_API_KEY` line |

Optional additions, all read through the base file's `${NAME:-default}` interpolations:
`AI_PROVIDER` (`openai`, `gemini`, `stub` or `none`), `OPENAI_API_KEY`, `OPENAI_MODEL`,
`GEMINI_API_KEY`, `PRODUCT_NAME`, `LOG_LEVEL`.

The example holds no secrets: credentials come from the mounted profile. The file is
git-ignored; if you add a provider key to it, it stays on your machine.

## Start

```bash
make up-aws
```

The target refuses to start without `deploy/compose/.env.aws`. It also runs `make env` first,
so the local signing secrets and the view-hash salt exist.

`make demo` and `make admin` are written against the Floci file list. Both stacks share the
compose project name `open-talent`, so `exec` reaches the running containers either way; if you
prefer to be explicit, run the command with the AWS file list:

```bash
docker compose --env-file deploy/compose/.env --env-file deploy/compose/.env.aws \
  -f deploy/compose/compose.yaml -f deploy/compose/compose.aws.yaml \
  exec -T -e DEMO_PASSWORD="$(grep '^TALENT_DEMO_PASSWORD=' deploy/compose/.env | cut -d= -f2-)" api node dist/cli.js demo:seed
```

The demo seed uploads its generated avatars, logos and covers to the real bucket.

`make down` stops both variants and deletes the local volumes. It does not delete anything in
S3: uploaded objects stay in the bucket (the API's expiry job only runs while a worker is up).

## Notes

- `S3_PUBLIC_ENDPOINT` is unset here, so presigned URLs use the bucket's regional endpoint and
  the API's own client. The `requestChecksumCalculation: "WHEN_REQUIRED"` setting in
  [`integrations/storage.ts`](../../apps/api/src/integrations/storage.ts) matters here as much as
  on AWS; see [troubleshooting.md](troubleshooting.md#presigned-upload-fails-with-baddigest-or-a-checksum-error).
- How `.env.aws` wins: compose gives `environment:` precedence over `env_file:`, so the base
  file writes every value an env file may change as `${NAME:-default}` (for example
  `MAIL_FROM: ${MAIL_FROM:-... <no-reply@talent.example.test>}`), and `make up-aws` passes
  `.env.aws` as a second `--env-file`, so those interpolations resolve to its values. Keys the
  base does not set (`S3_BUCKET`, `MEDIA_ORIGINS`, ...) arrive through `env_file:`. Highest
  first: the overlay's own `environment:` (`STORAGE=s3`, `MAIL_MODE=ses`, `MAIL_FROM`), your
  shell, `.env.aws`, `.env`, the defaults. Check the result with
  `docker compose --env-file deploy/compose/.env --env-file deploy/compose/.env.aws -f deploy/compose/compose.yaml -f deploy/compose/compose.aws.yaml config api`.
- `MODERATION_PROVIDER` from `.env.aws` seeds the platform settings only until the first
  settings save; after that the effective provider is read from platform settings (see
  [configuration.md](configuration.md#the-moderation-provider-lives-in-settings)). `AI_PROVIDER`
  is environment only and takes effect on restart.
- The local web app is plain HTTP, so `COOKIE_SECURE` stays `false` from the base compose file.
