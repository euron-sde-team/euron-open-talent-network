import { describe, expect, test } from "vitest";
import { domainMatches, EMAIL_CODE_MAX_ATTEMPTS, EMAIL_CODE_TTL_MS, emailDomain, isFreeMail, newEmailCode, reviewRoute } from "../../src/domain/recruiter-verification";
import { FREE_MAIL_DOMAINS } from "../../src/services/settings.service";

const FREE = ["freemail.example", "mailbox.test"];

describe("emailDomain", () => {
  test("the part after the last @, trimmed and lower-cased", () => {
    expect(emailDomain("ada@Example.COM ")).toBe("example.com");
    expect(emailDomain("first.last+tag@jobs.example.test")).toBe("jobs.example.test");
    expect(emailDomain('"odd@local"@example.test')).toBe("example.test");
  });

  test("no usable domain: null", () => {
    expect(emailDomain("not-an-email")).toBeNull();
    expect(emailDomain("@example.test")).toBeNull();
    expect(emailDomain("ada@")).toBeNull();
    expect(emailDomain("ada@   ")).toBeNull();
  });
});

describe("isFreeMail", () => {
  test("listed domains and their sub-domains, any case", () => {
    expect(isFreeMail("ada@freemail.example", FREE)).toBe(true);
    expect(isFreeMail("ada@FREEMAIL.example", FREE)).toBe(true);
    expect(isFreeMail("ada@eu.freemail.example", FREE)).toBe(true);
    expect(isFreeMail("ada@company.test", FREE)).toBe(false);
  });

  test("an address without a domain is treated as free mail (it proves nothing)", () => {
    expect(isFreeMail("ada", FREE)).toBe(true);
  });

  test("the platform default list covers the big providers", () => {
    for (const d of ["gmail.com", "outlook.com", "yahoo.com", "proton.me", "icloud.com", "mailinator.com"]) expect(isFreeMail(`someone@${d}`, FREE_MAIL_DOMAINS)).toBe(true);
  });
});

describe("domainMatches", () => {
  const f = (workEmail: string, companyDomains: string[]) => domainMatches({ workEmail, companyDomains, freeMailDomains: FREE });

  test("the exact domain or a sub-domain of a company domain", () => {
    expect(f("ada@fictional.test", ["fictional.test"])).toBe(true);
    expect(f("ada@eng.fictional.test", ["fictional.test"])).toBe(true);
    expect(f("ada@Fictional.TEST", ["FICTIONAL.test"])).toBe(true);
    expect(f("ada@other.test", ["fictional.test", "other.test"])).toBe(true);
  });

  test("a look-alike suffix is not a match", () => {
    expect(f("ada@notfictional.test", ["fictional.test"])).toBe(false);
    expect(f("ada@fictional.test.evil.test", ["fictional.test"])).toBe(false);
  });

  test("free mail never matches, even when a company lists that domain", () => {
    expect(f("ada@freemail.example", ["freemail.example"])).toBe(false);
  });

  test("no domains or no valid email: no match", () => {
    expect(f("ada@fictional.test", [])).toBe(false);
    expect(f("ada", ["fictional.test"])).toBe(false);
  });
});

describe("reviewRoute", () => {
  const ok = { workEmail: "ada@fictional.test", companyDomains: ["fictional.test"], freeMailDomains: FREE, companyVerified: true, companyAllowsAuto: true, platformAllowsAuto: true };

  test("auto-approve only when the company is verified, allows it, the platform allows it and the domain matches", () => {
    expect(reviewRoute(ok)).toBe("AUTO_APPROVE");
    expect(reviewRoute({ ...ok, companyVerified: false })).toBe("REVIEW");
    expect(reviewRoute({ ...ok, companyAllowsAuto: false })).toBe("REVIEW");
    expect(reviewRoute({ ...ok, platformAllowsAuto: false })).toBe("REVIEW");
    expect(reviewRoute({ ...ok, workEmail: "ada@elsewhere.test" })).toBe("REVIEW");
    expect(reviewRoute({ ...ok, workEmail: "ada@freemail.example", companyDomains: ["freemail.example"] })).toBe("REVIEW");
  });
});

describe("email codes", () => {
  test("six digits, zero-padded", () => {
    expect(newEmailCode(() => 42)).toBe("000042");
    expect(newEmailCode(() => 0)).toBe("000000");
    expect(newEmailCode(() => 999_999)).toBe("999999");
  });

  test("the random source is asked for a number below one million", () => {
    let asked = 0;
    newEmailCode((max) => {
      asked = max;
      return 1;
    });
    expect(asked).toBe(1_000_000);
  });

  test("fifteen minutes and five attempts", () => {
    expect(EMAIL_CODE_TTL_MS).toBe(15 * 60_000);
    expect(EMAIL_CODE_MAX_ATTEMPTS).toBe(5);
  });
});
