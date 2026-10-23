# ADR 0015: Recruiter verification by work email and human review

## Status

Accepted.

## Context

Recruiter status unlocks the sensitive parts of the network: recruiter-only search
filters and open-to-work signals, approaches (and so contact reveals), job postings and
pipelines with candidates' applications. Fake recruiters are the main threat to
candidates on a talent network: harvesting contact details, advance-fee and "training
fee" scams, impersonating real employers. A confirmed email alone proves little (anyone
can confirm a free-mail address); a manual review of every applicant does not scale for
large, already-trusted employers.

## Decision

Verification is two gates: a confirmed work email, then either a human approval or, for
trusted companies only, an automatic one
([`services/recruiter.service.ts`](../../../apps/api/src/services/recruiter.service.ts),
[`domain/recruiter-verification.ts`](../../../apps/api/src/domain/recruiter-verification.ts)):

1. **Register** (`POST /api/recruiter/register`): join an existing company page or create
   one (the creator becomes `OWNER`; the first recruiter of a page without an owner too).
   Identity comes from the session only. A user recruits for one company at a time, and a
   work email belongs to one recruiter. Status `EMAIL_PENDING`.
2. **Confirm the work email** with a six-digit one-time code, valid 15 minutes. Only an
   HMAC of the code (keyed from `TOTP_ENCRYPTION_KEY`, bound to the recruiter id) is
   stored, and the mail is sent directly, never through a queue, so the code never sits
   in Redis. Attempts are counted with one atomic `UPDATE ... SET attempts = attempts + 1
   ... RETURNING` before the comparison, so parallel guesses cannot exceed the cap of 5
   (`429 CODE_LOCKED`); a new code invalidates the old one. Resends and verifies are rate
   limited.
3. **Route** (`reviewRoute`): `AUTO_APPROVE` only when the company is `VERIFIED`, the
   company enabled `auto_approve_domain`, the platform allows it
   (`settings.recruiter.allowDomainAutoApprove`), and the confirmed email is on one of the
   company's `domains` (sub-domains count) and is not free mail. Everything else goes to
   `PENDING_REVIEW`.
4. **Review** in `/admin` (area `recruiters`, roles `ADMIN` and `RECRUITER_OPS`): the queue
   row shows whether the domain matches and whether it is free mail
   (`settings.recruiter.freeMailDomains`) as evidence; the reviewer approves, or rejects
   with a note the applicant sees. Recruiters can later be suspended, reinstated and given
   a per-recruiter approach quota. Companies are verified by operators only.

Only `ACTIVE` recruiters of a non-suspended company pass `requireRecruiter`. Phone
verification is not part of the flow (no SMS provider, no toll-fraud surface). The
operator guide is [recruiter-verification.md](../../guides/recruiter-verification.md).

## Consequences

Positive:

- Every active recruiter either was looked at by a person or holds a mailbox on a domain
  an operator already trusted.
- Free-mail applicants are not refused (small agencies and freelancers use them), but they
  never skip review and the reviewer sees the signal.
- Large verified employers onboard their recruiters without operator work.

Trade-offs:

- Operators must staff the queue; until reviewed, a recruiter can do nothing recruiter-only.
- Domain auto-approval trusts the company's mail system: a former employee whose mailbox
  still works can pass it. Suspension and team removal are the remedies.
- The base-domain heuristic for two-label suffixes (`co.uk`) is approximate; it only feeds
  the free-mail check and evidence, never auto-approval on its own.

## Alternatives considered

- **Email confirmation alone.** Proves control of an address, not employment.
- **Review everyone, always.** Safe but slow for large, verified employers.
- **Business registry or document checks.** Jurisdiction-specific, and a deployment can
  add them as review evidence without changing the state machine.
