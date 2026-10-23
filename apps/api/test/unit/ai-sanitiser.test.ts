import { describe, expect, test } from "vitest";
import { aiAvailable } from "../../src/core/config";
import { cleanText, readBadges, sanitizeProposal } from "../../src/integrations/ai/schema";

const role = (over: Record<string, unknown> = {}) => ({
  title: "Data Engineer",
  companyName: "Fictional Systems",
  employmentType: "FULL_TIME",
  workplaceType: "REMOTE",
  location: "Porto",
  startMonth: "2020-02",
  endMonth: null,
  description: "Built pipelines.",
  skills: ["Python", "python", "SQL"],
  ...over,
});

describe("cleanText", () => {
  test("strips email addresses and phone numbers, collapses spaces, trims and clamps", () => {
    expect(cleanText("Reach me at ada@example.com or +1 555 123 4567 any time", 200)).toBe("Reach me at or any time");
    expect(cleanText("Call (555) 123-4567.", 200)).not.toMatch(/\d{3}/);
    expect(cleanText("  a\t\tb  ", 200)).toBe("a b");
    expect(cleanText("one\n\n\n\n\ntwo", 200)).toBe("one\n\ntwo");
    expect(cleanText("abcdef", 3)).toBe("abc");
  });

  test("non-strings and empty results are null; short numbers stay", () => {
    expect(cleanText(42, 10)).toBeNull();
    expect(cleanText(null, 10)).toBeNull();
    expect(cleanText("ada@example.com", 10)).toBeNull();
    expect(cleanText("Cut costs by 40% in 2023", 100)).toBe("Cut costs by 40% in 2023");
  });
});

describe("sanitizeProposal", () => {
  test("garbage in: an empty proposal, never a throw", () => {
    for (const raw of [null, undefined, 42, "text", [], { experience: "nope", skills: 7 }]) {
      const { proposal, missingInfo } = sanitizeProposal(raw);
      expect(proposal.experience).toEqual([]);
      expect(proposal.skills).toEqual([]);
      expect(proposal.headline).toBeNull();
      expect(missingInfo).toEqual([]);
    }
  });

  test("links pass through safeUrl: javascript:, data: and credentialed links are dropped, bare hosts get https", () => {
    const { proposal } = sanitizeProposal({
      links: [
        { kind: "GITHUB", url: "github.example.com/ada", label: "Code", featured: true },
        { kind: "WEBSITE", url: "javascript:alert(document.cookie)", label: "x" },
        { kind: "WEBSITE", url: "data:text/html,<b>x</b>" },
        { kind: "WEBSITE", url: "https://user:pw@example.com" },
        { kind: "NOT_A_KIND", url: "https://ada.example.com" },
      ],
      projects: [{ name: "Viz", url: "javascript:alert(1)", repoUrl: "https://code.example.com/viz" }],
      certifications: [{ name: "Cloud Basics", credentialUrl: "file:///etc/passwd" }],
    });
    expect(proposal.links).toEqual([
      { kind: "GITHUB", url: "https://github.example.com/ada", label: "Code", featured: true },
      { kind: "WEBSITE", url: "https://ada.example.com/", label: null, featured: false },
    ]);
    expect(proposal.projects[0]).toMatchObject({ name: "Viz", url: null, repoUrl: "https://code.example.com/viz" });
    expect(proposal.certifications[0]).toMatchObject({ name: "Cloud Basics", credentialUrl: null });
  });

  test("months must be YYYY-MM; a role without a valid start is dropped; an end before the start becomes current", () => {
    const { proposal } = sanitizeProposal({
      experience: [role(), role({ title: "Analyst", startMonth: "Jan 2018" }), role({ title: "Intern", startMonth: "2019-06", endMonth: "2019-01" }), role({ title: "Lead", startMonth: "2021-01", endMonth: "2022-13" })],
    });
    expect(proposal.experience.map((e) => e.title)).toEqual(["Data Engineer", "Intern", "Lead"]);
    expect(proposal.experience[1]).toMatchObject({ startMonth: "2019-06", endMonth: null });
    expect(proposal.experience[2]).toMatchObject({ startMonth: "2021-01", endMonth: null });
  });

  test("contact details are stripped from every text field", () => {
    const { proposal, missingInfo } = sanitizeProposal({
      headline: "Engineer, ada@example.com",
      about: "Call +44 20 7946 0958 or mail ada.example@mail.example.test",
      currentTitle: "Engineer +1-555-123-4567",
      location: "Porto",
      experience: [role({ description: "Contact me: ada@example.com" })],
      education: [{ institution: "Example University", description: "Reach +1 555 765 4321" }],
      missingInfo: ["Add your phone +1 555 000 1111"],
    });
    const all = JSON.stringify({ proposal, missingInfo });
    expect(all).not.toMatch(/@/);
    expect(all).not.toMatch(/\d{3}[ -]?\d{3,4}/);
    expect(proposal.headline).toBe("Engineer,");
    expect(proposal.location).toBe("Porto");
  });

  test("enums, integers and lengths are checked", () => {
    const { proposal } = sanitizeProposal({
      yearsExperience: 7.5,
      experience: [role({ employmentType: "FOREVER", workplaceType: "MOON" })],
      education: [{ institution: "Example University", startYear: 1850, endYear: 2015 }],
      skills: [{ name: "Go", category: "Languages", years: 99 }, { name: "go", years: 3 }, { name: "  " }, { name: "Rust", years: 4 }],
      headline: "h".repeat(500),
    });
    expect(proposal.yearsExperience).toBeNull();
    expect(proposal.experience[0]).toMatchObject({ employmentType: null, workplaceType: null, skills: ["Python", "SQL"] });
    expect(proposal.education[0]).toMatchObject({ startYear: null, endYear: 2015 });
    expect(proposal.skills).toEqual([
      { name: "Go", category: "Languages", years: null },
      { name: "Rust", category: null, years: 4 },
    ]);
    expect(proposal.headline).toHaveLength(160);
  });

  test("lists are bounded", () => {
    const { proposal, missingInfo } = sanitizeProposal({
      experience: Array.from({ length: 40 }, (_, i) => role({ title: `Role ${i}` })),
      links: Array.from({ length: 30 }, (_, i) => ({ kind: "WEBSITE", url: `https://l${i}.example.com` })),
      skills: Array.from({ length: 80 }, (_, i) => ({ name: `skill-${i}` })),
      missingInfo: Array.from({ length: 20 }, (_, i) => `Add item ${i}`),
    });
    expect(proposal.experience).toHaveLength(30);
    expect(proposal.links).toHaveLength(15);
    expect(proposal.skills).toHaveLength(50);
    expect(missingInfo).toHaveLength(8);
  });
});

