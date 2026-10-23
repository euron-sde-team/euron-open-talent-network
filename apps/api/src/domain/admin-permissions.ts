/**
 * Which /admin areas each platform role can open. One table, used by the API (every
 * admin route calls requireArea) and sent to the web app so the sidebar shows only what
 * the operator may use.
 *
 *   ADMIN          everything, including settings, role changes and erasure
 *   MODERATOR      the case desk, complaints, people (suspend/restore) and jobs
 *   RECRUITER_OPS  the recruiter approval queue, companies and jobs
 */
import type { AdminArea, AdminPermissions, UserRole } from "@open-talent/types";

const AREAS: Record<Exclude<UserRole, "USER">, readonly AdminArea[]> = {
  ADMIN: ["overview", "recruiters", "companies", "moderation", "people", "jobs", "complaints", "settings", "audit"],
  MODERATOR: ["overview", "moderation", "people", "jobs", "complaints"],
  RECRUITER_OPS: ["overview", "recruiters", "companies", "jobs"],
};

export const ALL_AREAS: readonly AdminArea[] = AREAS.ADMIN;

export function canOpenArea(role: UserRole, area: AdminArea): boolean {
  return role !== "USER" && AREAS[role].includes(area);
}

export function permissionsFor(role: UserRole): AdminPermissions {
  return Object.fromEntries(ALL_AREAS.map((a) => [a, canOpenArea(role, a)])) as AdminPermissions;
}

/** Any staff role at all: may open /admin. */
export function isOperator(role: UserRole): boolean {
  return role !== "USER";
}
