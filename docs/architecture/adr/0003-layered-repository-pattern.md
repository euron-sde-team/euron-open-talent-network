# ADR 0003: Layered API with repositories

## Status

Accepted.

## Context

The same business rules are reached from HTTP routes, the Socket.IO gateway, background
jobs, the CLI, the demo seed and the tests. Visibility rules (blocks, CONNECTIONS-only posts,
profile section audiences, suspended companies) must be applied by every read, and writes
must keep counters, notifications and audit rows consistent inside one transaction.

## Decision

The API ([`apps/api/src`](../../../apps/api/src)) is layered:

| Layer | Folder | Responsibility |
| --- | --- | --- |
| Routes | `routes/` | Mount points, auth middleware, rate limits ([`routes/index.ts`](../../../apps/api/src/routes/index.ts)) |
| Controllers | `controllers/` | Parse and validate input with zod (`core/validate.ts`), call one service, shape the HTTP response |
| Services | `services/` | Business rules, transactions, effects; take an `Actor`, never an Express request ([`core/context.ts`](../../../apps/api/src/core/context.ts)) |
| Domain | `domain/` | Pure rules with no I/O: `canMessage`, pipeline transitions, approach and rating rules, the publish gate and section audiences, recruiter verification routing, badge gating, `safeUrl`, moderation decisions, media rules |
| Repositories | `repositories/` | Kysely queries; every method accepts an `Executor` (pool or transaction) |
| Presenters | `presenters/` | Rows to DTOs from `@open-talent/types`, batched (media signing, user summaries) |
| Integrations | `integrations/` | Redis, storage, mail, AI providers |

Shared visibility predicates live in [`repositories/visibility.ts`](../../../apps/api/src/repositories/visibility.ts) (`notBlocked`,
`canReadPost`, `isBlockedEitherWay`) and are composed into queries, starting from base queries such as
`postRepo.visible()`.

## Consequences

Positive:

- One rule, one place: `canMessage`, `canMoveStage` and `publishBlock` are pure
  functions that every caller uses, and that the unit suite pins
  ([`test/unit/can-message.test.ts`](../../../apps/api/test/unit/can-message.test.ts)).
- Services run unchanged from sockets, jobs and tests.
- Transactions span repositories by passing the executor.

Trade-offs:

- More files per feature, and some indirection for simple reads.
- Presenters issue their own batched queries, so a response is several round trips.
- The layering is a convention; nothing stops a service from writing SQL inline (a few do,
  for example `contacts` in `dm.service.ts`).

## Alternatives considered

- **An ORM with active records.** Hides the queries that the visibility rules depend on.
- **Fat controllers.** Rules would not be reusable from the gateway and jobs.
