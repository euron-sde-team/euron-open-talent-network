import type { Metadata } from "next";
import type { Profile } from "@open-talent/types";
import { FullWidth } from "@/components/shell/layouts";
import { ProfilePage } from "@/components/profile/profile-page";
import { jsonLd, publicOrigin, serverGet } from "@/lib/server-api";

const load = (username: string) => serverGet<Profile>(`/profiles/${encodeURIComponent(username)}`, 120);

function describe(p: Profile): string {
  const role = [p.currentTitle, p.currentCompany].filter(Boolean).join(" at ");
  return [p.headline ?? role, p.location].filter(Boolean).join(". ") || `${p.user.displayName}'s talent page`;
}

export async function generateMetadata({ params }: { params: Promise<{ username: string }> }): Promise<Metadata> {
  const username = decodeURIComponent((await params).username);
  const p = await load(username);
  if (!p) return { title: username, robots: { index: false } };
  const origin = await publicOrigin();
  const url = `${origin}/in/${encodeURIComponent(p.user.username)}`;
  return {
    title: p.user.displayName,
    description: describe(p),
    alternates: { canonical: url },
    openGraph: { type: "profile", url, title: p.user.displayName, description: describe(p), username: p.user.username },
    // Only published pages belong in search engines; unlisted ones are reachable by link only.
    robots: p.status === "PUBLISHED" ? undefined : { index: false },
  };
}

export default async function Page({ params }: { params: Promise<{ username: string }> }) {
  const username = decodeURIComponent((await params).username);
  // JSON-LD is a data block, never executed, so it needs no CSP nonce.
  const [p, origin] = await Promise.all([load(username), publicOrigin()]);
  const ld = p && p.status === "PUBLISHED"
    ? {
        "@context": "https://schema.org",
        "@type": "ProfilePage",
        mainEntity: {
          "@type": "Person",
          name: p.user.displayName,
          alternateName: p.user.username,
          description: p.headline ?? undefined,
          jobTitle: p.currentTitle ?? undefined,
          worksFor: p.currentCompany ? { "@type": "Organization", name: p.currentCompany } : undefined,
          address: p.location ? { "@type": "PostalAddress", addressLocality: p.location } : undefined,
          knowsAbout: p.skills.slice(0, 20).map((s) => s.name),
          url: `${origin}/in/${encodeURIComponent(p.user.username)}`,
          image: p.user.avatarUrl ?? undefined,
        },
      }
    : null;
  return (
    <FullWidth>
      {ld ? <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: jsonLd(ld) }} /> : null}
      <ProfilePage username={username} />
    </FullWidth>
  );
}
