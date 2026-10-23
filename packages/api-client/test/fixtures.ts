import type { AuthResult, Me } from "@open-talent/types";

export const me: Me = {
  id: "01J00000000000000000000001",
  username: "ada",
  displayName: "Ada L",
  avatarUrl: null,
  headline: null,
  role: "USER",
  openToWork: false,
  recruiterAt: null,
  email: "ada@example.org",
  status: "ACTIVE",
  emailVerified: true,
  totpEnabled: false,
  messageRequestPolicy: "RECRUITERS",
  emailDigest: false,
  suspendedUntil: null,
  profileStatus: "PUBLISHED",
  profileCompleteness: 80,
  recruiter: null,
  connectionCount: 0,
};

export const authResult = (token: string): AuthResult => ({ accessToken: token, expiresIn: 900, user: me });

export function json(status: number, body: unknown): Response {
  return new Response(body === undefined ? null : JSON.stringify(body), {
    status,
    headers: body === undefined ? {} : { "content-type": "application/json" },
  });
}
