/**
 * One helper per API route, grouped by area (the same groups as apps/api/src/routes).
 * Paths here are relative to the API base (which includes /api).
 */
import type {
  AdminArea,
  AdminComplaintRow,
  AdminCompanyRow,
  AdminPermissions,
  AdminRecruiterRow,
  AdminStats,
  AdminUserRow,
  Application,
  ApplicationStage,
  Appeal,
  Approach,
  ApproachStatus,
  AuditEntry,
  AuthResult,
  CandidateNote,
  CaseSource,
  Comment,
  Company,
  CompanySummary,
  ComplaintCategory,
  ComplaintStatus,
  Complaint,
  ContactAccessEntry,
  ContactChannel,
  ContactReveal,
  DirectoryFacets,
  EmploymentType,
  Engagement,
  FollowEntry,
  Job,
  JobInvite,
  JobStatus,
  LinkKind,
  Me,
  Media,
  Message,
  MessageRequestPolicy,
  MessagingEligibility,
  ModerationActionRecord,
  ModerationActionType,
  ModerationCase,
  ModerationStats,
  ModerationTarget,
  MyApplication,
  MyProfile,
  NetworkEntry,
  NetworkMeta,
  Notification,
  NotificationCounts,
  OpenToWorkMode,
  Page,
  PayPeriod,
  PipelineColumn,
  PlatformSettings,
  Post,
  PostKind,
  PostVisibility,
  Profile,
  ProfileAnalytics,
  ProfileImport,
  ProfileSection,
  Rating,
  RatingSummary,
  ReactionCounts,
  ReactionType,
  RecruiterAccount,
  ReportReason,
  SearchResults,
  SectionAudience,
  Seniority,
  SubScores,
  TalentCard,
  TeamMember,
  Thread,
  UserRole,
  UserStatus,
  UserSummary,
  WorkplaceType,
} from "@open-talent/types";
import type { HttpClient, Query } from "./http";
import { uploadMedia, type UploadOptions } from "./upload";

export interface PageQuery {
  cursor?: string;
  limit?: number;
}

const enc = encodeURIComponent;

export interface SessionInfo {
  id: string;
  userAgent: string | null;
  ip: string | null;
  createdAt: string;
  lastUsedAt: string | null;
  current: boolean;
}

export interface ReactionSummary {
  reactionCount: number;
  reactionCounts: ReactionCounts;
  viewerReaction: ReactionType | null;
}

export interface Contact {
  user: UserSummary;
  online: boolean;
  lastSeenAt: string | null;
}

export interface SalaryInput {
  min: number | null;
  max: number | null;
  currency: string | null;
  period: PayPeriod | null;
}

export interface NewPostInput {
  body: string;
  kind?: PostKind;
  visibility?: PostVisibility;
  companyId?: string;
  jobId?: string;
  mediaIds?: string[];
  sharedPostId?: string;
}

export interface BasicsInput {
  headline?: string | null;
  about?: string | null;
  currentTitle?: string | null;
  currentCompany?: string | null;
  location?: string | null;
  countryCode?: string | null;
  timezone?: string | null;
  yearsExperience?: number | null;
  languages?: string[];
  rate?: SalaryInput | null;
}

export interface OpenToWorkInput {
  mode: OpenToWorkMode;
  roles: string[];
  employmentTypes: EmploymentType[];
  workplaceTypes: WorkplaceType[];
  availableFrom: string | null;
}

export interface ExperienceInput {
  title: string;
  companyName: string;
  companySlug?: string | null;
  employmentType?: EmploymentType | null;
  workplaceType?: WorkplaceType | null;
  location?: string | null;
  startMonth: string;
  endMonth?: string | null;
  description?: string | null;
  skills?: string[];
}
export interface EducationInput {
  institution: string;
  degree?: string | null;
  field?: string | null;
  startYear?: number | null;
  endYear?: number | null;
  grade?: string | null;
  description?: string | null;
}
export interface ProjectInput {
  name: string;
  description?: string | null;
  url?: string | null;
  repoUrl?: string | null;
  coverUploadId?: string | null;
  skills?: string[];
  startMonth?: string | null;
  endMonth?: string | null;
}
export interface SkillInput {
  name: string;
  category?: string | null;
  years?: number | null;
}
export interface CertificationInput {
  name: string;
  issuer?: string | null;
  issuedMonth?: string | null;
  expiresMonth?: string | null;
  credentialId?: string | null;
  credentialUrl?: string | null;
}
export interface LinkInput {
  kind: LinkKind;
  url: string;
  label?: string | null;
  featured?: boolean;
}

