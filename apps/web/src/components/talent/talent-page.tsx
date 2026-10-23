"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { LayoutGrid, List, Search, SlidersHorizontal, UsersRound, X } from "lucide-react";
import { Button, Card, DialogTitle, EmptyState, IconButton, Input, Sheet, SheetContent, Skeleton } from "@open-talent/ui";
import { useAuth } from "@/lib/auth";
import { usePagedList } from "@/lib/hooks/queries";
import { useProductName } from "@/lib/meta";
import { qk } from "@/lib/query-keys";
import { ErrorState, LoadMore } from "@/components/common/states";
import { EMPLOYMENT_LABEL, WORKPLACE_LABEL } from "@/components/jobs/job-format";
import { TalentCardView } from "./talent-card";
import { ClearFiltersButton, TalentFilters } from "./talent-filters";
import { activeFilterCount, fetchPeoplePage, filterKey, filtersFromParams, paramsFromFilters, type TalentFilters as Filters, type TalentRow } from "./talent-query";

function Chip({ label, onRemove }: { label: string; onRemove: () => void }) {
  return (
    <span className="inline-flex h-7 items-center gap-1 rounded-full border border-border bg-card pl-3 pr-1 text-xs font-medium text-foreground">
      {label}
      <button type="button" aria-label={`Remove filter ${label}`} onClick={onRemove} className="rounded-full p-0.5 text-subtle-foreground hover:bg-muted hover:text-foreground">
        <X className="size-3.5" />
      </button>
    </span>
  );
}

function ActiveChips({ f, set }: { f: Filters; set: (n: Filters) => void }) {
  const chips: { key: string; label: string; next: Filters }[] = [];
  for (const s of f.skills ?? []) chips.push({ key: `s-${s}`, label: s, next: { ...f, skills: f.skills!.filter((x) => x !== s) } });
  if (f.location) chips.push({ key: "loc", label: f.location, next: { ...f, location: undefined } });
  if (f.openToWork) chips.push({ key: "otw", label: "Open to work", next: { ...f, openToWork: undefined } });
  for (const e of f.employment ?? []) chips.push({ key: `e-${e}`, label: EMPLOYMENT_LABEL[e], next: { ...f, employment: f.employment!.filter((x) => x !== e) } });
  for (const w of f.workplace ?? []) chips.push({ key: `w-${w}`, label: WORKPLACE_LABEL[w], next: { ...f, workplace: f.workplace!.filter((x) => x !== w) } });
  if (f.minYears != null || f.maxYears != null)
    chips.push({ key: "yrs", label: `${f.minYears ?? 0} to ${f.maxYears ?? "any"} years`, next: { ...f, minYears: undefined, maxYears: undefined } });
  if (!chips.length) return null;
  return (
    <div className="flex flex-wrap items-center gap-2" data-testid="talent-active-filters">
      {chips.map((c) => (
        <Chip key={c.key} label={c.label} onRemove={() => set(c.next)} />
      ))}
    </div>
  );
}

function ResultsSkeleton({ layout }: { layout: "grid" | "list" }) {
  if (layout === "list")
    return (
      <Card className="divide-y divide-border">
        {Array.from({ length: 5 }, (_, i) => (
          <div key={i} className="flex gap-3 p-4">
            <Skeleton className="size-12 rounded-full" />
            <div className="flex-1 space-y-2">
              <Skeleton className="h-3 w-1/3" />
              <Skeleton className="h-3 w-2/3" />
              <Skeleton className="h-5 w-1/2" />
            </div>
          </div>
        ))}
      </Card>
    );
  return (
    <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
      {Array.from({ length: 6 }, (_, i) => (
        <div key={i} className="space-y-3 rounded-lg border border-border bg-card p-4">
          <Skeleton className="size-12 rounded-full" />
          <Skeleton className="h-3 w-1/2" />
          <Skeleton className="h-3 w-4/5" />
          <Skeleton className="h-5 w-3/4" />
        </div>
      ))}
    </div>
  );
}

