import { Bookmark, BriefcaseBusiness, Building2, FileText, Home, LayoutDashboard, MessageSquareText, Search, Users } from "lucide-react";

export const PRIMARY_NAV = [
  { href: "/", label: "Home", icon: Home, match: (p: string) => p === "/" },
  { href: "/network", label: "My Network", icon: Users, match: (p: string) => p.startsWith("/network") },
  { href: "/jobs", label: "Jobs", icon: BriefcaseBusiness, match: (p: string) => p.startsWith("/jobs") },
  { href: "/messaging", label: "Messaging", icon: MessageSquareText, match: (p: string) => p.startsWith("/messaging") },
] as const;

export const SECONDARY_NAV = [
  { href: "/dashboard", label: "Your dashboard", icon: LayoutDashboard },
  { href: "/jobs/applications", label: "My applications", icon: FileText },
  { href: "/talent", label: "Find talent", icon: Search },
  { href: "/companies", label: "Companies", icon: Building2 },
  { href: "/saved", label: "Saved posts", icon: Bookmark },
] as const;
