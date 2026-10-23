/** Contract types of the /admin control plane. Re-exported from index.ts. */
import type { Media, ModerationSettings, UserRole, UserStatus, UserSummary } from "./index";
import type { CompanySummary, ComplaintStatus, ProfileStatus, RecruiterStatus } from "./talent";

/** A row of GET /api/admin/users (and the response of the account actions). */
export interface AdminUserRow extends UserSummary {
  email: string;
  status: UserStatus;
  profileStatus: ProfileStatus;
  createdAt: string;
  lastSeenAt: string | null;
  suspendedUntil: string | null;
}

/** GET /api/admin/stats?from=&to= : the overview dashboard. */
export interface AdminStats {
  range: { from: string; to: string; timezone: string };
  totals: {
    users: number;
    activeUsers7d: number;
    profilesPublished: number;
    companies: number;
    companiesVerified: number;
    recruitersActive: number;
    recruitersPendingReview: number;
    jobsOpen: number;
    applications: number;
    openCases: number;
    openComplaints: number;
  };
  funnel: { signups: number; profilesPublished: number; applied: number; hired: number };
  hiring: {
    approachesSent: number;
    approachAcceptanceRate: number | null;
    applicationsPerOpenJob: number | null;
    /** Median days from application to HIRED, for hires in the range. */
    medianDaysToHire: number | null;
  };
  trust: {
    complaintsOpened: number;
    /** Median hours from complaint to resolution, for complaints resolved in the range. */
    medianComplaintHours: number | null;
    casesResolved: number;
  };
  daily: { date: string; signups: number; published: number; applications: number; approaches: number; posts: number }[];
  topSkills: { name: string; count: number }[];
}

/** A row of the recruiter approval queue (GET /api/admin/recruiters). */
export interface AdminRecruiterRow {
  id: string;
  user: UserSummary & { email: string };
  company: CompanySummary & { domains: string[] };
  status: RecruiterStatus;
  title: string | null;
  workEmail: string;
  workEmailVerified: boolean;
  /** The work-email domain is one of the company's domains. */
  domainMatches: boolean;
  /** The domain is a free-mail provider (settings: recruiter.freeMailDomains). */
  freeMail: boolean;
  applicationNote: string | null;
  reviewNote: string | null;
  reviewedBy: UserSummary | null;
  reviewedAt: string | null;
  approachesSent: number;
  createdAt: string;
}

export interface AdminCompanyRow extends CompanySummary {
  domains: string[];
  autoApproveDomain: boolean;
  memberCount: number;
  website: string | null;
  verifiedAt: string | null;
  suspendedReason: string | null;
  createdAt: string;
}

export interface AdminComplaintRow {
  id: string;
  complainant: UserSummary & { email: string };
  against: UserSummary & { email: string };
  category: string;
  description: string;
  /** Uploads attached by the complainant, including ones no longer presentable. */
  evidenceCount: number;
  /** The presentable evidence, signed per response (rejected or unprocessed uploads are left out). */
  evidence: Media[];
  /** What the complaint is about: at most one is usually set. */
  engagementId: string | null;
  approachId: string | null;
  applicationId: string | null;
  status: ComplaintStatus;
  adminNote: string | null;
  priorComplaintsAgainst: number;
  createdAt: string;
  resolvedAt: string | null;
}

/** Everything an operator can tune at runtime (PUT /api/admin/settings). */
export interface PlatformSettings {
  networkName: string;
  registration: "OPEN" | "CLOSED";
  profile: { publishThreshold: number; usernameCooldownDays: number };
  recruiter: {
    approachesPerDay: number;
    approachExpiryDays: number;
    declineCooldownDays: number;
    maxOpenJobsPerCompany: number;
    freeMailDomains: string[];
    /** Recruiters of a VERIFIED company whose domain matches skip review when the company allows it. */
    allowDomainAutoApprove: boolean;
  };
  messaging: { requestsPerDay: number; requestMessageCap: number };
  trust: { autoConfirmDays: number; ratingWindowDays: number; complaintsPer30Days: number };
  import: { enabled: boolean; perDay: number; retentionHours: number };
  analytics: { timezone: string };
  moderation: ModerationSettings;
}

export interface AuditEntry {
  id: string;
  actor: UserSummary | null;
  action: string;
  entityType: string;
  entityId: string | null;
  data: Record<string, unknown>;
  createdAt: string;
}

/** GET /api/moderation/stats */
export interface ModerationStats {
  openCases: number;
  openAppeals: number;
  actionsToday: number;
  autoHiddenToday: number;
}

/** Which /admin areas a role can open (domain/admin-permissions.ts). */
export type AdminArea = "overview" | "recruiters" | "companies" | "moderation" | "people" | "jobs" | "complaints" | "settings" | "audit";
export type AdminPermissions = Record<AdminArea, boolean>;
export type { UserRole };
