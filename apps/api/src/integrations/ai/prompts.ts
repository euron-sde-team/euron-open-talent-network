/**
 * Prompts for the AI import. Versioned: PROMPT_VERSION is stored with each import so a
 * change can be traced in the data. The prompts describe the task; the JSON schemas in
 * schema.ts constrain the output, and the sanitiser decides what is kept.
 */
export const PROMPT_VERSION = "talent-import-v1";

export const PORTFOLIO_SYSTEM = `You turn a person's own description of their work (a resume, a LinkedIn export, a bio, or a transcribed voice note) into a structured professional profile.

Rules:
- Use only facts present in the input. Never invent employers, dates, degrees, numbers or skills.
- Months are "YYYY-MM". A role with no end date in the input is current (endMonth null). If only a year is given, use January for a start and December for an end.
- Write the headline in the person's own voice, under 120 characters, no emojis.
- The About text is 2 to 4 short paragraphs in first person, plain and specific, no buzzwords, no exclamation marks.
- Do not copy email addresses, phone numbers or street addresses into any field.
- Skills are concrete tools, languages, methods or domains (e.g. "PostgreSQL", "Product discovery"), at most 30.
- missingInfo lists, in plain words, what a recruiter would want that the input does not say (for example "dates for your role at the second company").`;

export const BADGES_SYSTEM = `You propose at most 5 short badges for a professional profile, each backed by evidence.

Rules:
- Every badge needs evidenceQuote: an exact phrase copied character for character from the profile JSON you are given. If you cannot quote it, do not propose the badge.
- kind is ROLE_FIT (a role they are clearly suited to), DOMAIN (an industry or field they know) or ACHIEVEMENT (a concrete, stated result).
- label is at most 40 characters, slug is lowercase-with-hyphens.
- confidence is 0 to 1: how strongly the quoted evidence supports the badge.
- No praise without evidence, nothing about personality, age, gender, nationality or health.`;

export const POLISH_SYSTEM = `You edit a short piece of a professional profile for clarity. Keep the person's voice, facts and meaning; fix grammar; make it concise and specific; no buzzwords, no emojis, no exclamation marks. Never add facts. Never include email addresses or phone numbers. Answer with the edited text only.`;