describe("readBadges", () => {
  test("slugs are normalised, confidence clamped, unknown kinds become DOMAIN", () => {
    expect(readBadges({ badges: [{ kind: "WIZARD", slug: "Cloud Expert!!", label: "Cloud expert", rationale: "r", evidenceQuote: "ran the cloud move", confidence: 1.7 }] })).toEqual([
      { kind: "DOMAIN", slug: "cloud-expert", label: "Cloud expert", rationale: "r", evidenceQuote: "ran the cloud move", confidence: 1 },
    ]);
    expect(readBadges({ badges: [{ kind: "ROLE_FIT", slug: "x-y", label: "L", rationale: "", evidenceQuote: "q q q", confidence: -3 }] })[0]!.confidence).toBe(0);
  });

  test("badges without a slug, label or evidence are dropped; at most eight; garbage is empty", () => {
    expect(readBadges({ badges: [{ slug: "", label: "L", evidenceQuote: "q" }, { slug: "s", label: "", evidenceQuote: "q" }, { slug: "s", label: "L", evidenceQuote: "" }] })).toEqual([]);
    expect(readBadges({ badges: Array.from({ length: 12 }, (_, i) => ({ slug: `s${i}`, label: "L", evidenceQuote: "quote", confidence: 0.9 })) })).toHaveLength(8);
    expect(readBadges(null)).toEqual([]);
    expect(readBadges({ badges: "no" })).toEqual([]);
  });

  test("contact details in badge text are stripped too", () => {
    const [b] = readBadges({ badges: [{ slug: "s", label: "Reach ada@example.com", rationale: "call +1 555 123 4567", evidenceQuote: "led the team", confidence: 0.9 }] });
    expect(b!.label).toBe("Reach");
    expect(b!.rationale).toBe("call");
  });
});

describe("aiAvailable", () => {
  test("none is off; the stub is always on; real providers need a real key", () => {
    expect(aiAvailable({ AI_PROVIDER: "none", OPENAI_API_KEY: "sk-x", GEMINI_API_KEY: "g" })).toBe(false);
    expect(aiAvailable({ AI_PROVIDER: "stub", OPENAI_API_KEY: undefined, GEMINI_API_KEY: undefined })).toBe(true);
    expect(aiAvailable({ AI_PROVIDER: "openai", OPENAI_API_KEY: "sk-x", GEMINI_API_KEY: undefined })).toBe(true);
    expect(aiAvailable({ AI_PROVIDER: "openai", OPENAI_API_KEY: "set-me", GEMINI_API_KEY: undefined })).toBe(false);
    expect(aiAvailable({ AI_PROVIDER: "openai", OPENAI_API_KEY: undefined, GEMINI_API_KEY: "g" })).toBe(false);
    expect(aiAvailable({ AI_PROVIDER: "gemini", OPENAI_API_KEY: "sk-x", GEMINI_API_KEY: undefined })).toBe(false);
    expect(aiAvailable({ AI_PROVIDER: "gemini", OPENAI_API_KEY: undefined, GEMINI_API_KEY: " set-me " })).toBe(false);
    expect(aiAvailable({ AI_PROVIDER: "gemini", OPENAI_API_KEY: undefined, GEMINI_API_KEY: "g-key" })).toBe(true);
  });
});