export interface SectionItems {
  experience: ExperienceInput[];
  education: EducationInput[];
  projects: ProjectInput[];
  skills: SkillInput[];
  certifications: CertificationInput[];
  links: LinkInput[];
}

export interface DirectoryQuery extends PageQuery {
  q?: string;
  skills?: string[];
  location?: string;
  openToWork?: boolean;
  employment?: EmploymentType[];
  workplace?: WorkplaceType[];
  minYears?: number;
  maxYears?: number;
  sort?: "relevance" | "recent" | "experience";
}

export interface JobQuery extends PageQuery {
  q?: string;
  location?: string;
  workplace?: WorkplaceType[];
  employment?: EmploymentType[];
  seniority?: Seniority[];
  skills?: string[];
  company?: string;
  salaryMin?: number;
  postedWithinDays?: number;
  sort?: "recent" | "relevance";
}

export interface JobInput {
  title: string;
  description: string;
  employmentType: EmploymentType;
  workplaceType: WorkplaceType;
  seniority?: Seniority | null;
  location?: string | null;
  countryCode?: string | null;
  salary?: SalaryInput | null;
  skills?: string[];
  openings?: number;
  screeningQuestions?: { id?: string; prompt: string; kind: "TEXT" | "YES_NO"; required: boolean }[];
  closesAt?: string | null;
}

export interface CompanyInput {
  name?: string;
  tagline?: string | null;
  about?: string | null;
  website?: string | null;
  industry?: string | null;
  sizeBand?: string | null;
  headquarters?: string | null;
  foundedYear?: number | null;
  logoUploadId?: string | null;
  coverUploadId?: string | null;
  domains?: string[];
  autoApproveDomain?: boolean;
}

export interface RegisterRecruiterInput {
  companySlug?: string;
  newCompany?: { name: string; website?: string | null; industry?: string | null; sizeBand?: string | null; headquarters?: string | null };
  workEmail: string;
  title?: string | null;
  note?: string | null;
}

export interface SavedSearch {
  id: string;
  name: string;
  query: Omit<DirectoryQuery, "cursor" | "limit">;
  createdAt: string;
}

const csv = (v?: readonly string[]) => (v && v.length ? v.join(",") : undefined);

export interface SignupInput {
  email: string;
  username: string;
  displayName: string;
  password: string;
}

export interface LoginInput {
  login: string;
  password: string;
  totp?: string;
  /** A one-time recovery code, sent instead of `totp`. */
  recoveryCode?: string;
}

export type SignupResult = AuthResult | { verificationRequired: true; email: string };
export type LoginResult = AuthResult | { totpRequired: true };

