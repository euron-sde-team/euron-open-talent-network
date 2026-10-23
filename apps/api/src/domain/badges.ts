/**
 * Which proposed badges survive. Pure, so the gate is unit-tested.
 *
 *   - Evidence or nothing: a badge's evidenceQuote must appear verbatim (ignoring case
 *     and runs of whitespace) in what the person gave us or in the proposal built from
 *     it. A model that "remembers" an award the person never mentioned is dropped.
 *   - Confidence at least MIN_CONFIDENCE.
 *   - At most MAX_AI_BADGES, highest confidence first, unique slugs.
 *   - Seniority is never the model's call: the SYSTEM badge comes from the dates.
 */
export const MIN_CONFIDENCE = 0.6;
export const MAX_AI_BADGES = 5;

export interface CandidateBadge {
  kind: "ROLE_FIT" | "DOMAIN" | "ACHIEVEMENT";
  slug: string;
  label: string;
  rationale: string;
  evidenceQuote: string;
  confidence: number;
}

const norm = (s: string) => s.toLowerCase().replace(/\s+/g, " ").trim();

export function gateBadges(badges: readonly CandidateBadge[], evidenceText: string): CandidateBadge[] {
  const haystack = norm(evidenceText);
  const seen = new Set<string>();
  return [...badges]
    .filter((b) => b.confidence >= MIN_CONFIDENCE && b.evidenceQuote.trim().length >= 3 && haystack.includes(norm(b.evidenceQuote)))
    .sort((a, b) => b.confidence - a.confidence)
    .filter((b) => (seen.has(b.slug) ? false : (seen.add(b.slug), true)))
    .slice(0, MAX_AI_BADGES);
}

export function seniorityBadge(years: number | null): { slug: string; label: string; rationale: string } | null {
  if (years === null || years < 3) return null;
  const band = years >= 15 ? 15 : years >= 10 ? 10 : years >= 5 ? 5 : 3;
  return { slug: `experience-${band}-plus`, label: `${band}+ years of experience`, rationale: `Roles on this profile add up to about ${years} years.` };
}
