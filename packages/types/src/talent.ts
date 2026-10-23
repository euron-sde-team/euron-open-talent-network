/** The talent, hiring and trust contract. Re-exported from index.ts. */
import type { ConnectionState, Media, MessagingEligibility, UserSummary } from "./index";

// ─── Enums (mirrors db/migrations) ──────────────────────────────────────────

export const EMPLOYMENT_TYPES = ["FULL_TIME", "PART_TIME", "CONTRACT", "FREELANCE", "INTERNSHIP", "TEMPORARY"] as const;
export type EmploymentType = (typeof EMPLOYMENT_TYPES)[number];
export const WORKPLACE_TYPES = ["ONSITE", "HYBRID", "REMOTE"] as const;
export type WorkplaceType = (typeof WORKPLACE_TYPES)[number];
export const SENIORITIES = ["INTERN", "ENTRY", "MID", "SENIOR", "LEAD", "DIRECTOR", "EXECUTIVE"] as const;
export type Seniority = (typeof SENIORITIES)[number];
export const PAY_PERIODS = ["HOUR", "DAY", "MONTH", "YEAR", "PROJECT"] as const;
export type PayPeriod = (typeof PAY_PERIODS)[number];
export const LINK_KINDS = ["WEBSITE", "GITHUB", "LINKEDIN", "X", "YOUTUBE", "MEDIUM", "KAGGLE", "HUGGINGFACE", "BEHANCE", "DRIBBBLE", "OTHER"] as const;
export type LinkKind = (typeof LINK_KINDS)[number];
export type ProfileStatus = "DRAFT" | "PUBLISHED" | "UNLISTED" | "SUSPENDED";
export type OpenToWorkMode = "OFF" | "RECRUITERS" | "PUBLIC";
export type BadgeKind = "SENIORITY" | "ROLE_FIT" | "SKILL_PERCENTILE" | "DOMAIN" | "ACHIEVEMENT" | "VERIFICATION";
export type BadgeSource = "AI" | "SYSTEM" | "ADMIN";
export const CONTACT_CHANNELS = ["EMAIL", "PHONE", "WHATSAPP"] as const;
export type ContactChannel = (typeof CONTACT_CHANNELS)[number];
/** Who can see a profile section (apps/api/src/domain/profile.ts). */
export type SectionAudience = "PUBLIC" | "CONNECTIONS" | "RECRUITERS";
export const PROFILE_SECTIONS = ["experience", "education", "projects", "skills", "certifications", "links"] as const;
export type ProfileSection = (typeof PROFILE_SECTIONS)[number];

export type CompanyStatus = "UNVERIFIED" | "VERIFIED" | "SUSPENDED";
export type CompanyRole = "OWNER" | "ADMIN" | "RECRUITER";
/** LEFT: left the company; the record stays so candidates keep their contact access log. */
export type RecruiterStatus = "EMAIL_PENDING" | "PENDING_REVIEW" | "ACTIVE" | "REJECTED" | "SUSPENDED" | "LEFT";
export type ApproachStatus = "PENDING" | "ACCEPTED" | "DECLINED" | "WITHDRAWN" | "EXPIRED" | "BLOCKED";
export type JobStatus = "DRAFT" | "OPEN" | "CLOSED" | "FILLED";
export type InviteStatus = "SENT" | "VIEWED" | "INTERESTED" | "DECLINED";
export const APPLICATION_STAGES = ["APPLIED", "SCREENING", "INTERVIEW", "OFFER", "HIRED", "REJECTED", "WITHDRAWN"] as const;
export type ApplicationStage = (typeof APPLICATION_STAGES)[number];
export type ApplicationSource = "DIRECT" | "INVITE" | "APPROACH";
export type EngagementStatus = "PROPOSED" | "ACTIVE" | "COMPLETED" | "CANCELLED" | "DISPUTED";
export type ComplaintCategory = "HARASSMENT" | "NON_PAYMENT" | "NO_SHOW" | "MISREPRESENTATION" | "SPAM" | "SCAM" | "DISCRIMINATION" | "OTHER";
export type ComplaintStatus = "OPEN" | "UNDER_REVIEW" | "ACTION_TAKEN" | "DISMISSED";
export type ImportStatus = "QUEUED" | "EXTRACTING" | "GENERATING" | "SCORING" | "READY" | "APPLIED" | "FAILED";
export type ImportSource = "TEXT" | "FILE" | "AUDIO";

export interface Salary {
  min: number | null;
  max: number | null;
  currency: string | null;
  period: PayPeriod | null;
}

// ─── Profile ────────────────────────────────────────────────────────────────

/** A month as "YYYY-MM". */
export type YearMonth = string;

