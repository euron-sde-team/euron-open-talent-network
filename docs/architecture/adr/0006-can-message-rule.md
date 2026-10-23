# ADR 0006: Who may message whom (the canMessage rule)

## Status

Accepted.

## Context

On a talent network, open direct messages are the main channel for spam, recruiter cold
outreach at volume and harassment. Candidates need a way to be reachable by the people
they want to hear from (their network, a recruiter they said yes to, the team reviewing
their application) without being reachable by everyone. Recruiters need a structured way
in that the candidate controls, which is the approach ([ADR 0014](0014-consent-based-contact-unlock.md)),
not an unlimited inbox. Blocks must be absolute, and platform staff must be able to reach
anyone for support.

## Decision

[`domain/can-message.ts`](../../../apps/api/src/domain/can-message.ts) decides who may
**start** a conversation. It is pure: the service loads the facts
([`repositories/messaging-facts.ts`](../../../apps/api/src/repositories/messaging-facts.ts))
and the function decides. The first rule that applies wins:

1. Nobody messages themselves (`SELF`).
2. A sender whose account is not ACTIVE cannot start or continue conversations
   (`SENDER_RESTRICTED`).
3. A recipient who is not ACTIVE cannot be messaged (`RECIPIENT_UNAVAILABLE`).
4. A block in either direction stops everything, staff included (`BLOCKED`).
5. Platform staff (`MODERATOR`, `ADMIN`) may message anyone, never as a request.
6. A normal conversation needs a reason to exist. Any one of these is enough:
   - the two are **connected** (an `ACCEPTED` row in `connections`);
   - a recruiter **approach** between them was `ACCEPTED`;
   - an **application link**: one applied to a job the other recruits for (any stage
     but `WITHDRAWN`).
7. Otherwise the first message is a **message request**, allowed only when the
   recipient's `users.message_request_policy` admits the sender:

   | Policy | Who may send a request |
   | --- | --- |
   | `ANYONE` | Any active member |
   | `RECRUITERS` (default) | ACTIVE recruiters only; everyone else gets `NOT_CONNECTED` |
   | `NOBODY` | Nobody (`RECIPIENT_CLOSED_REQUESTS`) |

A request puts the recipient in participant state `REQUESTED`: the thread appears in
their Requests folder, they get one `DM_REQUEST` notification and no push per message.
Starting requests is rate limited per sender per day (`settings.messaging.requestsPerDay`,
default 20).

[`domain/dm-send.ts`](../../../apps/api/src/domain/dm-send.ts) decides each **send into an
existing thread**, from facts reloaded inside the send transaction:

- `SELF`, `SENDER_RESTRICTED`, `RECIPIENT_UNAVAILABLE` and `BLOCKED` are never waived.
- Once the counterpart is `ACTIVE` in the thread (they accepted the request, or the
  thread was opened by an accepted approach or an application), the `NOT_CONNECTED`
  reason is waived: their action is the consent.
- While the request is pending, the sender may send at most
  `settings.messaging.requestMessageCap` messages (default 3), counting messages they
  later deleted; after that `403 DM_REQUEST_PENDING`.
- A declined request reads to the sender as `RECIPIENT_CLOSED_REQUESTS` ("this person
  only accepts messages from their connections"), so they are not told they were
  declined specifically.

Replying to a request accepts it. Threads opened by an accepted approach or by an
application (`openContextThread` in
[`services/dm.service.ts`](../../../apps/api/src/services/dm.service.ts)) start `ACTIVE`
on both sides and reuse the pair's one thread (`direct_key`), relabelling it with that
context. The same functions feed `GET /api/dms/eligibility/:userId`, the profile's
`viewer.messaging` and `Thread.canSend`
([`presenters/thread.presenter.ts`](../../../apps/api/src/presenters/thread.presenter.ts)),
so the composer and the server never disagree.

## Consequences

Positive:

- A candidate's inbox holds their network, recruiters they accepted, hiring teams they
  applied to, and (by default) a capped trickle of requests from verified recruiters only.
- One pure, unit-tested rule behind the composer, the profile page and the server
  ([`test/unit/can-message.test.ts`](../../../apps/api/test/unit/can-message.test.ts),
  [`test/unit/dm-send.test.ts`](../../../apps/api/test/unit/dm-send.test.ts)).
- Removing a connection does not cut off a conversation the other side already accepted.

Trade-offs:

- Declining a request is final for ordinary messaging between the pair: the 1:1 thread
  is unique per pair and there is no path back from `DECLINED`, except a later accepted
  approach or an application, which reopens the thread as consent.
- The default `RECRUITERS` policy means two members who are not connected cannot talk
  until one sends a connection request; that is the intended route.
- 1:1 threads only; there are no group conversations.

## Alternatives considered

- **Open messaging with reporting only.** Puts the burden on candidates, and recruiters
  would use messages instead of approaches, bypassing quotas and contact consent.
- **Connections only, no requests.** Simple, but leaves no way for someone outside the
  network to make first contact, even with the recipient's agreement.
- **InMail-style paid credits.** A commercial lever, not a safety one; quotas and consent
  bound recruiter volume without money.
