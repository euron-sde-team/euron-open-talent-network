# ADR 0001: One talent network per deployment

## Status

Accepted.

## Context

Euron Open Talent is a self-hostable talent network: candidates publish profiles, companies
keep pages, verified recruiters post jobs, run pipelines and approach candidates, and
everyone shares a feed and direct messages. An operator (a university, an industry body,
a regional hiring association) runs it for one audience.

A multi-tenant design (several isolated networks in one database) costs a tenant key on
every row, a scoped repository, tenant-aware caches, socket rooms, rate-limit keys and job
payloads, and an operator plane above the networks. The core features are cross-cutting
by nature: talent search, people suggestions, the home feed, messaging, presence and
company follows all assume that everyone on the deployment can, in principle, find
everyone else.

It is tempting to treat companies as tenants. They are not: a candidate applies to many
companies, a recruiter's approach crosses company lines by definition, and a company page
is public content inside the network.

## Decision

- One deployment serves exactly one network. There is no tenant table and no `tenant_id`
  column ([`db/migrations/0001_init.sql`](../../../db/migrations/0001_init.sql)).
- **Companies are pages inside the network**, not tenants. A `companies` row has a public
  page, followers, jobs and posts; its `domains` and `auto_approve_domain` only serve
  recruiter verification ([ADR 0015](0015-recruiter-verification-work-email-and-review.md)).
- **A recruiter belongs to one company at a time.** `recruiters.user_id` is `UNIQUE`; the
  row is both the team membership (`OWNER`, `ADMIN`, `RECRUITER`) and the verification
  record. Company scoping is a predicate on `company_id` in the services that need it
  (pipelines, notes, saved candidates), checked through `requireRecruiter`
  ([`services/recruiter.service.ts`](../../../apps/api/src/services/recruiter.service.ts)).
- Network-wide configuration is one `settings` row (`key = "platform"`) edited by
  platform admins ([`services/settings.service.ts`](../../../apps/api/src/services/settings.service.ts)).
- Platform roles (`USER`, `MODERATOR`, `RECRUITER_OPS`, `ADMIN`) live on `users.role`;
  the `/admin` console is part of the same API (`/api/admin`) and web app, gated per area
  by [`domain/admin-permissions.ts`](../../../apps/api/src/domain/admin-permissions.ts).
- Several networks means several deployments (separate database, Redis, bucket, domain).

## Consequences

Positive:

- Queries, indexes and caches carry no tenant predicate, so there is no tenant leak to get
  wrong. Visibility is about blocks, post visibility, profile section audiences and
  company membership ([`repositories/visibility.ts`](../../../apps/api/src/repositories/visibility.ts),
  [`domain/profile.ts`](../../../apps/api/src/domain/profile.ts)).
- Global unique keys are natural: usernames, emails, company slugs and recruiter work
  emails are unique per network.
- Search, presence, messaging and the feed need no partitioning.

Trade-offs:

- Hosting many small networks costs one stack each (database, cache, NAT, load balancer).
- No shared identity across networks: a person has one account per deployment.
- A recruiter working for two companies needs two accounts, or has to leave one company
  first (`DELETE /api/recruiter/me`).
- Network-wide policy (moderation thresholds, approach quotas, the publish threshold)
  cannot differ per company, except the per-recruiter quota override
  (`recruiters.approach_quota_daily`).

## Alternatives considered

- **Multi-tenant with a tenant column.** Lower cost per network for a hosted service, but
  every query, room name, rate-limit key and job payload would need the tenant, for an
  audience that mostly self-hosts one network.
- **Companies as tenants.** Would wall candidates off per employer and break approaches,
  applications across companies and the shared directory, which define the product.
- **Recruiters on several companies (a join table).** More flexible, but quotas, contact
  unlocks and pipeline access would all need a "which company is acting" choice per
  request, and consent given to a recruiter at one company would be ambiguous.