export interface Experience {
  id: string;
  title: string;
  companyName: string;
  company: { id: string; slug: string; name: string; logoUrl: string | null } | null;
  employmentType: EmploymentType | null;
  workplaceType: WorkplaceType | null;
  location: string | null;
  startMonth: YearMonth;
  /** null = current role. */
  endMonth: YearMonth | null;
  description: string | null;
  skills: string[];
}

export interface Education {
  id: string;
  institution: string;
  degree: string | null;
  field: string | null;
  startYear: number | null;
  endYear: number | null;
  grade: string | null;
  description: string | null;
}

export interface Project {
  id: string;
  name: string;
  description: string | null;
  url: string | null;
  repoUrl: string | null;
  cover: Media | null;
  skills: string[];
  startMonth: YearMonth | null;
  endMonth: YearMonth | null;
}

export interface Skill {
  id: string;
  name: string;
  category: string | null;
  years: number | null;
  endorsementCount: number;
  /** The viewer endorsed this skill (signed-in connections only). */
  endorsedByViewer: boolean;
}

export interface Certification {
  id: string;
  name: string;
  issuer: string | null;
  issuedMonth: YearMonth | null;
  expiresMonth: YearMonth | null;
  credentialId: string | null;
  credentialUrl: string | null;
}

export interface ProfileLink {
  id: string;
  kind: LinkKind;
  url: string;
  label: string | null;
  featured: boolean;
  /** YouTube video id when the link can be embedded (click-to-load). */
  embedId: string | null;
}

export interface Badge {
  id: string;
  kind: BadgeKind;
  source: BadgeSource;
  slug: string;
  label: string;
  rationale: string | null;
  evidenceQuote: string | null;
  confidence: number | null;
  percentile: number | null;
  isVisible: boolean;
}

export interface RatingSummary {
  /** Bayesian average (apps/api/src/domain/profile.ts, displayRating), so three 5-star ratings do not beat thirty 4.8s. */
  average: number | null;
  count: number;
}

/**
 * GET /api/profiles/:username. Sections the viewer may not see are omitted (and listed
 * in `hiddenSections` so the page can say "visible to connections").
 */
export interface Profile {
  user: UserSummary;
  status: ProfileStatus;
  coverUrl: string | null;
  headline: string | null;
  about: string | null;
  currentTitle: string | null;
  currentCompany: string | null;
  location: string | null;
  countryCode: string | null;
  yearsExperience: number | null;
  languages: string[];
  /** Only present when the viewer may see the open-to-work signal. */
  openToWork: { roles: string[]; employmentTypes: EmploymentType[]; workplaceTypes: WorkplaceType[]; availableFrom: string | null } | null;
  rate: Salary | null;
  experience: Experience[];
  education: Education[];
  projects: Project[];
  skills: Skill[];
  certifications: Certification[];
  links: ProfileLink[];
  badges: Badge[];
  hiddenSections: ProfileSection[];
  rating: RatingSummary;
  connectionCount: number;
  followerCount: number;
  completeness: number;
  publishedAt: string | null;
  viewer: ProfileViewer;
}

export interface ProfileViewer {
  isSelf: boolean;
  signedIn: boolean;
  connection: ConnectionState;
  connectionId: string | null;
  following: boolean;
  blocked: boolean;
  mutualCount: number;
  messaging: MessagingEligibility;
  /** Present when the viewer is an ACTIVE recruiter. */
  recruiter: {
    saved: boolean;
    /** Why a new approach is not possible right now, or null. */
    approachBlockedReason: "ALREADY_PENDING" | "COOLDOWN" | "QUOTA" | "NOT_PUBLISHED" | null;
    cooldownUntil: string | null;
    /** An accepted approach whose contact unlock is still live. */
    unlockedApproachId: string | null;
  } | null;
}

/** GET /api/profiles/me: the owner's full view, including private fields. */
export interface MyProfile extends Profile {
  contact: { email: string | null; phone: string | null; whatsapp: string | null };
  openToWorkMode: OpenToWorkMode;
  openToWorkSettings: { roles: string[]; employmentTypes: EmploymentType[]; workplaceTypes: WorkplaceType[]; availableFrom: string | null };
  sectionVisibility: Partial<Record<ProfileSection, SectionAudience>>;
  /** Publishing needs completeness >= `publishThreshold` and at least one contact channel. */
  publishThreshold: number;
  missing: string[];
}

/** A directory card (GET /api/search/people). */
export interface TalentCard {
  user: UserSummary;
  headline: string | null;
  location: string | null;
  yearsExperience: number | null;
  topSkills: string[];
  badges: Pick<Badge, "slug" | "label" | "kind">[];
  rating: RatingSummary;
  openToWork: boolean;
  connection: ConnectionState;
  /** Whether the viewer saved this candidate; only ever true for an ACTIVE recruiter. */
  saved: boolean;
  /** Skills of the search that this person matched, for highlighting. */
  matchedSkills: string[];
}

