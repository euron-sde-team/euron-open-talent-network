# ADR 0002: Relational schema, timestamptz(3) and ULID keys

## Status

Accepted.

## Context

A talent network is relational: connections, follows, blocks, reactions, applications,
approaches, contact unlocks, ratings, DM participants and reports are links with
uniqueness rules that must hold under concurrency (one connection per pair, one
application per job per person, one pending approach per recruiter and candidate, one
rating per side of an engagement, one open case per target, one 1:1 thread per pair). Lists are paginated by time, so the time column is part of every cursor.
JavaScript `Date` holds milliseconds, while PostgreSQL `timestamptz` defaults to
microseconds.

## Decision

- PostgreSQL 16 with a fully relational schema in plain SQL migrations
  ([`db/migrations/0001_init.sql`](../../../db/migrations/0001_init.sql)), applied by a forward-only, checksummed runner
  under an advisory lock ([`db/migrate.ts`](../../../db/migrate.ts)). JSONB only where the shape is
  free-form or a point-in-time copy: `section_visibility`, job `screening_questions`,
  application `profile_snapshot` and `answers`, `reaction_counts`, rating `sub_scores`,
  import `extracted`, notification `data`, case `snapshot` and `ai_scores`, settings.
- Uniqueness rules are constraints, not application checks: composite primary keys on link
  tables, `connections.pair_key` and `dm_threads.direct_key` unique (the two ids sorted),
  `applications (job_id, candidate_id)` unique, the partial unique indexes
  `approaches_pending_pair_idx` (one `PENDING` approach per recruiter and candidate) and
  `moderation_cases_open_target_idx` (one `OPEN` case per target), `ratings
  (engagement_id, direction)` unique.
- Every timestamp is `timestamptz(3)`. A cursor built from a JS `Date` then equals the
  stored value exactly, so keyset pages neither skip nor repeat rows. The API runs with
  `TZ=UTC` (set first thing in [`index.ts`](../../../apps/api/src/index.ts), [`worker.ts`](../../../apps/api/src/worker.ts), [`cli.ts`](../../../apps/api/src/cli.ts)).
- Primary keys are ULIDs stored as `text`, generated in the API with a monotonic factory
  ([`core/ids.ts`](../../../apps/api/src/core/ids.ts)). They sort by creation time and serve as the cursor tie-breaker.
- Enums are PostgreSQL enum types. Search uses generated `tsvector` columns and trigram
  indexes (`pg_trgm`), `citext` for emails, usernames, company slugs and domains, recruiter work emails and
  skill names.
- Runtime queries use Kysely with generated types ([`db/types.ts`](../../../apps/api/src/db/types.ts)).

## Consequences

Positive:

- Races resolve in the database: two people requesting each other, a double-clicked
  Easy Apply or a repeated approach becomes `INSERT ... ON CONFLICT DO NOTHING` and a
  re-read or a `409`.
- Cursor comparisons are exact without casting or truncation.
- IDs leak no row counts and can be generated before insert.

Trade-offs:

- Millisecond precision: two rows in the same millisecond are ordered by id, which is
  monotonic only within one process.
- Text ULIDs are larger than integers in indexes.
- Some code still truncates to milliseconds (`msOf` in
  [`repositories/moderation.repository.ts`](../../../apps/api/src/repositories/moderation.repository.ts)), a no-op on this schema whose comment
  assumes microsecond columns.

## Alternatives considered

- **A document store.** Would push the uniqueness and counting rules into the application.
- **Microsecond timestamps with text cursors everywhere.** Exact as well (the
  [`repositories/keyset.ts`](../../../apps/api/src/repositories/keyset.ts) cursors read the column as text), but every cursor would need that care.
- **UUIDv4 or bigserial keys.** v4 does not sort by time; bigserial reveals volumes and
  needs a round trip for the id.