export function createEndpoints(http: HttpClient) {
  const get = <T>(path: string, query?: Query, signal?: AbortSignal) => http.request<T>("GET", path, { query, signal });
  const post = <T = void>(path: string, body?: unknown) => http.request<T>("POST", path, { body });
  const put = <T = void>(path: string, body?: unknown) => http.request<T>("PUT", path, { body });
  const patch = <T = void>(path: string, body?: unknown) => http.request<T>("PATCH", path, { body });
  const del = <T = void>(path: string, query?: Query) => http.request<T>("DELETE", path, { query });
  const pq = (q?: object) => q as Query | undefined;
  const download = async (path: string): Promise<Blob> => (await http.request<Response>("GET", path, { raw: true })).blob();

  const auth = {
    signup: (body: SignupInput) =>
      http.request<SignupResult>("POST", "/auth/signup", { body, withCredentials: true, noRefresh: true }),
    verifyEmail: (token: string) => http.request<AuthResult>("POST", "/auth/verify-email", { body: { token }, withCredentials: true, noRefresh: true }),
    resendVerification: (email: string) => http.request<void>("POST", "/auth/resend-verification", { body: { email }, noRefresh: true }),
    login: (body: LoginInput) =>
      http.request<LoginResult>("POST", "/auth/login", { body, withCredentials: true, noRefresh: true }),
    refresh: () => http.refreshSession(),
    logout: () => http.request<void>("POST", "/auth/logout", { withCredentials: true, noRefresh: true }),
    logoutAll: () => http.request<void>("POST", "/auth/logout-all", { withCredentials: true }),
    forgotPassword: (email: string) => http.request<void>("POST", "/auth/forgot-password", { body: { email }, noRefresh: true }),
    resetPassword: (token: string, password: string) => http.request<void>("POST", "/auth/reset-password", { body: { token, password }, noRefresh: true }),
    changePassword: (currentPassword: string, newPassword: string) =>
      http.request<void>("POST", "/auth/change-password", { body: { currentPassword, newPassword }, withCredentials: true }),
    me: (signal?: AbortSignal) => get<Me>("/auth/me", undefined, signal),
    totpSetup: () => post<{ secret: string; otpauthUrl: string }>("/auth/totp/setup"),
    /** Turns two-factor on and returns the one-time recovery codes (shown once). */
    totpEnable: (code: string) => post<{ recoveryCodes: string[] }>("/auth/totp/enable", { code }),
    totpDisable: (password: string, code: string) => post("/auth/totp/disable", { password, code }),
    /** Replaces every recovery code with a fresh set. */
    totpRecoveryCodes: (password: string, code: string) => post<{ recoveryCodes: string[] }>("/auth/totp/recovery-codes", { password, code }),
  };

  const meta = {
    get: (signal?: AbortSignal) => http.request<NetworkMeta>("GET", "/meta", { signal, noRefresh: true }),
  };

  const users = {
    me: () => get<Me>("/users/me"),
    updateMe: (body: { displayName?: string; avatarUploadId?: string | null; coverUploadId?: string | null; messageRequestPolicy?: MessageRequestPolicy; emailDigest?: boolean }) => patch<Me>("/users/me", body),
    /** Permanently deletes the account (204). 409 OWNER_MUST_TRANSFER while it is the only owner of a company team. */
    deleteMe: (body: { password: string; totp?: string }) => http.request<void>("DELETE", "/users/me", { body }),
    /** Everything the account holds, as a JSON file (rate limited: 429 after 3 a day). */
    exportData: () => download("/users/me/export"),
    bookmarks: (q?: PageQuery) => get<Page<Post>>("/users/me/bookmarks", pq(q)),
    blocks: () => get<UserSummary[]>("/users/me/blocks"),
    sessions: () => get<SessionInfo[]>("/users/me/sessions"),
    revokeSession: (id: string) => del(`/users/me/sessions/${enc(id)}`),
    posts: (username: string, q?: PageQuery) => get<Page<Post>>(`/users/${enc(username)}/posts`, pq(q)),
    followers: (username: string, q?: PageQuery) => get<Page<FollowEntry>>(`/users/${enc(username)}/followers`, pq(q)),
    following: (username: string, q?: PageQuery) => get<Page<FollowEntry>>(`/users/${enc(username)}/following`, pq(q)),
    follow: (id: string) => post(`/users/${enc(id)}/follow`),
    unfollow: (id: string) => del(`/users/${enc(id)}/follow`),
    block: (id: string) => post(`/users/${enc(id)}/block`),
    unblock: (id: string) => del(`/users/${enc(id)}/block`),
  };

  const profiles = {
    mine: () => get<MyProfile>("/profiles/me"),
    updateBasics: (body: BasicsInput) => patch<MyProfile>("/profiles/me", body),
    openToWork: (body: OpenToWorkInput) => put<MyProfile>("/profiles/me/open-to-work", body),
    contact: (body: { email: string | null; phone: string | null; whatsapp: string | null }) => put<MyProfile>("/profiles/me/contact", body),
    visibility: (body: Partial<Record<ProfileSection, SectionAudience>>) => put<MyProfile>("/profiles/me/visibility", body),
    cover: (uploadId: string | null) => put<MyProfile>("/profiles/me/cover", { uploadId }),
    section: <S extends ProfileSection>(section: S, items: SectionItems[S]) => put<MyProfile>(`/profiles/me/sections/${section}`, { items }),
    setStatus: (status: "PUBLISHED" | "UNLISTED" | "DRAFT") => post<MyProfile>("/profiles/me/status", { status }),
    usernameCheck: (u: string) => get<{ available: boolean; reason: "INVALID" | "RESERVED" | "TAKEN" | null; suggestions: string[] }>("/profiles/username-check", { u }),
    changeUsername: (username: string) => put<MyProfile>("/profiles/me/username", { username }),
    analytics: () => get<ProfileAnalytics>("/profiles/me/analytics"),
    contactLog: () => get<ContactAccessEntry[]>("/profiles/me/contact-log"),
    badgeVisibility: (badgeId: string, visible: boolean) => patch<MyProfile>(`/profiles/me/badges/${enc(badgeId)}`, { visible }),
    resume: (format: "pdf" | "docx") => download(`/profiles/me/resume.${format}`),
    startImport: (body: { text?: string | null; uploadId?: string | null }) => post<ProfileImport>("/profiles/me/imports", body),
    latestImport: () => get<ProfileImport | null>("/profiles/me/imports/latest"),
    import: (id: string) => get<ProfileImport>(`/profiles/me/imports/${enc(id)}`),
    applyImport: (id: string, body: { sections: ProfileSection[]; basics: boolean; badges: boolean }) => post<ProfileImport>(`/profiles/me/imports/${enc(id)}/apply`, body),
    polish: (field: "headline" | "about" | "experience" | "project", text: string) => post<{ text: string }>("/profiles/me/polish", { field, text }),
    endorse: (skillId: string) => put<{ endorsementCount: number; endorsedByViewer: boolean }>(`/profiles/skills/${enc(skillId)}/endorsement`),
    unendorse: (skillId: string) => del<{ endorsementCount: number; endorsedByViewer: boolean }>(`/profiles/skills/${enc(skillId)}/endorsement`),
    get: (username: string) => get<Profile>(`/profiles/${enc(username)}`),
    view: (username: string) => post(`/profiles/${enc(username)}/view`),
    ratings: (username: string) => get<Rating[]>(`/profiles/${enc(username)}/ratings`),
  };

  const network = {
    connect: (userId: string, note?: string | null) => post<{ state: "PENDING_OUTGOING" | "CONNECTED"; connectionId: string }>("/network/connections", { userId, note: note ?? null }),
    connections: (q?: PageQuery) => get<Page<NetworkEntry>>("/network/connections", pq(q)),
    remove: (userId: string) => del(`/network/connections/${enc(userId)}`),
    invitations: (direction: "received" | "sent" = "received", q?: PageQuery) => get<Page<NetworkEntry>>("/network/invitations", pq({ direction, ...q })),
    accept: (connectionId: string) => post(`/network/invitations/${enc(connectionId)}/accept`),
    ignore: (connectionId: string) => post(`/network/invitations/${enc(connectionId)}/ignore`),
    withdraw: (connectionId: string) => del(`/network/invitations/${enc(connectionId)}`),
    suggestions: () => get<NetworkEntry[]>("/network/suggestions"),
    mutual: (userId: string) => get<NetworkEntry[]>(`/network/mutual/${enc(userId)}`),
    of: (username: string, q?: PageQuery) => get<Page<NetworkEntry>>(`/network/of/${enc(username)}`, pq(q)),
  };

  const companies = {
    list: (q?: PageQuery & { q?: string; industry?: string }) => get<Page<CompanySummary>>("/companies", pq(q)),
    get: (slug: string) => get<Company>(`/companies/${enc(slug)}`),
    update: (slug: string, body: CompanyInput) => patch<Company>(`/companies/${enc(slug)}`, body),
    team: (slug: string) => get<TeamMember[]>(`/companies/${enc(slug)}/team`),
    setRole: (recruiterId: string, role: "OWNER" | "ADMIN" | "RECRUITER") => patch<TeamMember[]>(`/companies/team/${enc(recruiterId)}`, { role }),
    removeMember: (recruiterId: string) => del(`/companies/team/${enc(recruiterId)}`),
    follow: (slug: string) => put<Company>(`/companies/${enc(slug)}/follow`),
    unfollow: (slug: string) => del<Company>(`/companies/${enc(slug)}/follow`),
    people: (slug: string, q?: PageQuery) => get<Page<UserSummary>>(`/companies/${enc(slug)}/people`, pq(q)),
    jobs: (slug: string, q?: PageQuery & { status?: JobStatus }) => get<Page<Job>>(`/companies/${enc(slug)}/jobs`, pq(q)),
    posts: (slug: string, q?: PageQuery) => get<Page<Post>>(`/companies/${enc(slug)}/posts`, pq(q)),
  };

  const recruiter = {
    register: (body: RegisterRecruiterInput) => post<RecruiterAccount>("/recruiter/register", body),
    me: () => get<RecruiterAccount>("/recruiter/me"),
    updateMe: (body: { title?: string | null }) => patch<RecruiterAccount>("/recruiter/me", body),
    resendCode: () => post("/recruiter/me/code"),
    verify: (code: string) => post<RecruiterAccount>("/recruiter/me/verify", { code }),
    leave: () => del("/recruiter/me"),
    saved: (q?: PageQuery) => get<Page<TalentCard & { note: string | null; savedAt: string }>>("/recruiter/saved", pq(q)),
    save: (username: string, note?: string | null) => put(`/recruiter/saved/${enc(username)}`, { note: note ?? null }),
    unsave: (username: string) => del(`/recruiter/saved/${enc(username)}`),
    searches: () => get<SavedSearch[]>("/recruiter/searches"),
    saveSearch: (name: string, query: SavedSearch["query"]) => post<SavedSearch>("/recruiter/searches", { name, query }),
    deleteSearch: (id: string) => del(`/recruiter/searches/${enc(id)}`),
    notes: (candidateId: string) => get<CandidateNote[]>(`/recruiter/notes/${enc(candidateId)}`),
    addNote: (body: { candidateId?: string; applicationId?: string; body: string; rating?: number | null }) => post<CandidateNote>("/recruiter/notes", body),
  };

  const approaches = {
    send: (body: { username: string; roleTitle: string; message: string; jobId?: string | null; employmentType?: EmploymentType | null; salary?: SalaryInput | null }) => post<Approach>("/approaches", body),
    received: (q?: PageQuery & { status?: ApproachStatus }) => get<Page<Approach>>("/approaches/received", pq(q)),
    sent: (q?: PageQuery & { status?: ApproachStatus }) => get<Page<Approach>>("/approaches/sent", pq(q)),
    get: (id: string) => get<Approach>(`/approaches/${enc(id)}`),
    viewed: (id: string) => post(`/approaches/${enc(id)}/viewed`),
    accept: (id: string, channels: ContactChannel[]) => post<Approach>(`/approaches/${enc(id)}/accept`, { channels }),
    decline: (id: string, reason?: string | null) => post<Approach>(`/approaches/${enc(id)}/decline`, { reason: reason ?? null }),
    block: (id: string) => post(`/approaches/${enc(id)}/block`),
    revoke: (id: string) => post<Approach>(`/approaches/${enc(id)}/revoke`),
    withdraw: (id: string) => post<Approach>(`/approaches/${enc(id)}/withdraw`),
    contact: (id: string) => get<ContactReveal>(`/approaches/${enc(id)}/contact`),
  };

  const jobs = {
    search: (q?: JobQuery) => get<Page<Job>>("/jobs", pq(q ? { ...q, workplace: csv(q.workplace), employment: csv(q.employment), seniority: csv(q.seniority), skills: csv(q.skills) } : undefined)),
    recommended: () => get<Job[]>("/jobs/recommended"),
    saved: (q?: PageQuery) => get<Page<Job>>("/jobs/saved", pq(q)),
    invites: () => get<JobInvite[]>("/jobs/invites"),
    respondInvite: (id: string, response: "VIEWED" | "INTERESTED" | "DECLINED") => post<{ jobId: string }>(`/jobs/invites/${enc(id)}/respond`, { response }),
    create: (body: JobInput & { publish?: boolean }) => post<Job>("/jobs", body),
    get: (id: string) => get<Job>(`/jobs/${enc(id)}`),
    update: (id: string, body: Partial<JobInput>) => patch<Job>(`/jobs/${enc(id)}`, body),
    setStatus: (id: string, status: "OPEN" | "CLOSED" | "FILLED") => post<Job>(`/jobs/${enc(id)}/status`, { status }),
    save: (id: string) => put(`/jobs/${enc(id)}/save`),
    unsave: (id: string) => del(`/jobs/${enc(id)}/save`),
    invite: (id: string, username: string, message?: string | null) => post(`/jobs/${enc(id)}/invites`, { username, message: message ?? null }),
    apply: (id: string, body: { coverNote?: string | null; answers?: { questionId: string; answer: string }[]; resumeUploadId?: string | null }) => post<MyApplication>(`/jobs/${enc(id)}/apply`, body),
    pipeline: (id: string) => get<PipelineColumn[]>(`/jobs/${enc(id)}/pipeline`),
    stage: (id: string, stage: ApplicationStage, q?: PageQuery) => get<Page<Application>>(`/jobs/${enc(id)}/pipeline/${stage}`, pq(q)),
  };

  const applications = {
    mine: (q?: PageQuery & { open?: boolean }) => get<Page<MyApplication>>("/applications/mine", pq(q)),
    get: (id: string) => get<Application>(`/applications/${enc(id)}`),
    withdraw: (id: string) => post<MyApplication>(`/applications/${enc(id)}/withdraw`),
    move: (id: string, body: { to: ApplicationStage; reason?: string | null; note?: string | null }) => post<Application>(`/applications/${enc(id)}/move`, body),
    bulkMove: (ids: string[], body: { to: ApplicationStage; reason?: string | null; note?: string | null }) => post<Application[]>("/applications/bulk-move", { ids, ...body }),
    thread: (id: string) => post<{ threadId: string }>(`/applications/${enc(id)}/thread`),
  };

  const trust = {
    engagements: () => get<Engagement[]>("/trust/engagements"),
    propose: (body: { approachId?: string; applicationId?: string; title: string }) => post<Engagement>("/trust/engagements", body),
    confirm: (id: string) => post<Engagement>(`/trust/engagements/${enc(id)}/confirm`),
    cancel: (id: string) => post<Engagement>(`/trust/engagements/${enc(id)}/cancel`),
    complete: (id: string) => post<Engagement>(`/trust/engagements/${enc(id)}/complete`),
    dispute: (id: string) => post<Engagement>(`/trust/engagements/${enc(id)}/dispute`),
    rate: (id: string, body: { score: number; subScores?: Partial<SubScores>; comment?: string | null }) => post<{ id: string; revealed: boolean }>(`/trust/engagements/${enc(id)}/rating`, body),
    fileComplaint: (body: { againstUsername: string; category: ComplaintCategory; description: string; engagementId?: string | null; approachId?: string | null; applicationId?: string | null; evidenceUploadIds?: string[] }) =>
      post<{ id: string }>("/trust/complaints", body),
    complaints: () => get<Complaint[]>("/trust/complaints"),
  };

  const search = {
    people: (q?: DirectoryQuery, signal?: AbortSignal) =>
      get<Page<TalentCard>>("/search/people", pq(q ? { ...q, skills: csv(q.skills), employment: csv(q.employment), workplace: csv(q.workplace), openToWork: q.openToWork ? "true" : undefined } : undefined), signal),
    facets: () => get<DirectoryFacets>("/search/facets"),
    all: (q: string, signal?: AbortSignal) => get<SearchResults>("/search", { q }, signal),
  };

  const posts = {
    feed: (q?: PageQuery & { sort?: "latest" | "top" }) => get<Page<Post> & { suggestedIds: string[] }>("/posts/feed", pq(q)),
    create: (body: NewPostInput) => post<Post>("/posts", body),
    get: (id: string) => get<Post>(`/posts/${enc(id)}`),
    update: (id: string, body: { body?: string; visibility?: PostVisibility }) => patch<Post>(`/posts/${enc(id)}`, body),
    remove: (id: string) => del(`/posts/${enc(id)}`),
    react: (id: string, type: ReactionType) => put<ReactionSummary>(`/posts/${enc(id)}/reaction`, { type }),
    unreact: (id: string) => del<ReactionSummary>(`/posts/${enc(id)}/reaction`),
    reactions: (id: string, q?: PageQuery & { type?: ReactionType }) => get<Page<{ user: UserSummary; type: ReactionType }>>(`/posts/${enc(id)}/reactions`, pq(q)),
    bookmark: (id: string) => post(`/posts/${enc(id)}/bookmark`),
    unbookmark: (id: string) => del(`/posts/${enc(id)}/bookmark`),
    hide: (id: string) => post(`/posts/${enc(id)}/hide`),
    comments: (id: string, q?: PageQuery) => get<Page<Comment>>(`/posts/${enc(id)}/comments`, pq(q)),
    addComment: (id: string, body: { body: string; parentId?: string; mediaId?: string }) => post<Comment>(`/posts/${enc(id)}/comments`, body),
  };

  const comments = {
    replies: (id: string, q?: PageQuery) => get<Page<Comment>>(`/comments/${enc(id)}/replies`, pq(q)),
    update: (id: string, body: string) => patch<Comment>(`/comments/${enc(id)}`, { body }),
    remove: (id: string) => del(`/comments/${enc(id)}`),
    react: (id: string, type: ReactionType) => put<ReactionSummary>(`/comments/${enc(id)}/reaction`, { type }),
    unreact: (id: string) => del<ReactionSummary>(`/comments/${enc(id)}/reaction`),
  };

  const dms = {
    threads: (q?: PageQuery & { folder?: "inbox" | "requests" | "archived" }) => get<Page<Thread>>("/dms/threads", pq(q)),
    open: (userId: string) => post<Thread>("/dms/threads", { userId }),
    thread: (id: string) => get<Thread>(`/dms/threads/${enc(id)}`),
    updateThread: (id: string, body: { mutedUntil?: string | null; archived?: boolean }) => patch<Thread>(`/dms/threads/${enc(id)}`, body),
    messages: (id: string, q?: PageQuery) => get<Page<Message>>(`/dms/threads/${enc(id)}/messages`, pq(q)),
    send: (id: string, body: { body: string; replyToId?: string; mediaIds?: string[] }) => post<Message>(`/dms/threads/${enc(id)}/messages`, body),
    read: (id: string) => post(`/dms/threads/${enc(id)}/read`),
    accept: (id: string) => post<Thread>(`/dms/threads/${enc(id)}/accept`),
    decline: (id: string) => post(`/dms/threads/${enc(id)}/decline`),
    media: (id: string, q?: PageQuery) => get<Page<Media>>(`/dms/threads/${enc(id)}/media`, pq(q)),
    search: (id: string, q: string) => get<Message[]>(`/dms/threads/${enc(id)}/search`, { q }),
    edit: (id: string, body: string) => patch<Message>(`/dms/messages/${enc(id)}`, { body }),
    remove: (id: string) => del(`/dms/messages/${enc(id)}`),
    react: (id: string, emoji: string) => put<Message>(`/dms/messages/${enc(id)}/reactions/${enc(emoji)}`),
    unreact: (id: string, emoji: string) => del<Message>(`/dms/messages/${enc(id)}/reactions/${enc(emoji)}`),
    unread: () => get<{ inbox: number; requests: number }>("/dms/unread"),
    eligibility: (userId: string) => get<MessagingEligibility>(`/dms/eligibility/${enc(userId)}`),
    contacts: () => get<Contact[]>("/dms/contacts"),
  };

  const media = {
    upload: (opts: UploadOptions) => uploadMedia(http, opts),
    get: (id: string) => get<Media>(`/media/${enc(id)}`),
    discard: (uploadId: string) => del(`/media/uploads/${enc(uploadId)}`),
  };

  const notifications = {
    list: (q?: PageQuery & { unread?: boolean }) => get<Page<Notification>>("/notifications", pq(q)),
    counts: () => get<NotificationCounts>("/notifications/counts"),
    read: (id: string) => post(`/notifications/${enc(id)}/read`),
    readAll: () => post("/notifications/read-all"),
  };

  const reports = {
    create: (body: { targetType: ModerationTarget; targetId: string; reason: ReportReason; details?: string }) => post<{ id: string }>("/reports", body),
  };

  const moderation = {
    cases: (q?: PageQuery & { status?: "OPEN" | "RESOLVED"; source?: CaseSource; targetType?: ModerationTarget }) => get<Page<ModerationCase>>("/moderation/cases", pq(q)),
    case: (id: string) => get<ModerationCase>(`/moderation/cases/${enc(id)}`),
    act: (id: string, body: { action: ModerationActionType; reason?: string; suspendDays?: number }) => post<ModerationCase>(`/moderation/cases/${enc(id)}/actions`, body),
    assign: (id: string, userId: string | null) => post<ModerationCase>(`/moderation/cases/${enc(id)}/assign`, { userId }),
    history: (targetType: ModerationTarget, targetId: string) => get<ModerationActionRecord[]>("/moderation/history", { targetType, targetId }),
    mine: (q?: PageQuery) => get<Page<ModerationCase>>("/moderation/me", pq(q)),
    appeal: (caseId: string, statement: string) => post<Appeal>(`/moderation/cases/${enc(caseId)}/appeal`, { statement }),
    appeals: (q?: PageQuery & { status?: string }) => get<Page<Appeal>>("/moderation/appeals", pq(q)),
    decideAppeal: (id: string, status: "UPHELD" | "OVERTURNED", note?: string) => post<Appeal>(`/moderation/appeals/${enc(id)}/decide`, { status, note }),
    stats: () => get<ModerationStats>("/moderation/stats"),
  };

  const admin = {
    me: () => get<{ role: UserRole; areas: AdminPermissions }>("/admin/me"),
    settings: () => get<PlatformSettings>("/admin/settings"),
    updateSettings: (body: Partial<PlatformSettings>) => patch<PlatformSettings>("/admin/settings", body),
    stats: (q?: { from?: string; to?: string }) => get<AdminStats>("/admin/stats", pq(q)),
    statsCsv: (q?: { from?: string; to?: string }) => download(`/admin/stats.csv${q?.from || q?.to ? `?${new URLSearchParams(Object.entries(q).filter(([, v]) => !!v) as [string, string][]).toString()}` : ""}`),
    users: (q?: PageQuery & { q?: string; status?: UserStatus; role?: UserRole }) => get<Page<AdminUserRow>>("/admin/users", pq(q)),
    setRole: (id: string, role: UserRole) => patch<AdminUserRow>(`/admin/users/${enc(id)}`, { role }),
    warn: (id: string, reason: string) => post<AdminUserRow>(`/admin/users/${enc(id)}/warn`, { reason }),
    suspend: (id: string, days: number, reason: string) => post<AdminUserRow>(`/admin/users/${enc(id)}/suspend`, { days, reason }),
    unsuspend: (id: string) => post<AdminUserRow>(`/admin/users/${enc(id)}/unsuspend`),
    ban: (id: string, reason: string) => post<AdminUserRow>(`/admin/users/${enc(id)}/ban`, { reason }),
    unban: (id: string) => post<AdminUserRow>(`/admin/users/${enc(id)}/unban`),
    suspendProfile: (id: string, reason: string) => post<AdminUserRow>(`/admin/users/${enc(id)}/profile/suspend`, { reason }),
    restoreProfile: (id: string) => post<AdminUserRow>(`/admin/users/${enc(id)}/profile/restore`),
    grantBadge: (id: string, label: string, rationale?: string | null) => post<{ id: string }>(`/admin/users/${enc(id)}/badges`, { label, rationale: rationale ?? null }),
    revokeBadge: (badgeId: string) => del(`/admin/badges/${enc(badgeId)}`),
    erase: (id: string, reason: string) => post(`/admin/users/${enc(id)}/erase`, { reason }),
    recruiters: (q?: PageQuery & { status?: AdminRecruiterRow["status"]; q?: string }) => get<Page<AdminRecruiterRow>>("/admin/recruiters", pq(q)),
    reviewRecruiter: (id: string, decision: "APPROVE" | "REJECT", note?: string | null) => post(`/admin/recruiters/${enc(id)}/review`, { decision, note: note ?? null }),
    suspendRecruiter: (id: string, reason: string) => post(`/admin/recruiters/${enc(id)}/suspend`, { reason }),
    reinstateRecruiter: (id: string) => post(`/admin/recruiters/${enc(id)}/reinstate`),
    recruiterQuota: (id: string, quota: number | null) => put(`/admin/recruiters/${enc(id)}/quota`, { quota }),
    companies: (q?: PageQuery & { status?: AdminCompanyRow["status"]; q?: string }) => get<Page<AdminCompanyRow>>("/admin/companies", pq(q)),
    updateCompany: (id: string, body: { status?: "VERIFIED" | "UNVERIFIED" | "SUSPENDED"; reason?: string | null; domains?: string[]; autoApproveDomain?: boolean }) => patch<AdminCompanyRow>(`/admin/companies/${enc(id)}`, body),
    jobs: (q?: PageQuery & { status?: JobStatus; q?: string }) => get<Page<Job>>("/admin/jobs", pq(q)),
    closeJob: (id: string, reason: string) => post(`/admin/jobs/${enc(id)}/close`, { reason }),
    complaints: (q?: PageQuery & { status?: ComplaintStatus }) => get<Page<AdminComplaintRow>>("/admin/complaints", pq(q)),
    resolveComplaint: (id: string, body: { status: "UNDER_REVIEW" | "ACTION_TAKEN" | "DISMISSED"; note?: string | null; action?: { kind: "WARN" | "SUSPEND"; days?: number } }) => post(`/admin/complaints/${enc(id)}/resolve`, body),
    hideRating: (id: string, reason: string) => post(`/admin/ratings/${enc(id)}/hide`, { reason }),
    audit: (q?: PageQuery & { action?: string; actorId?: string; entityType?: string; entityId?: string }) => get<Page<AuditEntry>>("/admin/audit", pq(q)),
  };

  return { auth, meta, users, profiles, network, companies, recruiter, approaches, jobs, applications, trust, search, posts, comments, dms, media, notifications, reports, moderation, admin };
}

export type Endpoints = ReturnType<typeof createEndpoints>;
export type { AdminArea, RatingSummary };
