/** Every React Query key in one place, so cache surgery (optimistic updates, socket merges) finds them. */
type F = Record<string, unknown>;

export const qk = {
  me: ["me"] as const,
  meta: ["meta"] as const,
  counts: ["counts"] as const,

  // Feed and posts
  feed: (sort: string) => ["feed", sort] as const,
  feedAll: ["feed"] as const,
  post: (id: string) => ["post", id] as const,
  comments: (postId: string) => ["comments", postId] as const,
  replies: (commentId: string) => ["replies", commentId] as const,
  reactions: (postId: string, type?: string) => ["reactions", postId, type ?? "ALL"] as const,
  bookmarks: ["bookmarks"] as const,
  userPosts: (username: string) => ["user-posts", username] as const,
  companyPosts: (slug: string) => ["company-posts", slug] as const,

  // Profiles
  profile: (username: string) => ["profile", username] as const,
  myProfile: ["my-profile"] as const,
  profileAnalytics: ["profile-analytics"] as const,
  contactLog: ["contact-log"] as const,
  profileRatings: (username: string) => ["profile-ratings", username] as const,
  importLatest: ["import-latest"] as const,
  import: (id: string) => ["import", id] as const,
  usernameCheck: (u: string) => ["username-check", u] as const,

  // Network
  connections: ["connections"] as const,
  connectionsOf: (username: string) => ["connections-of", username] as const,
  invitations: (direction: string) => ["invitations", direction] as const,
  invitationsAll: ["invitations"] as const,
  suggestions: ["network-suggestions"] as const,
  mutual: (userId: string) => ["mutual", userId] as const,
  followers: (username: string) => ["followers", username] as const,
  following: (username: string) => ["following", username] as const,
  blocks: ["blocks"] as const,
  sessions: ["sessions"] as const,

  // Companies and recruiting
  companies: (f: F) => ["companies", f] as const,
  company: (slug: string) => ["company", slug] as const,
  companyAll: ["company"] as const,
  team: (slug: string) => ["team", slug] as const,
  companyPeople: (slug: string) => ["company-people", slug] as const,
  companyJobs: (slug: string, status?: string) => ["company-jobs", slug, status ?? "ALL"] as const,
  recruiterMe: ["recruiter-me"] as const,
  savedCandidates: ["saved-candidates"] as const,
  savedSearches: ["saved-searches"] as const,
  candidateNotes: (candidateId: string) => ["candidate-notes", candidateId] as const,

  // Approaches
  approachesReceived: (status: string) => ["approaches-received", status] as const,
  approachesSent: (status: string) => ["approaches-sent", status] as const,
  approachesAll: ["approaches-received"] as const,
  approachesSentAll: ["approaches-sent"] as const,
  approach: (id: string) => ["approach", id] as const,

  // Jobs and applications
  jobs: (f: F) => ["jobs", f] as const,
  jobsAll: ["jobs"] as const,
  job: (id: string) => ["job", id] as const,
  recommendedJobs: ["jobs-recommended"] as const,
  savedJobs: ["jobs-saved"] as const,
  jobInvites: ["job-invites"] as const,
  myApplications: (open: boolean) => ["my-applications", open ? "open" : "all"] as const,
  myApplicationsAll: ["my-applications"] as const,
  pipeline: (jobId: string) => ["pipeline", jobId] as const,
  application: (id: string) => ["application", id] as const,

  // Trust
  engagements: ["engagements"] as const,
  complaints: ["complaints"] as const,

  // Search
  people: (f: F) => ["people", f] as const,
  facets: ["facets"] as const,
  searchAll: (q: string) => ["search-all", q] as const,

  // Messaging and notifications
  threads: (folder: string) => ["threads", folder] as const,
  threadsAll: ["threads"] as const,
  thread: (id: string) => ["thread", id] as const,
  threadMessages: (id: string) => ["thread-messages", id] as const,
  dmUnread: ["dm-unread"] as const,
  contacts: ["contacts"] as const,
  eligibility: (userId: string) => ["dm-eligibility", userId] as const,
  notifications: (unread: boolean) => ["notifications", unread ? "unread" : "all"] as const,
  notificationsAll: ["notifications"] as const,

  // Moderation and admin
  modCases: (filters: Record<string, string | undefined>) => ["mod-cases", filters] as const,
  modCasesAll: ["mod-cases"] as const,
  modCase: (id: string) => ["mod-case", id] as const,
  modHistory: (type: string, id: string) => ["mod-history", type, id] as const,
  modAppeals: (status: string) => ["mod-appeals", status] as const,
  modStats: ["mod-stats"] as const,
  myCases: ["my-moderation-cases"] as const,
  adminMe: ["admin-me"] as const,
  adminSettings: ["admin-settings"] as const,
  adminStats: (from: string, to: string) => ["admin-stats", from, to] as const,
  adminUsers: (filters: F) => ["admin-users", filters] as const,
  adminUsersAll: ["admin-users"] as const,
  adminRecruiters: (filters: F) => ["admin-recruiters", filters] as const,
  adminRecruitersAll: ["admin-recruiters"] as const,
  adminCompanies: (filters: F) => ["admin-companies", filters] as const,
  adminCompaniesAll: ["admin-companies"] as const,
  adminJobs: (filters: F) => ["admin-jobs", filters] as const,
  adminJobsAll: ["admin-jobs"] as const,
  adminComplaints: (status: string) => ["admin-complaints", status] as const,
  adminComplaintsAll: ["admin-complaints"] as const,
  audit: (filters: F) => ["audit", filters] as const,
};