export interface DirectoryFacets {
  skills: { name: string; count: number }[];
  locations: { name: string; count: number }[];
}

export interface ProfileAnalytics {
  views7d: number;
  views30d: number;
  daily: { date: string; views: number }[];
  /** Companies of recruiters who viewed the profile in the last 30 days. */
  recruiterCompanies: { name: string; slug: string; views: number }[];
  approaches: { pending: number; accepted: number; total: number };
  searchAppearances30d: number;
}

export interface ContactAccessEntry {
  id: string;
  recruiter: UserSummary;
  company: { slug: string; name: string };
  channel: ContactChannel;
  viewedAt: string;
}

// ─── AI import ──────────────────────────────────────────────────────────────

/** What the AI proposes; the owner accepts sections one by one. */
export interface ProposedProfile {
  headline: string | null;
  about: string | null;
  currentTitle: string | null;
  location: string | null;
  yearsExperience: number | null;
  experience: Omit<Experience, "id" | "company">[];
  education: Omit<Education, "id">[];
  projects: Omit<Project, "id" | "cover">[];
  skills: { name: string; category: string | null; years: number | null }[];
  certifications: Omit<Certification, "id">[];
  links: Omit<ProfileLink, "id" | "embedId">[];
}

export interface ProfileImport {
  id: string;
  source: ImportSource;
  status: ImportStatus;
  proposal: ProposedProfile | null;
  proposedBadges: Pick<Badge, "kind" | "slug" | "label" | "rationale" | "evidenceQuote" | "confidence">[];
  missingInfo: string[];
  error: string | null;
  createdAt: string;
  updatedAt: string;
}

// ─── Companies and recruiters ───────────────────────────────────────────────

export interface CompanySummary {
  id: string;
  slug: string;
  name: string;
  tagline: string | null;
  logoUrl: string | null;
  industry: string | null;
  sizeBand: string | null;
  headquarters: string | null;
  status: CompanyStatus;
  followerCount: number;
  openJobCount: number;
  /** Whether the viewer follows this page; false when signed out. */
  viewerFollowing: boolean;
}

export interface Company extends CompanySummary {
  about: string | null;
  website: string | null;
  foundedYear: number | null;
  coverUrl: string | null;
  memberCount: number;
  rating: RatingSummary;
  viewer: {
    following: boolean;
    /** The viewer's role on the team, when they are an ACTIVE recruiter here. */
    role: CompanyRole | null;
    canManage: boolean;
  };
  /** Present for company admins and platform staff. */
  manage?: { domains: string[]; autoApproveDomain: boolean };
}

export interface TeamMember {
  recruiterId: string;
  user: UserSummary;
  role: CompanyRole;
  status: RecruiterStatus;
  title: string | null;
  joinedAt: string;
}

/** GET /api/recruiter/me */
export interface RecruiterAccount {
  id: string;
  status: RecruiterStatus;
  role: CompanyRole;
  title: string | null;
  workEmail: string;
  workEmailVerified: boolean;
  company: CompanySummary;
  reviewNote: string | null;
  quota: { approachesPerDay: number; usedToday: number };
  createdAt: string;
}

// ─── Approaches ─────────────────────────────────────────────────────────────

export interface Approach {
  id: string;
  status: ApproachStatus;
  recruiter: UserSummary;
  company: Pick<CompanySummary, "id" | "slug" | "name" | "logoUrl" | "status">;
  candidate: UserSummary;
  job: { id: string; title: string } | null;
  roleTitle: string;
  message: string;
  employmentType: EmploymentType | null;
  salary: Salary | null;
  /** Channels the candidate shared (ACCEPTED only). */
  unlockedChannels: ContactChannel[];
  unlockRevoked: boolean;
  declineReason: string | null;
  threadId: string | null;
  viewedAt: string | null;
  respondedAt: string | null;
  expiresAt: string;
  createdAt: string;
}

/** GET /api/approaches/:id/contact: logged, and visible to the candidate. */
export interface ContactReveal {
  approachId: string;
  email: string | null;
  phone: string | null;
  whatsapp: string | null;
  /** https://wa.me/<digits> when WhatsApp was shared. */
  whatsappLink: string | null;
}

// ─── Jobs and applications ──────────────────────────────────────────────────

export interface ScreeningQuestion {
  id: string;
  prompt: string;
  kind: "TEXT" | "YES_NO";
  required: boolean;
}

