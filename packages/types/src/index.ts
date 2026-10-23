/**
 * The API contract shared by apps/api and apps/web: response shapes (DTOs) and the
 * Socket.IO event map. Timestamps are ISO-8601 strings. Ids are ULIDs.
 *
 * Changing a shape here is a breaking change for one side or the other; both apps
 * typecheck against this file, so the compiler finds every caller.
 */
import type { Application, ApplicationStage, Approach, Job } from "./talent";

// ─── Enums (mirrors db/migrations) ──────────────────────────────────────────

export const REACTIONS = ["LIKE", "CELEBRATE", "SUPPORT", "INSIGHTFUL", "LOVE", "FUNNY"] as const;
export type ReactionType = (typeof REACTIONS)[number];

export const USER_ROLES = ["USER", "MODERATOR", "RECRUITER_OPS", "ADMIN"] as const;
export type UserRole = (typeof USER_ROLES)[number];
export type UserStatus = "PENDING_VERIFICATION" | "ACTIVE" | "SUSPENDED" | "BANNED" | "DEACTIVATED";
/** Who may send a message request to someone they are not connected to. */
export type MessageRequestPolicy = "ANYONE" | "RECRUITERS" | "NOBODY";
export type ContentStatus = "PUBLISHED" | "PENDING_REVIEW" | "HIDDEN" | "REMOVED" | "DELETED";
export type ModerationState = "UNCHECKED" | "CLEAN" | "REVIEW" | "FLAGGED";
export type UploadPurpose = "POST" | "COMMENT" | "DM" | "AVATAR" | "COVER" | "COMPANY_LOGO" | "COMPANY_COVER" | "PROJECT_COVER" | "RESUME" | "IMPORT" | "EVIDENCE";
export type UploadKind = "IMAGE" | "VIDEO" | "AUDIO" | "PDF" | "DOCUMENT" | "OTHER";
export type UploadStatus = "PENDING" | "COMPLETE" | "READY" | "REJECTED" | "DELETED";
export type ModerationTarget = "POST" | "COMMENT" | "DM_MESSAGE" | "USER" | "PROFILE" | "COMPANY" | "JOB" | "APPROACH";
export type ReportReason = "SPAM" | "HARASSMENT" | "HATE" | "VIOLENCE" | "SEXUAL" | "SELF_HARM" | "MISINFORMATION" | "IMPERSONATION" | "SCAM" | "FAKE_PROFILE" | "OTHER";
export type ModerationActionType = "APPROVE" | "HIDE" | "REMOVE" | "RESTORE" | "WARN" | "SUSPEND" | "BAN" | "UNBAN" | "DISMISS";
export type CaseSource = "AI" | "REPORT" | "PREMODERATION";
export type AppealStatus = "PENDING" | "UPHELD" | "OVERTURNED";
export type PostKind = "POST" | "HIRING" | "OPEN_TO_WORK" | "JOB" | "MILESTONE";
export type PostVisibility = "PUBLIC" | "CONNECTIONS";
export type ThreadContext = "CONNECTION" | "APPROACH" | "APPLICATION" | "REQUEST" | "SUPPORT";
export type NotificationType =
  | "CONNECTION_REQUEST" | "CONNECTION_ACCEPTED" | "FOLLOW" | "COMPANY_FOLLOW"
  | "POST_COMMENT" | "COMMENT_REPLY" | "POST_REACTION" | "COMMENT_REACTION" | "MENTION" | "REPOST"
  | "ENDORSEMENT" | "DM_REQUEST"
  | "APPROACH_RECEIVED" | "APPROACH_ACCEPTED" | "APPROACH_DECLINED" | "CONTACT_REVOKED"
  | "JOB_INVITE" | "APPLICATION_RECEIVED" | "APPLICATION_STAGE"
  | "ENGAGEMENT_PROPOSED" | "ENGAGEMENT_UPDATED" | "RATING_RECEIVED"
  | "RECRUITER_APPROVED" | "RECRUITER_REJECTED" | "IMPORT_READY"
  | "COMPLAINT_UPDATED" | "MODERATION_ACTION" | "APPEAL_DECIDED";

// ─── Envelopes ──────────────────────────────────────────────────────────────

/** Keyset page: pass `nextCursor` back as `?cursor=` until it is null. */
export interface Page<T> {
  items: T[];
  nextCursor: string | null;
}

