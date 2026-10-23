import { Suspense } from "react";
import type { Metadata } from "next";
import type { Company } from "@open-talent/types";
import { CompanyPage } from "@/components/companies/company-page";
import { jsonLd, publicOrigin, serverGet } from "@/lib/server-api";

const load = (slug: string) => serverGet<Company>(`/companies/${encodeURIComponent(slug)}`, 300);

export async function generateMetadata({ params }: { params: Promise<{ slug: string }> }): Promise<Metadata> {
  const slug = decodeURIComponent((await params).slug);
  const c = await load(slug);
  if (!c) return { title: "Company", robots: { index: false } };
  const url = `${await publicOrigin()}/company/${encodeURIComponent(c.slug)}`;
  const description = c.tagline ?? ([c.industry, c.headquarters].filter(Boolean).join(", ") || `${c.name} on this network`);
  return {
    title: c.name,
    description,
    alternates: { canonical: url },
    openGraph: { type: "website", url, title: c.name, description },
    robots: c.status === "SUSPENDED" ? { index: false } : undefined,
  };
}

export default async function Page({ params }: { params: Promise<{ slug: string }> }) {
  const slug = decodeURIComponent((await params).slug);
  // JSON-LD is a data block, never executed, so it needs no CSP nonce.
  const [c, origin] = await Promise.all([load(slug), publicOrigin()]);
  const ld = c && c.status !== "SUSPENDED"
    ? {
        "@context": "https://schema.org",
        "@type": "Organization",
        name: c.name,
        description: c.about ?? c.tagline ?? undefined,
        url: c.website ?? `${origin}/company/${encodeURIComponent(c.slug)}`,
        logo: c.logoUrl ?? undefined,
        foundingDate: c.foundedYear ? String(c.foundedYear) : undefined,
        address: c.headquarters ? { "@type": "PostalAddress", addressLocality: c.headquarters } : undefined,
      }
    : null;
  return (
    <>
      {ld ? <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: jsonLd(ld) }} /> : null}
      <Suspense>
        <CompanyPage slug={slug} />
      </Suspense>
    </>
  );
}
