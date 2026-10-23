# ADR 0014: Consent-based, per-channel contact unlock

## Status

Accepted.

## Context

A talent network holds what scrapers and bulk recruiters want most: people's email
addresses and phone numbers next to their skills and seniority. If contact details are on
the profile, or visible to anyone with a recruiter badge, they leak at scale, and a
candidate has no idea who has them. Candidates still want to be reachable by the right
recruiter, often outside the platform (a call, a WhatsApp message), and want to choose
how.

## Decision

Contact details are private by construction and leave the API only through a consent
record and a logged reveal
([`services/approach.service.ts`](../../../apps/api/src/services/approach.service.ts)):

- **Storage.** `talent_profiles.contact_email`, `contact_phone` and `whatsapp_phone` are
  set only by the owner (`PUT /api/profiles/me/contact`). They appear in no public DTO:
  `Profile` has no contact fields, only `MyProfile` (the owner) and `ContactReveal` carry
  them ([`presenters/profile.presenter.ts`](../../../apps/api/src/presenters/profile.presenter.ts),
  [`packages/types/src/talent.ts`](../../../packages/types/src/talent.ts)). The AI import
  strips emails and phone numbers from everything it proposes
  ([`integrations/ai/schema.ts`](../../../apps/api/src/integrations/ai/schema.ts)), and
  display names are cleaned of them at write time
  ([`domain/display-name.ts`](../../../apps/api/src/domain/display-name.ts)).
- **The approach.** Only an ACTIVE recruiter of a non-suspended company can send one
  (`POST /api/approaches`): a role title, a message of 30 to 3000 characters, optionally an
  open job of their company and a salary range. [`domain/trust.ts`](../../../apps/api/src/domain/trust.ts)
  (`approachBlock`) refuses it when the profile is not `PUBLISHED` or `UNLISTED`, a block
  exists either way, a pending approach already exists for the pair (also a partial
  unique index), the candidate declined within `settings.recruiter.declineCooldownDays`
  (default 30), or the recruiter used their daily quota
  (`recruiters.approach_quota_daily`, else `settings.recruiter.approachesPerDay`, default 25).
  A block is reported as `APPROACH_NOT_PUBLISHED`, so the recruiter learns nothing.
  Sends are serialised per recruiter (`SELECT ... FOR UPDATE` on the recruiter row), so the
  quota and the pending check are exact under concurrency.
- **Accept with channels.** The candidate accepts by choosing one or more of `EMAIL`,
  `PHONE`, `WHATSAPP`, each of which they must have filled in. In one transaction the
  approach moves `PENDING -> ACCEPTED` with a conditional `UPDATE ... WHERE status =
  'PENDING'` (accept and withdraw cannot both win), the expiry is checked again, a
  `contact_unlocks` row records exactly the chosen channels, and a DM thread opens with
  both sides `ACTIVE`.
- **Logged reveal.** `GET /api/approaches/:id/contact` returns only the unlocked channels,
  for the recruiter record that was approved, while the approach is `ACCEPTED`, the unlock
  is not revoked and no block exists. Every channel returned writes a
  `contact_access_log` row (recruiter, channel, time, a salted hash of the IP, the user
  agent), which the candidate reads at `GET /api/profiles/me/contact-log`. Reveals are rate
  limited per recruiter.
- **Revoke, decline, block, expire.** The candidate can revoke a live unlock at any time
  (the conversation stays, the reveal stops working). Declining starts the cooldown;
  "block" declines and blocks in one step. Pending approaches expire after
  `settings.recruiter.approachExpiryDays` (default 14) through the housekeeping job. A
  block, a recruiter leaving the company, account deletion and a moderator suspending the
  profile all revoke live unlocks.
- **Moderation and quota refund.** Approaches are scanned (`moderation.scan`, target
  `APPROACH`). One the classifier flags is never shown to the candidate and does not count
  toward the recruiter's daily quota.

The candidate-facing explanation, with diagrams, is in
[privacy-and-contact-consent.md](../privacy-and-contact-consent.md).

## Consequences

Positive:

- Nobody can collect contact details by browsing, searching or scraping: there is no read
  path for them except an unlock the candidate created.
- Consent is specific (this recruiter, at this company, these channels) and revocable,
  and the candidate sees every use of it.
- Recruiter volume is bounded per day and per pair, and spam that the classifier catches
  costs the sender nothing but also achieves nothing.

Trade-offs:

- A revealed email or phone number is out once it is read; revoking stops future reveals,
  not what the recruiter already copied. The access log makes that visible, not reversible.
- Recruiters do more work per candidate than with a contact database: one approach, then
  wait.
- The quota is per UTC day, not a rolling window.

## Alternatives considered

- **Contact details on the profile behind a "recruiters only" audience.** Any verified
  recruiter, or anyone who compromises one account, could harvest every profile.
- **All-or-nothing sharing.** Simpler, but people commonly want to give an email and not a
  phone number.
- **Messaging only, never reveal.** Keeps everything on the platform, but hiring routinely
  moves to calls; refusing that pushes people to paste numbers into messages with no
  record or revocation.