/** Every non-2xx response. `code` is stable; switch on it, not on `error`. */
export interface ApiError {
  error: string;
  code: string;
  details?: unknown;
  requestId?: string;
}

// ─── People ─────────────────────────────────────────────────────────────────

export interface Media {
  id: string;
  kind: UploadKind;
  mimeType: string;
  fileName: string;
  sizeBytes: number | null;
  width: number | null;
  height: number | null;
  durationSeconds: number | null;
  /** Short-lived signed URL; refetch the parent resource after it expires. */
  url: string;
  thumbUrl: string | null;
  status: UploadStatus;
}

/** The member card shown everywhere a person appears (feed, comments, search, threads). */
export interface UserSummary {
  id: string;
  username: string;
  displayName: string;
  avatarUrl: string | null;
  headline: string | null;
  role: UserRole;
  /** Shown as a green ring when the person shares it with the viewer. */
  openToWork: boolean;
  /** Set when the person is an ACTIVE recruiter: "Recruiter at <company>". */
  recruiterAt: { slug: string; name: string } | null;
}

/** Relationship between the viewer and another person. */
export type ConnectionState = "NONE" | "CONNECTED" | "PENDING_OUTGOING" | "PENDING_INCOMING" | "SELF";

export interface Me extends UserSummary {
  email: string;
  status: UserStatus;
  /** When a SUSPENDED account's suspension ends (ISO); null otherwise. */
  suspendedUntil: string | null;
  emailVerified: boolean;
  totpEnabled: boolean;
  messageRequestPolicy: MessageRequestPolicy;
  /** Whether "while you were away" digest emails are sent (PATCH /api/users/me { emailDigest }). */
  emailDigest: boolean;
  profileStatus: "DRAFT" | "PUBLISHED" | "UNLISTED" | "SUSPENDED";
  profileCompleteness: number;
  /** The viewer's recruiter record, any status; null when they never applied. */
  recruiter: {
    id: string;
    status: "EMAIL_PENDING" | "PENDING_REVIEW" | "ACTIVE" | "REJECTED" | "SUSPENDED" | "LEFT";
    role: "OWNER" | "ADMIN" | "RECRUITER";
    company: { id: string; slug: string; name: string; logoUrl: string | null; status: "UNVERIFIED" | "VERIFIED" | "SUSPENDED" };
  } | null;
  connectionCount: number;
}

/** GET /api/meta: public facts about this network, for page titles and the sign-up form. */
export interface NetworkMeta {
  networkName: string;
  registration: "OPEN" | "CLOSED";
  /** Which AI features are available (the import wizard hides itself when false). */
  ai: { import: boolean; polish: boolean };
}

export interface AuthResult {
  accessToken: string;
  /** Seconds until the access token expires; refresh through POST /api/auth/refresh. */
  expiresIn: number;
  user: Me;
}

/** A row of GET /api/users/:username/followers and /following. */
export type FollowEntry = UserSummary & {
  /** The viewer follows this person; always false when signed out or for yourself. */
  viewerFollows: boolean;
};

/** A row of the network lists (connections, followers, suggestions, requests). */
export interface NetworkEntry {
  user: UserSummary;
  connection: ConnectionState;
  /** The pending connection id when `connection` is PENDING_*; used to accept or withdraw. */
  connectionId: string | null;
  note: string | null;
  mutualCount: number;
  since: string;
}

// ─── Feed ───────────────────────────────────────────────────────────────────

export type ReactionCounts = Partial<Record<ReactionType, number>>;

export interface Post {
  id: string;
  kind: PostKind;
  visibility: PostVisibility;
  author: UserSummary;
  /** Present when posted as a company page. */
  company: { id: string; slug: string; name: string; logoUrl: string | null } | null;
  body: string;
  mentions: UserSummary[];
  media: Media[];
  /** A job card attached to the post (kind JOB or HIRING). */
  job: Pick<Job, "id" | "title" | "workplaceType" | "employmentType" | "location" | "status" | "company"> | null;
  sharedPost: Post | null;
  status: ContentStatus;
  reactionCount: number;
  reactionCounts: ReactionCounts;
  commentCount: number;
  repostCount: number;
  createdAt: string;
  editedAt: string | null;
  viewer: {
    reaction: ReactionType | null;
    bookmarked: boolean;
    canEdit: boolean;
    canDelete: boolean;
    canModerate: boolean;
  };
}

