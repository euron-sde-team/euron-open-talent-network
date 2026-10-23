# ADR 0019: Explicit publish, owner only

## Status

Accepted.

## Context

Every account has a talent profile from sign-up (`talent_profiles`, status `DRAFT`). A
profile that is public is listed in the directory, searchable by recruiters and open to
approaches. Publishing on someone's behalf (on sign-up, after an AI import, in bulk by an
operator) would expose half-finished pages, put people in front of recruiters who never
chose that, and make published profiles without any way to reach the person after they
say yes.

## Decision

- Status changes only through the owner: `POST /api/profiles/me/status` with `PUBLISHED`,
  `UNLISTED` or `DRAFT` ([`services/profile.service.ts`](../../../apps/api/src/services/profile.service.ts)).
  There is no admin, bulk or import path that publishes.
- `PUBLISHED` and `UNLISTED` both pass `publishBlock`
  ([`domain/profile.ts`](../../../apps/api/src/domain/profile.ts)): not `SUSPENDED`,
  completeness at least `settings.profile.publishThreshold` (default 55, from weighted
  facts: headline, about, photo, skills, experience, projects, education, links, contact),
  and at least one private contact channel (email, phone or WhatsApp). Failures are
  `422 PUBLISH_INCOMPLETE` or `PUBLISH_NO_CONTACT` with the score and threshold
  (completeness is recomputed from the rows first); a suspended profile answers
  `403 PROFILE_SUSPENDED`.
- `UNLISTED` opens by direct link but stays out of the directory and search; `DRAFT` is
  visible to the owner and staff only.
- The AI import fills sections the owner picks; it never changes the status
  ([`services/import.service.ts`](../../../apps/api/src/services/import.service.ts)).
- A moderator can suspend a profile; restoring it (from a case, an appeal or
  `POST /api/admin/users/:id/profile/restore`) sets `UNLISTED`, so the owner republishes
  deliberately ([`services/moderation/targets.ts`](../../../apps/api/src/services/moderation/targets.ts),
  [`services/admin.service.ts`](../../../apps/api/src/services/admin.service.ts)).
- Publishing (and every later profile edit while published or unlisted) queues a
  `moderation.scan` of the profile.

## Consequences

Positive:

- Everything in the directory was put there by its owner, finished enough to be useful,
  and reachable through consent ([ADR 0014](0014-consent-based-contact-unlock.md)).
- The progress ring in the editor and the gate use the same weights, so people see what is
  missing (`MyProfile.missing`).

Trade-offs:

- A new network starts with an empty directory until people finish and publish; the demo
  seed exists for evaluation.
- Requiring a contact channel to publish asks for private data up front, even though it is
  only ever shared through an unlock.
- A threshold change does not unpublish existing profiles; it applies at the next publish.

## Alternatives considered

- **Public by default.** Fast to fill the directory, at the cost of consent and quality.
- **Publish after import.** Would turn an AI draft the person has not read into a public
  page.
- **Operator bulk publish (for migrations).** A migration can import profiles as `DRAFT`
  and invite people to publish.
