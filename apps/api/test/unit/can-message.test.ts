import { describe, expect, test } from "vitest";
import { canMessage, MESSAGE_DENIAL_COPY, pairKey, toEligibility, type MessageFacts } from "../../src/domain/can-message";

const base: MessageFacts = {
  sender: { id: "A", status: "ACTIVE", role: "USER", isActiveRecruiter: false },
  recipient: { id: "B", status: "ACTIVE", requestPolicy: "RECRUITERS" },
  blocked: false,
  connected: false,
  acceptedApproach: false,
  applicationLink: false,
};

type Over = Partial<Omit<MessageFacts, "sender" | "recipient">> & { sender?: Partial<MessageFacts["sender"]>; recipient?: Partial<MessageFacts["recipient"]> };
const facts = (over: Over = {}): MessageFacts => ({ ...base, ...over, sender: { ...base.sender, ...over.sender }, recipient: { ...base.recipient, ...over.recipient } });

describe("canMessage: hard stops, in order", () => {
  test("1. you cannot message yourself, whatever else is true", () => {
    expect(canMessage(facts({ recipient: { id: "A" }, connected: true, sender: { role: "ADMIN" } }))).toEqual({ allowed: false, reason: "SELF" });
  });

  test("2. a restricted sender cannot message, even a connection", () => {
    for (const status of ["SUSPENDED", "BANNED", "DEACTIVATED", "PENDING_VERIFICATION"] as const) {
      expect(canMessage(facts({ sender: { status }, connected: true }))).toEqual({ allowed: false, reason: "SENDER_RESTRICTED" });
    }
    // Staff are not exempt from their own restriction.
    expect(canMessage(facts({ sender: { status: "SUSPENDED", role: "ADMIN" } }))).toEqual({ allowed: false, reason: "SENDER_RESTRICTED" });
  });

  test("3. a recipient who is not ACTIVE cannot be messaged", () => {
    for (const status of ["SUSPENDED", "BANNED", "DEACTIVATED", "PENDING_VERIFICATION"] as const) {
      expect(canMessage(facts({ recipient: { status }, connected: true }))).toEqual({ allowed: false, reason: "RECIPIENT_UNAVAILABLE" });
    }
    expect(canMessage(facts({ recipient: { status: "BANNED" }, sender: { role: "MODERATOR" } }))).toEqual({ allowed: false, reason: "RECIPIENT_UNAVAILABLE" });
  });

  test("4. a block in either direction stops everything, staff included", () => {
    expect(canMessage(facts({ blocked: true, connected: true, acceptedApproach: true, applicationLink: true }))).toEqual({ allowed: false, reason: "BLOCKED" });
    expect(canMessage(facts({ blocked: true, sender: { role: "ADMIN" } }))).toEqual({ allowed: false, reason: "BLOCKED" });
    expect(canMessage(facts({ blocked: true, recipient: { requestPolicy: "ANYONE" } }))).toEqual({ allowed: false, reason: "BLOCKED" });
  });

  test("restriction is checked before the recipient, the recipient before the block", () => {
    expect(canMessage(facts({ sender: { status: "SUSPENDED" }, recipient: { status: "BANNED" }, blocked: true }))).toMatchObject({ reason: "SENDER_RESTRICTED" });
    expect(canMessage(facts({ recipient: { status: "BANNED" }, blocked: true }))).toMatchObject({ reason: "RECIPIENT_UNAVAILABLE" });
  });
});

describe("canMessage: who may start a normal conversation", () => {
  test("5. staff (moderators and admins) may message anyone, even under NOBODY", () => {
    for (const role of ["ADMIN", "MODERATOR"] as const) {
      expect(canMessage(facts({ sender: { role }, recipient: { requestPolicy: "NOBODY" } }))).toEqual({ allowed: true, asRequest: false });
    }
  });

  test("RECRUITER_OPS is not staff for messaging", () => {
    expect(canMessage(facts({ sender: { role: "RECRUITER_OPS" }, recipient: { requestPolicy: "NOBODY" } }))).toEqual({ allowed: false, reason: "RECIPIENT_CLOSED_REQUESTS" });
  });

  test("6. connected, an accepted approach, or an application link opens a normal thread whatever the policy", () => {
    for (const reason of [{ connected: true }, { acceptedApproach: true }, { applicationLink: true }]) {
      for (const requestPolicy of ["ANYONE", "RECRUITERS", "NOBODY"] as const) {
        expect(canMessage(facts({ ...reason, recipient: { requestPolicy } }))).toEqual({ allowed: true, asRequest: false });
      }
    }
  });
});

describe("canMessage: message requests by recipient policy", () => {
  test("ANYONE: any active member may send a request", () => {
    expect(canMessage(facts({ recipient: { requestPolicy: "ANYONE" } }))).toEqual({ allowed: true, asRequest: true });
    expect(canMessage(facts({ recipient: { requestPolicy: "ANYONE" }, sender: { isActiveRecruiter: true } }))).toEqual({ allowed: true, asRequest: true });
  });

  test("RECRUITERS (the default): only active recruiters may send a request", () => {
    expect(canMessage(facts())).toEqual({ allowed: false, reason: "NOT_CONNECTED" });
    expect(canMessage(facts({ sender: { isActiveRecruiter: true } }))).toEqual({ allowed: true, asRequest: true });
  });

  test("NOBODY: no requests at all, recruiters included", () => {
    expect(canMessage(facts({ recipient: { requestPolicy: "NOBODY" } }))).toEqual({ allowed: false, reason: "RECIPIENT_CLOSED_REQUESTS" });
    expect(canMessage(facts({ recipient: { requestPolicy: "NOBODY" }, sender: { isActiveRecruiter: true } }))).toEqual({ allowed: false, reason: "RECIPIENT_CLOSED_REQUESTS" });
  });
});

describe("toEligibility", () => {
  test("a normal thread, a request, and a denial as the client sees them", () => {
    expect(toEligibility({ allowed: true, asRequest: false })).toEqual({ canMessage: true, canRequest: false, reason: null });
    expect(toEligibility({ allowed: true, asRequest: true })).toEqual({ canMessage: false, canRequest: true, reason: "NOT_CONNECTED" });
    expect(toEligibility({ allowed: false, reason: "BLOCKED" })).toEqual({ canMessage: false, canRequest: false, reason: "BLOCKED" });
  });

  test("every denial reason has composer copy, and a block is not named as one", () => {
    for (const reason of ["SELF", "BLOCKED", "NOT_CONNECTED", "RECIPIENT_UNAVAILABLE", "RECIPIENT_CLOSED_REQUESTS", "SENDER_RESTRICTED"] as const) {
      expect(MESSAGE_DENIAL_COPY[reason].length).toBeGreaterThan(10);
    }
    expect(MESSAGE_DENIAL_COPY.BLOCKED.toLowerCase()).not.toContain("block");
  });
});

describe("pairKey", () => {
  test("is the same for both directions and sorted", () => {
    expect(pairKey("b", "a")).toBe("a:b");
    expect(pairKey("a", "b")).toBe("a:b");
    expect(pairKey("01HZ", "01HA")).toBe(pairKey("01HA", "01HZ"));
  });
});
