import type { ApproachStatus, ComplaintCategory, ComplaintStatus, ContactChannel, EngagementStatus, InviteStatus } from "@open-talent/types";

type Tone = "neutral" | "primary" | "success" | "warning" | "danger" | "outline";

export const APPROACH_STATUS: Record<ApproachStatus, { label: string; tone: Tone }> = {
  PENDING: { label: "Awaiting your reply", tone: "warning" },
  ACCEPTED: { label: "Accepted", tone: "success" },
  DECLINED: { label: "Declined", tone: "neutral" },
  WITHDRAWN: { label: "Withdrawn", tone: "neutral" },
  EXPIRED: { label: "Expired", tone: "outline" },
  BLOCKED: { label: "Blocked", tone: "danger" },
};

export const INVITE_STATUS: Record<InviteStatus, { label: string; tone: Tone }> = {
  SENT: { label: "New", tone: "primary" },
  VIEWED: { label: "Viewed", tone: "neutral" },
  INTERESTED: { label: "Interested", tone: "success" },
  DECLINED: { label: "Declined", tone: "neutral" },
};

export const ENGAGEMENT_STATUS: Record<EngagementStatus, { label: string; tone: Tone }> = {
  PROPOSED: { label: "Proposed", tone: "warning" },
  ACTIVE: { label: "Active", tone: "primary" },
  COMPLETED: { label: "Completed", tone: "success" },
  CANCELLED: { label: "Cancelled", tone: "neutral" },
  DISPUTED: { label: "Disputed", tone: "danger" },
};

export const COMPLAINT_STATUS: Record<ComplaintStatus, { label: string; tone: Tone }> = {
  OPEN: { label: "Open", tone: "warning" },
  UNDER_REVIEW: { label: "Under review", tone: "primary" },
  ACTION_TAKEN: { label: "Action taken", tone: "success" },
  DISMISSED: { label: "Dismissed", tone: "neutral" },
};

export const COMPLAINT_CATEGORY: Record<ComplaintCategory, string> = {
  HARASSMENT: "Harassment",
  NON_PAYMENT: "Non-payment",
  NO_SHOW: "No-show",
  MISREPRESENTATION: "Misrepresentation",
  SPAM: "Spam",
  SCAM: "Scam or fraud",
  DISCRIMINATION: "Discrimination",
  OTHER: "Something else",
};

export const CHANNEL_LABEL: Record<ContactChannel, string> = { EMAIL: "Email", PHONE: "Phone", WHATSAPP: "WhatsApp" };
