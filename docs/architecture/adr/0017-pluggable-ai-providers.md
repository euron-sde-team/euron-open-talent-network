# ADR 0017: Pluggable AI providers, a stub, and a no-AI mode

## Status

Accepted.

## Context

The AI layer helps people build a profile: import from pasted text, a document (PDF,
DOCX, a photo of a resume) or a voice note into a proposal they review section by
section; propose evidence-backed badges; polish a headline or a description. Operators
differ: some have an OpenAI key, some prefer Gemini, some cannot send personal data to
any model provider at all. Tests and local development need deterministic output with no
key and no network. And model output is untrusted input: it can invent facts, carry
links, or echo contact details.

## Decision

- One port, [`integrations/ai/provider.ts`](../../../apps/api/src/integrations/ai/provider.ts):
  `transcribe`, `extract`, `badges`, `polish`. Providers return raw JSON only.
- `AI_PROVIDER` selects ([`integrations/ai/index.ts`](../../../apps/api/src/integrations/ai/index.ts),
  [`core/config.ts`](../../../apps/api/src/core/config.ts)):
  - `openai` (default): chat completions with strict JSON schemas (`OPENAI_MODEL`, default
    `gpt-4o-mini`) and audio transcription (`OPENAI_TRANSCRIBE_MODEL`, default `whisper-1`)
    ([`integrations/ai/openai.ts`](../../../apps/api/src/integrations/ai/openai.ts));
  - `gemini`: `generateContent` with a response schema, PDFs, images and audio inline, so
    nothing is left in a provider-side file store (`GEMINI_MODEL`, `GEMINI_BASE_URL`)
    ([`integrations/ai/gemini.ts`](../../../apps/api/src/integrations/ai/gemini.ts));
  - `stub`: the OpenAI client pointed at [`apps/ai-stub`](../../../apps/ai-stub/README.md)
    (`AI_STUB_URL`), deterministic, including a decoy badge without evidence and a
    `[[ai:fail]]` marker for error paths; refused in production by the config guard;
  - `none`: AI is off.
- `aiAvailable()` is false for `none` and for a real provider without a usable key (unset
  or the Terraform placeholder `set-me`). `GET /api/meta` then reports `ai: { import:
  false, polish: false }`, the web app hides the wizard and polish buttons, and the
  endpoints answer `503 AI_UNAVAILABLE`. The manual editor is always the full path.
- **The sanitiser owns trust**, not the provider
  ([`integrations/ai/schema.ts`](../../../apps/api/src/integrations/ai/schema.ts)): URLs go
  through `safeUrl()`, months through `parseYearMonth()`, lengths are clamped, skills
  de-duplicated, and emails and phone numbers are stripped from every text field. Badges
  survive only with a verbatim evidence quote from the input and confidence of at least
  0.6, at most five ([`domain/badges.ts`](../../../apps/api/src/domain/badges.ts));
  seniority is computed from dates, never asked of the model.
- Imports run as the `import.run` job; the payload is the import id, and the file stays in
  the private bucket under its upload. Raw input and the file link are purged once the
  owner applies the draft or after `settings.import.retentionHours`. An import never
  publishes anything ([ADR 0019](0019-explicit-publish.md)).

Details: [ai.md](../ai.md).

## Consequences

Positive:

- A deployment can run with OpenAI, Gemini or no AI, by configuration only.
- The same client code runs in tests (against the stub) and in production.
- A provider cannot write unchecked data to a profile, whatever it returns.

Trade-offs:

- Two provider adapters and a schema translation (`toGeminiSchema`) to keep in step with
  the JSON schemas.
- The operator decides, and must disclose, that profile input goes to a third-party model
  when a real provider is configured.
- The evidence gate also drops true badges the model phrased without quoting the input.

## Alternatives considered

- **One hard-wired vendor.** Simplest, but no keyless mode and no choice for operators.
- **Self-hosted open-weight models only.** Private, but out of reach for small operators;
  an OpenAI-compatible server can still be used through `OPENAI_BASE_URL`.
- **Trusting structured output as-is.** Strict schemas constrain shape, not truth or
  safety; links and contact details still need checks.
