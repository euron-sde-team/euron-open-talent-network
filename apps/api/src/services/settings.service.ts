/**
 * Platform settings: one JSON document per key in the `settings` table, merged over the
 * defaults below, cached for a few seconds per process. Admins edit them through
 * /api/admin/settings.
 */
import type { PlatformSettings } from "@open-talent/types";
import { config } from "../core/config";
import { db, type Executor } from "../db/kysely";

/**
 * Free-mail and disposable domains that cannot prove company membership. Recruiters
 * using one can still apply, but their application says so in the review queue and
 * they never qualify for domain auto-approval.
 */
export const FREE_MAIL_DOMAINS = [
  "gmail.com", "googlemail.com", "yahoo.com", "yahoo.co.uk", "ymail.com", "outlook.com", "hotmail.com", "live.com", "msn.com",
  "icloud.com", "me.com", "mac.com", "aol.com", "proton.me", "protonmail.com", "gmx.com", "gmx.de", "mail.com", "zoho.com",
  "yandex.com", "yandex.ru", "qq.com", "163.com", "126.com", "rediffmail.com", "tutanota.com", "fastmail.com", "hey.com",
  "mailinator.com", "guerrillamail.com", "10minutemail.com", "tempmail.com", "sharklasers.com",
];

export const DEFAULT_SETTINGS: PlatformSettings = {
  networkName: config.PRODUCT_NAME,
  registration: "OPEN",
  profile: { publishThreshold: 55, usernameCooldownDays: 30 },
  recruiter: {
    approachesPerDay: 25,
    approachExpiryDays: 14,
    declineCooldownDays: 30,
    maxOpenJobsPerCompany: 50,
    freeMailDomains: FREE_MAIL_DOMAINS,
    allowDomainAutoApprove: true,
  },
  messaging: { requestsPerDay: 20, requestMessageCap: 3 },
  trust: { autoConfirmDays: 14, ratingWindowDays: 60, complaintsPer30Days: 3 },
  import: { enabled: true, perDay: 5, retentionHours: 72 },
  analytics: { timezone: "UTC" },
  moderation: {
    enabled: true,
    provider: config.MODERATION_PROVIDER,
    // Scores are 0..1. At or above `review` the item enters the queue and stays visible;
    // at or above `hide` it is hidden at once and the author can appeal.
    thresholds: {
      harassment: { review: 0.5, hide: 0.85 },
      hate: { review: 0.4, hide: 0.8 },
      violence: { review: 0.5, hide: 0.85 },
      sexual: { review: 0.5, hide: 0.85 },
      "sexual/minors": { review: 0.1, hide: 0.3 },
      "self-harm": { review: 0.3, hide: 0.9 },
      illicit: { review: 0.6, hide: 0.9 },
      spam: { review: 0.6, hide: 0.9 },
    },
    premoderateNewAccounts: { enabled: false, firstPosts: 3, accountAgeDays: 2 },
    blockedTerms: [],
  },
};

const TTL_MS = 5_000;
let cache: { at: number; value: PlatformSettings } | null = null;

/** Deep enough for this document: every top-level group is merged key by key. */
function merge(base: PlatformSettings, stored: Partial<PlatformSettings>): PlatformSettings {
  return {
    ...base,
    ...stored,
    profile: { ...base.profile, ...(stored.profile ?? {}) },
    recruiter: { ...base.recruiter, ...(stored.recruiter ?? {}) },
    messaging: { ...base.messaging, ...(stored.messaging ?? {}) },
    trust: { ...base.trust, ...(stored.trust ?? {}) },
    import: { ...base.import, ...(stored.import ?? {}) },
    analytics: { ...base.analytics, ...(stored.analytics ?? {}) },
    moderation: {
      ...base.moderation,
      ...(stored.moderation ?? {}),
      thresholds: { ...base.moderation.thresholds, ...(stored.moderation?.thresholds ?? {}) },
      premoderateNewAccounts: { ...base.moderation.premoderateNewAccounts, ...(stored.moderation?.premoderateNewAccounts ?? {}) },
    },
  };
}

export async function getSettings(exec: Executor = db): Promise<PlatformSettings> {
  if (cache && Date.now() - cache.at < TTL_MS) return cache.value;
  const row = await exec.selectFrom("settings").select("value").where("key", "=", "platform").executeTakeFirst();
  const value = merge(DEFAULT_SETTINGS, (row?.value as Partial<PlatformSettings>) ?? {});
  cache = { at: Date.now(), value };
  return value;
}

export async function saveSettings(patch: Partial<PlatformSettings>, actorId: string, exec: Executor = db): Promise<PlatformSettings> {
  const current = await getSettings(exec);
  const next = merge(current, patch);
  await exec
    .insertInto("settings")
    .values({ key: "platform", value: JSON.stringify(next), updated_by: actorId })
    .onConflict((oc) => oc.column("key").doUpdateSet({ value: JSON.stringify(next), updated_by: actorId, updated_at: new Date() }))
    .execute();
  cache = null;
  return next;
}

export function clearSettingsCache(): void {
  cache = null;
}

/** The name to show for this network (emails, page titles): settings.networkName, else PRODUCT_NAME. */
export async function networkName(exec: Executor = db): Promise<string> {
  return (await getSettings(exec)).networkName?.trim() || config.PRODUCT_NAME;
}
