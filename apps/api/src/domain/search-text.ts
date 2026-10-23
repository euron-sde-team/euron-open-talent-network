/**
 * Turning what people type into search predicates. Pure, so the escaping is
 * unit-tested: user text never reaches LIKE or tsquery syntax unescaped (the source
 * system passed % and _ straight into ILIKE).
 */

/**
 * Words of a search query: letters and digits only, lower-cased, at most 8. This is how
 * Postgres's 'simple' parser splits text, so "C++" becomes "c" on both sides; skills are
 * matched exactly through the skill_names array instead.
 */
export function searchTerms(q: string): string[] {
  return (q.toLowerCase().match(/[\p{L}\p{N}_]+/gu) ?? []).slice(0, 8);
}

/** "data sci" -> "data:* & sci:*", or null when nothing searchable remains. */
export function prefixTsQuery(q: string): string | null {
  const terms = searchTerms(q);
  if (!terms.length) return null;
  return terms.map((t) => `${t}:*`).join(" & ");
}

/** Escape LIKE wildcards so user text is matched literally (trigram indexes serve ILIKE). */
export function likeContains(q: string): string {
  return `%${q.replace(/[\\%_]/g, (c) => `\\${c}`)}%`;
}

/** A skill as stored and compared: trimmed, single-spaced, at most 60 characters. Case is kept for display; citext compares. */
export function normalizeSkill(raw: string): string | null {
  const s = raw.normalize("NFKC").replace(/\s+/g, " ").trim().slice(0, 60);
  return s ? s : null;
}

/** Unique skills (case-insensitive), in order, at most `max`. */
export function uniqueSkills(raw: readonly string[], max = 50): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const r of raw) {
    const s = normalizeSkill(r);
    if (!s || seen.has(s.toLowerCase())) continue;
    seen.add(s.toLowerCase());
    out.push(s);
    if (out.length >= max) break;
  }
  return out;
}
