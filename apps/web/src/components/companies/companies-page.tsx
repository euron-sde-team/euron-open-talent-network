"use client";

import { useEffect, useRef, useState } from "react";
import { useSearchParams } from "next/navigation";
import { Building2, Search, SearchX } from "lucide-react";
import { Button, Card, EmptyState, Input, NativeSelect } from "@open-talent/ui";
import type { CompanySummary } from "@open-talent/types";
import { api } from "@/lib/api";
import { usePagedList } from "@/lib/hooks/queries";
import { useDebounced } from "@/lib/hooks/use-debounced";
import { qk } from "@/lib/query-keys";
import { ErrorState, LoadMore, PageTitle } from "@/components/common/states";
import { CompanyCard, CompanyCardSkeleton } from "./company-card";

function writeUrl(q: string, industry: string) {
  const sp = new URLSearchParams();
  if (q.trim()) sp.set("q", q.trim());
  if (industry) sp.set("industry", industry);
  const qs = sp.toString();
  window.history.replaceState(null, "", qs ? `/companies?${qs}` : "/companies");
}

/** /companies: the directory, most followed first. Search and industry live in the URL. */
export function CompaniesPage() {
  const sp = useSearchParams();
  const [q, setQ] = useState(sp.get("q") ?? "");
  const [industry, setIndustry] = useState(sp.get("industry") ?? "");
  const dq = useDebounced(q.trim(), 300);
  useEffect(() => writeUrl(dq, industry), [dq, industry]);

  const list = usePagedList<CompanySummary>({
    queryKey: qk.companies({ q: dq, industry }),
    fetchPage: (cursor) => api().companies.list({ cursor, limit: 24, q: dq || undefined, industry: industry || undefined }),
  });

  // There is no industry facet endpoint: offer the industries seen so far, keeping the chosen one.
  const seen = useRef(new Set<string>());
  for (const c of list.items) if (c.industry) seen.current.add(c.industry);
  if (industry) seen.current.add(industry);
  const industries = [...seen.current].sort((a, b) => a.localeCompare(b));

  const filtered = !!(dq || industry);

  return (
    <div data-testid="companies-page">
      <PageTitle title="Companies" description="Explore company pages, follow the ones you like, and see who is hiring." />
      <Card className="mb-4 flex flex-col gap-2 p-3 sm:flex-row">
        <div className="relative flex-1">
          <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-subtle-foreground" aria-hidden />
          <Input type="search" aria-label="Search companies" placeholder="Search companies" value={q} onChange={(e) => setQ(e.target.value)} className="pl-9" maxLength={100} data-testid="companies-search" />
        </div>
        <NativeSelect aria-label="Industry" value={industry} onChange={(e) => setIndustry(e.target.value)} className="sm:w-56" data-testid="companies-industry">
          <option value="">All industries</option>
          {industries.map((i) => (
            <option key={i} value={i}>
              {i}
            </option>
          ))}
        </NativeSelect>
      </Card>
      {list.isPending ? (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {Array.from({ length: 6 }, (_, i) => (
            <CompanyCardSkeleton key={i} />
          ))}
        </div>
      ) : list.isError ? (
        <Card>
          <ErrorState error={list.error} onRetry={() => void list.refetch()} />
        </Card>
      ) : !list.items.length ? (
        <Card>
          {filtered ? (
            <EmptyState
              icon={<SearchX />}
              title="No companies match"
              description="Check the spelling, or try a different industry."
              action={
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => {
                    setQ("");
                    setIndustry("");
                  }}
                >
                  Clear search
                </Button>
              }
            />
          ) : (
            <EmptyState icon={<Building2 />} title="No company pages yet" description="Company pages appear here once recruiters set them up." />
          )}
        </Card>
      ) : (
        <>
          <ul className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3" data-testid="companies-list">
            {list.items.map((c) => (
              <li key={c.id} className="flex">
                <div className="flex w-full flex-col [&>*]:flex-1">
                  <CompanyCard company={c} />
                </div>
              </li>
            ))}
          </ul>
          <LoadMore sentinelRef={list.sentinelRef} loading={list.isFetchingNextPage} hasMore={!!list.hasNextPage} onClick={() => void list.fetchNextPage()} />
        </>
      )}
    </div>
  );
}
