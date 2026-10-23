# Architecture decision records

Short records of the decisions that shape Euron Open Talent: the context, what was
decided, and what it costs. The system as built is described in [HLD.md](../HLD.md) and
[LLD.md](../LLD.md).

| ADR | Decision |
| --- | --- |
| [0001](0001-single-network-per-deployment.md) | One talent network per deployment; companies are pages inside it, not tenants |
| [0002](0002-relational-schema-timestamptz3-ulids.md) | Relational PostgreSQL schema, `timestamptz(3)`, ULID keys |
| [0003](0003-layered-repository-pattern.md) | Routes, controllers, services, domain, repositories, presenters |
| [0004](0004-keyset-pagination.md) | Keyset pagination with opaque cursors, no totals |
| [0005](0005-refresh-rotation-cookie-and-memory-token.md) | In-memory access token, rotating refresh token in an httpOnly cookie |
| [0006](0006-can-message-rule.md) | The canMessage rule: connections, accepted approaches or applications; otherwise capped message requests per recipient policy |
| [0007](0007-socketio-with-redis-adapter.md) | Socket.IO with the Redis adapter for realtime |
| [0008](0008-bullmq-on-redis.md) | BullMQ on Redis for background jobs |
| [0009](0009-after-commit-effects.md) | Side effects only after commit |
| [0010](0010-presigned-uploads-by-upload-id.md) | Direct-to-storage uploads, referenced by upload id only |
| [0011](0011-pluggable-moderation-providers.md) | Pluggable moderation providers behind one threshold policy |
| [0012](0012-fargate-behind-one-alb-with-path-routing.md) | Fargate services behind one ALB with path routing |
| [0013](0013-floci-for-local-aws.md) | Floci as the local AWS |
| [0014](0014-consent-based-contact-unlock.md) | Contact details shared only through a candidate's per-channel, revocable, logged unlock |
| [0015](0015-recruiter-verification-work-email-and-review.md) | Recruiters verified by a work-email code and human review, with domain auto-approval for verified companies |
| [0016](0016-pipeline-transitions-as-pure-domain-function.md) | Pipeline stage changes decided by one pure function, written with conditional updates |
| [0017](0017-pluggable-ai-providers.md) | Pluggable AI providers (OpenAI, Gemini, a stub) and a no-AI mode; the sanitiser owns trust |
| [0018](0018-in-process-resume-export.md) | PDF and DOCX resumes rendered in process, no headless browser |
| [0019](0019-explicit-publish.md) | Profiles become public only when their owner publishes, past a completeness and contact gate |