/** The public talent directory: filters live in the URL, results load in pages. */
export function TalentPage() {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const { status } = useAuth();
  const product = useProductName();
  const filters = useMemo(() => filtersFromParams(new URLSearchParams(params?.toString())), [params]);
  const layout: "grid" | "list" = params?.get("view") === "list" ? "list" : "grid";
  const [sheetOpen, setSheetOpen] = useState(false);
  const [q, setQ] = useState(filters.q ?? "");
  useEffect(() => setQ(filters.q ?? ""), [filters.q]);

  const push = (next: Filters, view = layout) => {
    const p = paramsFromFilters(next);
    if (view === "list") p.set("view", "list");
    const s = p.toString();
    router.replace(s ? `${pathname}?${s}` : (pathname ?? "/talent"), { scroll: false });
  };

  const list = usePagedList<TalentRow>({
    queryKey: qk.people(filterKey(filters)),
    fetchPage: (cursor) => fetchPeoplePage(filters, cursor),
    staleTime: 60_000,
  });
  const count = activeFilterCount(filters);

  return (
    <main id="main" className="mx-auto max-w-[1280px] px-4 py-4" data-testid="talent-page">
      <div className="mb-4">
        <h1 className="text-2xl font-bold tracking-tight">Find talent</h1>
        <p className="mt-1 text-sm text-muted-foreground">Published profiles on {product}. Search by name, role or skill, then narrow it down.</p>
      </div>

      <form
        role="search"
        className="mb-4 flex gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          push({ ...filters, q: q.trim() || undefined });
        }}
      >
        <div className="relative flex-1">
          <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-subtle-foreground" aria-hidden />
          <Input value={q} onChange={(e) => setQ(e.target.value.slice(0, 100))} placeholder="Name, title or skill" aria-label="Search people" className="h-11 pl-9" data-testid="talent-search" />
        </div>
        <Button type="submit" size="lg" data-testid="talent-search-submit">
          Search
        </Button>
        <Button type="button" variant="outline" size="lg" className="lg:hidden" onClick={() => setSheetOpen(true)} data-testid="talent-filters-open">
          <SlidersHorizontal /> <span className="max-sm:sr-only">Filters</span>
          {count ? <span className="rounded-full bg-primary px-1.5 text-2xs font-bold text-primary-foreground">{count}</span> : null}
        </Button>
      </form>

      <div className="grid grid-cols-[minmax(0,1fr)] gap-6 lg:grid-cols-[280px_minmax(0,1fr)]">
        <aside className="hidden lg:block" aria-label="Filters">
          <Card className="sticky top-[calc(var(--header-height)+1rem)] max-h-[calc(100dvh-var(--header-height)-2rem)] overflow-y-auto scrollbar-thin">
            <div className="flex items-center justify-between border-b border-border px-4 py-3">
              <h2 className="text-base font-semibold">Filters</h2>
              {count ? <ClearFiltersButton onClick={() => push({ q: filters.q, sort: filters.sort })} /> : null}
            </div>
            <TalentFilters filters={filters} onChange={push} />
          </Card>
        </aside>

        <section className="min-w-0 space-y-3" aria-label="Results">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <p className="text-sm text-muted-foreground" aria-live="polite">
              {list.isPending ? "Searching..." : list.items.length ? `Showing ${list.items.length}${list.hasNextPage ? "+" : ""} ${list.items.length === 1 ? "person" : "people"}` : ""}
            </p>
            <div className="flex items-center gap-1" role="group" aria-label="Layout">
              <IconButton label="Grid view" variant={layout === "grid" ? "muted" : "ghost"} aria-pressed={layout === "grid"} onClick={() => push(filters, "grid")} data-testid="talent-view-grid">
                <LayoutGrid />
              </IconButton>
              <IconButton label="List view" variant={layout === "list" ? "muted" : "ghost"} aria-pressed={layout === "list"} onClick={() => push(filters, "list")} data-testid="talent-view-list">
                <List />
              </IconButton>
            </div>
          </div>
          <ActiveChips f={filters} set={push} />

          {list.isPending ? (
            <ResultsSkeleton layout={layout} />
          ) : list.isError ? (
            <Card>
              <ErrorState error={list.error} onRetry={() => void list.refetch()} />
            </Card>
          ) : !list.items.length ? (
            <Card>
              <EmptyState
                icon={<UsersRound />}
                title="No one matches these filters"
                description={count ? "Every selected skill must match, so try removing one, widening the experience range or clearing the location." : "Try a different name, title or skill."}
                action={count ? <ClearFiltersButton onClick={() => push({ q: filters.q })} /> : undefined}
              />
            </Card>
          ) : layout === "list" ? (
            <Card className="divide-y divide-border">
              {list.items.map((c) => (
                <TalentCardView key={c.id} card={c} layout="list" />
              ))}
            </Card>
          ) : (
            <ul className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
              {list.items.map((c) => (
                <li key={c.id}>
                  <TalentCardView card={c} />
                </li>
              ))}
            </ul>
          )}
          <LoadMore sentinelRef={list.sentinelRef} loading={list.isFetchingNextPage} hasMore={!!list.hasNextPage} endLabel={list.items.length > 20 ? "You have reached the end of the results." : undefined} />

          {status === "signed-out" && list.items.length ? (
            <Card className="flex flex-col items-start gap-3 p-4 sm:flex-row sm:items-center sm:justify-between">
              <p className="text-sm text-muted-foreground">Sign in to connect with people and see more of their profiles.</p>
              <Button asChild size="sm">
                <Link href="/login?next=/talent">Sign in</Link>
              </Button>
            </Card>
          ) : null}
        </section>
      </div>

      <Sheet open={sheetOpen} onOpenChange={setSheetOpen}>
        <SheetContent side="right" width="max-w-sm" aria-describedby={undefined}>
          <div className="flex items-center justify-between border-b border-border px-4 py-3 pr-14">
            <DialogTitle className="text-base font-semibold">Filters</DialogTitle>
            {count ? <ClearFiltersButton onClick={() => push({ q: filters.q, sort: filters.sort })} /> : null}
          </div>
          <div className="flex-1 overflow-y-auto">
            <TalentFilters filters={filters} onChange={push} />
          </div>
          <div className="border-t border-border p-3">
            <Button block onClick={() => setSheetOpen(false)} data-testid="talent-filters-done">
              Show results
            </Button>
          </div>
        </SheetContent>
      </Sheet>
    </main>
  );
}