export interface Job {
  id: string;
  company: Pick<CompanySummary, "id" | "slug" | "name" | "logoUrl" | "status">;
  title: string;
  description: string;
  employmentType: EmploymentType;
  workplaceType: WorkplaceType;
  seniority: Seniority | null;
  location: string | null;
  countryCode: string | null;
  salary: Salary | null;
  skills: string[];
  openings: number;
  screeningQuestions: ScreeningQuestion[];
  status: JobStatus;
  applicationCount: number;
  openedAt: string | null;
  closesAt: string | null;
  createdAt: string;
  postedBy: UserSummary | null;
  viewer: {
    saved: boolean;
    /** The viewer's own application, if any. */
    application: { id: string; stage: ApplicationStage; appliedAt: string } | null;
    /** Skill overlap with the viewer's profile, 0..100 (null when signed out). */
    matchScore: number | null;
    matchedSkills: string[];
    canManage: boolean;
  };
}

export interface ApplicationAnswer {
  questionId: string;
  answer: string;
}

/** The profile as submitted with an application. */
export interface ProfileSnapshot {
  headline: string | null;
  location: string | null;
  yearsExperience: number | null;
  experience: Pick<Experience, "title" | "companyName" | "startMonth" | "endMonth">[];
  education: Pick<Education, "institution" | "degree" | "field" | "endYear">[];
  skills: string[];
}

/** The recruiter's view of an application (team-only fields included). */
export interface Application {
  id: string;
  job: { id: string; title: string };
  candidate: UserSummary;
  source: ApplicationSource;
  stage: ApplicationStage;
  snapshot: ProfileSnapshot;
  resume: Media | null;
  coverNote: string | null;
  answers: (ApplicationAnswer & { prompt: string })[];
  matchScore: number | null;
  matchDetail: { matched: string[]; missing: string[] } | null;
  rejectionReason: string | null;
  threadId: string | null;
  noteCount: number;
  averageRating: number | null;
  stageChangedAt: string;
  createdAt: string;
  /**
   * Every stage the application went through, oldest first. Filled only by
   * GET /api/applications/:id; pipeline, stage pages, moves and live card events send []
   * to stay cheap. `by` is the teammate who moved it (null for the candidate's own steps
   * and the system); `reason` is the standing rejection reason or the move's team note.
   */
  history: { stage: ApplicationStage; at: string; by: UserSummary | null; reason: string | null }[];
}

/** The candidate's own view (no team notes, no ratings). */
export interface MyApplication {
  id: string;
  job: Pick<Job, "id" | "title" | "company" | "location" | "workplaceType" | "employmentType" | "status">;
  stage: ApplicationStage;
  timeline: { stage: ApplicationStage; at: string }[];
  threadId: string | null;
  createdAt: string;
}

export interface CandidateNote {
  id: string;
  author: UserSummary;
  applicationId: string | null;
  body: string;
  rating: number | null;
  createdAt: string;
}

export interface PipelineColumn {
  stage: ApplicationStage;
  count: number;
  items: Application[];
}

export interface JobInvite {
  id: string;
  job: Pick<Job, "id" | "title" | "company" | "location" | "workplaceType" | "employmentType" | "status">;
  invitedBy: UserSummary;
  message: string | null;
  status: InviteStatus;
  createdAt: string;
}

// ─── Trust ──────────────────────────────────────────────────────────────────

export interface Engagement {
  id: string;
  title: string;
  status: EngagementStatus;
  company: Pick<CompanySummary, "id" | "slug" | "name" | "logoUrl">;
  recruiter: UserSummary;
  candidate: UserSummary;
  approachId: string | null;
  applicationId: string | null;
  candidateConfirmed: boolean;
  recruiterConfirmed: boolean;
  completionRequestedBy: string | null;
  completionRequestedAt: string | null;
  completedAt: string | null;
  /** Ratings: whether each side has rated, and the viewer's own rating once given. */
  rating: {
    viewerRated: boolean;
    counterpartRated: boolean;
    windowClosesAt: string | null;
    canRate: boolean;
  };
  createdAt: string;
}

export interface SubScores {
  communication: number;
  quality: number;
  reliability: number;
  professionalism: number;
}

export interface Rating {
  id: string;
  engagementId: string;
  rater: UserSummary;
  score: number;
  subScores: Partial<SubScores>;
  comment: string | null;
  revealedAt: string | null;
  createdAt: string;
}

export interface Complaint {
  id: string;
  complainant: UserSummary;
  against: UserSummary;
  category: ComplaintCategory;
  description: string;
  evidence: Media[];
  status: ComplaintStatus;
  adminNote: string | null;
  engagementId: string | null;
  approachId: string | null;
  applicationId: string | null;
  resolvedAt: string | null;
  createdAt: string;
}

// ─── Search ─────────────────────────────────────────────────────────────────

export interface SearchResults {
  people: TalentCard[];
  jobs: Job[];
  companies: CompanySummary[];
}
