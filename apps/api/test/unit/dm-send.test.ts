import { describe, expect, test } from "vitest";
import type { MessageDecision } from "../../src/domain/can-message";
import { DEFAULT_REQUEST_MESSAGE_CAP, directSendDecision } from "../../src/domain/dm-send";

const normal: MessageDecision = { allowed: true, asRequest: false };
const request: MessageDecision = { allowed: true, asRequest: true };
const deny = (reason: Extract<MessageDecision, { allowed: false }>["reason"]): MessageDecision => ({ allowed: false, reason });

describe("directSendDecision", () => {
  test("hard reasons are never waived, whatever the counterpart's state", () => {
    for (const reason of ["SELF", "SENDER_RESTRICTED", "RECIPIENT_UNAVAILABLE", "BLOCKED"] as const) {
      for (const counterpartState of ["ACTIVE", "REQUESTED", "DECLINED"] as const) {
        expect(directSendDecision({ eligibility: deny(reason), counterpartState, sentWhilePending: 0 })).toEqual({ allowed: false, code: "DM_NOT_ALLOWED", reason });
      }
    }
  });

  test("an accepted thread waives NOT_CONNECTED and RECIPIENT_CLOSED_REQUESTS (consent was given)", () => {
    expect(directSendDecision({ eligibility: deny("NOT_CONNECTED"), counterpartState: "ACTIVE", sentWhilePending: 0 })).toEqual({ allowed: true });
    expect(directSendDecision({ eligibility: deny("RECIPIENT_CLOSED_REQUESTS"), counterpartState: "ACTIVE", sentWhilePending: 99 })).toEqual({ allowed: true });
  });

  test("while still a request, a soft denial applies (the policy changed or the connection ended)", () => {
    expect(directSendDecision({ eligibility: deny("NOT_CONNECTED"), counterpartState: "REQUESTED", sentWhilePending: 0 })).toEqual({ allowed: false, code: "DM_NOT_ALLOWED", reason: "NOT_CONNECTED" });
    expect(directSendDecision({ eligibility: deny("RECIPIENT_CLOSED_REQUESTS"), counterpartState: "REQUESTED", sentWhilePending: 0 })).toEqual({ allowed: false, code: "DM_NOT_ALLOWED", reason: "RECIPIENT_CLOSED_REQUESTS" });
  });

  test("a declined request reads as closed requests, never as declined", () => {
    for (const eligibility of [normal, request, deny("NOT_CONNECTED")]) {
      expect(directSendDecision({ eligibility, counterpartState: "DECLINED", sentWhilePending: 0 })).toEqual({ allowed: false, code: "DM_NOT_ALLOWED", reason: "RECIPIENT_CLOSED_REQUESTS" });
    }
  });

  test("a pending request: up to the default cap, then DM_REQUEST_PENDING", () => {
    expect(DEFAULT_REQUEST_MESSAGE_CAP).toBe(3);
    for (let sent = 0; sent < DEFAULT_REQUEST_MESSAGE_CAP; sent++) expect(directSendDecision({ eligibility: request, counterpartState: "REQUESTED", sentWhilePending: sent })).toEqual({ allowed: true });
    expect(directSendDecision({ eligibility: request, counterpartState: "REQUESTED", sentWhilePending: DEFAULT_REQUEST_MESSAGE_CAP })).toEqual({ allowed: false, code: "DM_REQUEST_PENDING" });
    expect(directSendDecision({ eligibility: request, counterpartState: "REQUESTED", sentWhilePending: 50 })).toEqual({ allowed: false, code: "DM_REQUEST_PENDING" });
  });

  test("the cap comes from settings when given", () => {
    expect(directSendDecision({ eligibility: request, counterpartState: "REQUESTED", sentWhilePending: 4, requestCap: 5 })).toEqual({ allowed: true });
    expect(directSendDecision({ eligibility: request, counterpartState: "REQUESTED", sentWhilePending: 1, requestCap: 1 })).toEqual({ allowed: false, code: "DM_REQUEST_PENDING" });
  });

  test("a normal thread with an ACTIVE counterpart has no cap", () => {
    expect(directSendDecision({ eligibility: normal, counterpartState: "ACTIVE", sentWhilePending: 1000 })).toEqual({ allowed: true });
  });
});
