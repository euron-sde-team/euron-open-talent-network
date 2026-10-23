# ADR 0016: Pipeline transitions as a pure domain function

## Status

Accepted.

## Context

An application moves through stages (`APPLIED`, `SCREENING`, `INTERVIEW`, `OFFER`,
`HIRED`, `REJECTED`, `WITHDRAWN`). Moves arrive from several places: a single drag on the
kanban board, the bulk bar (up to 100 cards), the candidate withdrawing, and concurrent
teammates on the same board. Each needs the same answer to "is this move allowed, and by
whom", and the candidate must be told the stage but never the team's private note.
Spreading that rule across controllers and SQL makes it untestable and easy to bypass.

## Decision

- [`domain/pipeline.ts`](../../../apps/api/src/domain/pipeline.ts) exports
  `canMoveStage(from, to, by, { reason })`, pure, with `by` either `TEAM` or `CANDIDATE`:
  - same stage: `SAME_STAGE`; from `HIRED` or `WITHDRAWN`: `STAGE_FINAL`;
  - the candidate may only move an open stage (`APPLIED` to `OFFER`) to `WITHDRAWN`;
  - the team may never move to `WITHDRAWN`; from `REJECTED` only back to `SCREENING`;
    to `REJECTED` only with a non-empty reason (`REASON_REQUIRED`);
  - otherwise the team may move forward to any later open stage or `HIRED`, or back to an
    earlier open stage (a mistaken drag).
- The service ([`services/application.service.ts`](../../../apps/api/src/services/application.service.ts))
  locks the row, asks `canMoveStage`, then writes with a conditional
  `UPDATE ... WHERE stage = <the stage it read>`; zero rows means a teammate moved it first
  (`409 APPLICATION_CHANGED`). Every move inserts an `application_events` row (from, to,
  actor, optional team note) in the same transaction. Bulk moves run every card through the
  same path in one transaction: all or nothing.
- Who the team is: an ACTIVE recruiter whose company owns the application
  (`requireRecruiter` plus `company_id` on every query).
- After commit the candidate gets `application:stage` (stage and time, no note) and an
  `APPLICATION_STAGE` notification worded by `STAGE_COPY`; every open board gets
  `pipeline:card` on the `job:<id>` room. The candidate's timeline is built from the events
  without the note ([`presenters/application.presenter.ts`](../../../apps/api/src/presenters/application.presenter.ts)).

Details: [hiring-pipeline.md](../hiring-pipeline.md).

## Consequences

Positive:

- One table of rules, unit-testable without a database, shared by the single move, the
  bulk move and the candidate's withdraw.
- Concurrent edits on a shared board resolve to one winner and a clear conflict for the
  other, never a silent overwrite.
- The audit history of every application is complete by construction.

Trade-offs:

- The stages are fixed for every company; custom stages would need data-driven rules.
- A bulk move fails entirely if one card is not allowed, so the client must refresh and
  retry the rest.
- Moving back is allowed, so the timeline can show a stage twice; that is the honest
  history.

## Alternatives considered

- **A database trigger or check constraint on transitions.** Enforces the graph but cannot
  see who is moving or whether a reason was given, and its errors are hard to map to
  stable codes.
- **A generic state machine library.** More machinery than one small function needs.
- **Free stage changes with an audit log.** Lets the team mark a withdrawn candidate as
  hired, or reject without a reason the candidate can be shown.