export interface Comment {
  id: string;
  postId: string;
  parentId: string | null;
  author: UserSummary;
  body: string;
  media: Media | null;
  mentions: UserSummary[];
  status: ContentStatus;
  replyCount: number;
  reactionCount: number;
  reactionCounts: ReactionCounts;
  createdAt: string;
  editedAt: string | null;
  viewer: { reaction: ReactionType | null; canEdit: boolean; canDelete: boolean };
}

// ─── Messaging ──────────────────────────────────────────────────────────────

/**
 * Why the viewer cannot message someone directly (domain/can-message.ts). When the
 * reason is NOT_CONNECTED and `canRequest` is true, the first message becomes a request.
 */
export type MessageDenialReason =
  | "SELF"
  | "BLOCKED"
  | "NOT_CONNECTED"
  | "RECIPIENT_UNAVAILABLE"
  | "RECIPIENT_CLOSED_REQUESTS"
  | "SENDER_RESTRICTED";

export interface MessagingEligibility {
  /** May open (or write in) a normal thread now. */
  canMessage: boolean;
  /** May send a message request that lands in the recipient's Requests tab. */
  canRequest: boolean;
  reason: MessageDenialReason | null;
}

export interface MessageReactionSummary {
  emoji: string;
  count: number;
  reactedByViewer: boolean;
}

export interface Message {
  id: string;
  threadId: string;
  sender: UserSummary;
  body: string;
  media: Media[];
  replyTo: { id: string; body: string; senderName: string } | null;
  reactions: MessageReactionSummary[];
  status: ContentStatus;
  createdAt: string;
  editedAt: string | null;
}

export interface ThreadParticipant {
  user: UserSummary;
  state: "ACTIVE" | "REQUESTED" | "DECLINED";
  lastReadAt: string | null;
}

export interface Thread {
  id: string;
  context: ThreadContext;
  /** For APPROACH and APPLICATION threads: what the conversation is about. */
  contextLabel: string | null;
  contextId: string | null;
  participants: ThreadParticipant[];
  counterpart: UserSummary;
  lastMessage: Message | null;
  lastMessageAt: string | null;
  unreadCount: number;
  /** The viewer's own state: REQUESTED means this thread is in their "Requests" tab. */
  viewerState: "ACTIVE" | "REQUESTED" | "DECLINED";
  /** False when a block exists or the counterpart can no longer be messaged. */
  canSend: boolean;
  mutedUntil: string | null;
  archived: boolean;
}

// ─── Notifications ──────────────────────────────────────────────────────────

export interface Notification {
  id: string;
  type: NotificationType;
  actor: UserSummary | null;
  entityType: string;
  entityId: string;
  snippet: string | null;
  /** Where the web app should navigate on click (a path, not a full URL). */
  href: string;
  readAt: string | null;
  createdAt: string;
}

export interface NotificationCounts {
  notifications: number;
  messages: number;
  messageRequests: number;
  connectionRequests: number;
}

// ─── Moderation ─────────────────────────────────────────────────────────────

export interface ModerationCase {
  id: string;
  targetType: ModerationTarget;
  targetId: string;
  author: UserSummary | null;
  source: CaseSource;
  status: "OPEN" | "RESOLVED";
  priority: number;
  aiProvider: string | null;
  aiScores: Record<string, number> | null;
  aiCategories: string[];
  reportCount: number;
  reasons: { reason: ReportReason; count: number }[];
  /** The content as it was when the case opened (text, media ids, author). */
  snapshot: { body?: string; title?: string; media?: Media[]; [key: string]: unknown };
  /** Current status of the target (it may have changed since the snapshot). */
  targetStatus: string | null;
  resolution: ModerationActionType | null;
  resolvedBy: UserSummary | null;
  /** The staff member holding the case; null when unassigned (and always in the author's view). */
  assignedTo: UserSummary | null;
  openedAt: string;
  resolvedAt: string | null;
  appeal: Appeal | null;
}

export interface Appeal {
  id: string;
  caseId: string;
  appellant: UserSummary;
  statement: string;
  status: AppealStatus;
  decisionNote: string | null;
  decidedAt: string | null;
  createdAt: string;
}

export interface ModerationActionRecord {
  id: string;
  caseId: string | null;
  actor: UserSummary | null;
  action: ModerationActionType;
  targetType: ModerationTarget;
  targetId: string;
  reason: string | null;
  createdAt: string;
}

/** Per-category thresholds, 0..1. A score at or above `hide` hides; at or above `review` queues. */
export interface ModerationSettings {
  enabled: boolean;
  provider: "rules" | "openai" | "stub";
  thresholds: Record<string, { review: number; hide: number }>;
  /** Hold the first N posts of new accounts for review before they are visible. */
  premoderateNewAccounts: { enabled: boolean; firstPosts: number; accountAgeDays: number };
  blockedTerms: string[];
}

// ─── Realtime (Socket.IO) ───────────────────────────────────────────────────
//
// Rooms (server-side only; clients never join rooms directly):
//   user:<id>     every socket of a user: notifications, counts, presence and every DM
//                 event (messages, edits, reads, typing) and the candidate side of
//                 approaches and applications, so all tabs get them
//   thread:<id>   marks an open DM thread (participation checked on subscribe); the
//                 server drops sockets from it when a block ends the conversation
//   job:<id>      a recruiter's open pipeline board: card moves by teammates arrive live
//                 (subscribe requires an ACTIVE recruiter of the job's company)
//   post:<id>     live counts for an open post
//
// Handshake errors: MISSING, INVALID, BANNED, DEACTIVATED, TOO_MANY_CONNECTIONS (over
// 20 live sockets per user). Subscribe and presence:query acks answer RATE_LIMITED past
// 30 requests per socket per 10 seconds.

export interface ServerToClientEvents {
  "notification:new": (n: Notification) => void;
  "counts:update": (p: NotificationCounts) => void;

  "dm:message": (p: { threadId: string; message: Message }) => void;
  "dm:message:updated": (p: { threadId: string; message: Message }) => void;
  "dm:message:deleted": (p: { threadId: string; messageId: string }) => void;
  "dm:read": (p: { threadId: string; userId: string; lastReadAt: string }) => void;
  "dm:typing": (p: { threadId: string; userId: string; typing: boolean }) => void;
  "dm:request": (p: { thread: Thread }) => void;
  "dm:thread:updated": (p: { thread: Thread }) => void;

  "connection:request": (p: { connectionId: string; from: UserSummary; note: string | null }) => void;
  "connection:accepted": (p: { connectionId: string; user: UserSummary }) => void;

  "approach:new": (p: { approach: Approach }) => void;
  "approach:updated": (p: { approach: Approach }) => void;

  /** To the candidate: their application moved (the team note is never included). */
  "application:stage": (p: { applicationId: string; jobId: string; stage: ApplicationStage; at: string }) => void;
  /** To a job's pipeline board: a card moved, arrived or changed. */
  "pipeline:card": (p: { jobId: string; application: Application; movedBy: UserSummary | null }) => void;

  "feed:new-posts": (p: { count: number; latestId: string }) => void;
  "post:updated": (p: { postId: string; reactionCount: number; reactionCounts: ReactionCounts; commentCount: number }) => void;
  "post:removed": (p: { postId: string }) => void;
  "post:comment": (p: { postId: string; comment: Comment }) => void;

  "import:status": (p: { importId: string; status: string }) => void;
  "presence:update": (p: { userId: string; online: boolean; lastSeenAt: string | null }) => void;
  "moderation:queue": (p: { openCases: number }) => void;
  "session:revoked": (p: { reason: "SUSPENDED" | "BANNED" | "SIGNED_OUT" }) => void;
}

/** Acknowledgement callback shape for client requests. */
export type Ack<T = undefined> = (res: { ok: true; data?: T } | { ok: false; code: string; error: string }) => void;

export interface ClientToServerEvents {
  "dm:typing": (p: { threadId: string; typing: boolean }) => void;
  "post:subscribe": (p: { postId: string }, ack: Ack) => void;
  "post:unsubscribe": (p: { postId: string }) => void;
  "thread:subscribe": (p: { threadId: string }, ack: Ack) => void;
  "thread:unsubscribe": (p: { threadId: string }) => void;
  "job:subscribe": (p: { jobId: string }, ack: Ack) => void;
  "job:unsubscribe": (p: { jobId: string }) => void;
  /** Online status of people the viewer is connected to or has a thread with; others are omitted. */
  "presence:query": (p: { userIds: string[] }, ack: Ack<Record<string, boolean>>) => void;
}

export * from "./talent";
export * from "./admin";
