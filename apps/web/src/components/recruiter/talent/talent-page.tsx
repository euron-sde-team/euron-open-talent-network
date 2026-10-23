"use client";

import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Bookmark, BookmarkPlus, Play, RotateCcw, Search, SlidersHorizontal, Trash2, UserRoundSearch } from "lucide-react";
import type { DirectoryQuery, SavedSearch } from "@open-talent/api-client";
import { EMPLOYMENT_TYPES, WORKPLACE_TYPES, type EmploymentType, type TalentCard, type WorkplaceType } from "@open-talent/types";
import {
  Button,
  Card,
  Checkbox,
  Dialog,
  DialogBody,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  EmptyState,
  Field,
  IconButton,
  Input,
  Select,
  Sheet,
  SheetContent,
  Skeleton,
  Switch,
  toast,
} from "@open-talent/ui";
import { api } from "@/lib/api";
import { errorMessage } from "@/lib/errors";
import { qk } from "@/lib/query-keys";
import { useDebounced } from "@/lib/hooks/use-debounced";
import { usePagedList } from "@/lib/hooks/queries";
import { ErrorState, LoadMore, PageTitle } from "@/components/common/states";
import { EMPLOYMENT_LABEL, WORKPLACE_LABEL } from "@/components/jobs/job-format";
import { TagInput } from "../tag-input";
import { TalentResultCard } from "./talent-card";

type Filters = Required<Pick<DirectoryQuery, "q" | "skills" | "location" | "openToWork" | "employment" | "workplace">> & { minYears: string; maxYears: string; sort: NonNullable<DirectoryQuery["sort"]> };

const EMPTY: Filters = { q: "", skills: [], location: "", openToWork: false, employment: [], workplace: [], minYears: "", maxYears: "", sort: "relevance" };

function toQuery(f: Filters): SavedSearch["query"] {
  const q: SavedSearch["query"] = {};
  if (f.q.trim()) q.q = f.q.trim();
  if (f.skills.length) q.skills = f.skills;
  if (f.location.trim()) q.location = f.location.trim();
  if (f.openToWork) q.openToWork = true;
  if (f.employment.length) q.employment = f.employment;
  if (f.workplace.length) q.workplace = f.workplace;
  if (f.minYears !== "") q.minYears = Number(f.minYears);
  if (f.maxYears !== "") q.maxYears = Number(f.maxYears);
  if (f.sort !== "relevance") q.sort = f.sort;
  return q;
}

function fromQuery(q: SavedSearch["query"]): Filters {
  return {
    q: q.q ?? "",
    skills: q.skills ?? [],
    location: q.location ?? "",
    openToWork: !!q.openToWork,
    employment: q.employment ?? [],
    workplace: q.workplace ?? [],
    minYears: q.minYears !== undefined ? String(q.minYears) : "",
    maxYears: q.maxYears !== undefined ? String(q.maxYears) : "",
    sort: q.sort ?? "relevance",
  };
}

function summary(q: SavedSearch["query"]): string {
  const parts = [q.q ? `"${q.q}"` : null, q.skills?.length ? q.skills.join(", ") : null, q.location ?? null, q.openToWork ? "open to work" : null, q.minYears !== undefined || q.maxYears !== undefined ? `${q.minYears ?? 0} to ${q.maxYears ?? "any"} yrs` : null].filter(Boolean);
  return parts.join(" · ") || "Everyone";
}

export function TalentSearchPage() {
  const [f, setF] = useState<Filters>(EMPTY);
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [saveOpen, setSaveOpen] = useState(false);
  const typed = useDebounced(JSON.stringify([f.q, f.location, f.minYears, f.maxYears]), 300);
  const query = useMemo(() => {
    const [q, location, minYears, maxYears] = JSON.parse(typed) as string[];
    const sane = (v: string) => (v !== "" && Number.isInteger(Number(v)) && Number(v) >= 0 && Number(v) <= 70 ? v : "");
    const min = sane(minYears!);
    let max = sane(maxYears!);
    if (min !== "" && max !== "" && Number(max) < Number(min)) max = "";
    return toQuery({ ...f, q: q!, location: location!, minYears: min, maxYears: max });
  }, [f, typed]);
  const list = usePagedList<TalentCard & { id: string }>({
    queryKey: qk.people({ ...query, scope: "recruiter" }),
    fetchPage: async (cursor) => {
      const page = await api().search.people({ ...query, cursor, limit: 20 });
      return { ...page, items: page.items.map((c) => ({ ...c, id: c.user.id })) };
    },
    staleTime: 30_000,
  });
  const active = Object.keys(toQuery(f)).length > 0;
  const yearsError = f.minYears !== "" && f.maxYears !== "" && Number(f.maxYears) < Number(f.minYears) ? "The maximum is below the minimum." : null;

  const panel = <FilterPanel f={f} setF={setF} yearsError={yearsError} />;

  return (
    <div data-testid="talent-search">
      <PageTitle
        title="Talent search"
        description="Published talent pages. Open-to-work signals shared with recruiters are visible to you."
        actions={
          <Button variant="outline" onClick={() => setSaveOpen(true)} disabled={!active} data-testid="talent-save-search">
            <BookmarkPlus /> Save search
          </Button>
        }
      />
      <div className="mb-4 flex gap-2">
        <div className="relative flex-1">
          <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-subtle-foreground" aria-hidden />
          <Input value={f.q} onChange={(e) => setF({ ...f, q: e.target.value })} maxLength={100} placeholder="Search by name, title, headline or keyword" className="h-11 pl-9" aria-label="Search talent" data-testid="talent-q" />
        </div>
        <Button variant="outline" className="h-11 lg:hidden" onClick={() => setFiltersOpen(true)} data-testid="talent-filters-open">
          <SlidersHorizontal /> Filters
        </Button>
      </div>

      <div className="grid grid-cols-[minmax(0,1fr)] gap-4 lg:grid-cols-[260px_minmax(0,1fr)]">
        <aside className="hidden space-y-4 lg:block">
          <Card className="p-4">{panel}</Card>
          <SavedSearches onRun={(q) => setF(fromQuery(q))} />
        </aside>
        <div className="min-w-0">
          <div className="mb-2 flex items-center justify-between gap-2">
            <p className="text-sm text-muted-foreground" aria-live="polite">
              {list.isPending ? "Searching..." : `${list.items.length}${list.hasNextPage ? "+" : ""} ${list.items.length === 1 ? "person" : "people"}`}
            </p>
            <div className="w-44">
              <Select
                aria-label="Sort"
                value={f.sort}
                onValueChange={(v) => setF({ ...f, sort: v as Filters["sort"] })}
                options={[
                  { value: "relevance", label: "Most relevant" },
                  { value: "recent", label: "Recently active" },
                  { value: "experience", label: "Most experience" },
                ]}
                data-testid="talent-sort"
              />
            </div>
          </div>
          {list.isPending ? (
            <div className="space-y-3">
              {Array.from({ length: 4 }, (_, i) => (
                <Card key={i} className="flex gap-3 p-4">
                  <Skeleton className="size-12 rounded-full" />
                  <div className="flex-1 space-y-2">
                    <Skeleton className="h-4 w-1/3" />
                    <Skeleton className="h-3 w-2/3" />
                    <Skeleton className="h-3 w-1/2" />
                  </div>
                </Card>
              ))}
            </div>
          ) : list.isError ? (
            <Card>
              <ErrorState error={list.error} onRetry={() => list.refetch()} />
            </Card>
          ) : !list.items.length ? (
            <Card>
              <EmptyState
                icon={<UserRoundSearch />}
                title="No one matches yet"
                description="Try fewer skills, a wider location, or turn off the open-to-work filter."
                action={
                  active ? (
                    <Button size="sm" variant="soft" onClick={() => setF(EMPTY)}>
                      Clear filters
                    </Button>
                  ) : undefined
                }
              />
            </Card>
          ) : (
            <div className="space-y-3">
              {list.items.map((c) => (
                <TalentResultCard key={c.id} card={c} />
              ))}
            </div>
          )}
          <LoadMore sentinelRef={list.sentinelRef} loading={list.isFetchingNextPage} hasMore={!!list.hasNextPage} onClick={() => list.fetchNextPage()} endLabel={list.items.length > 10 ? "That is everyone for this search." : undefined} />
          <div className="mt-4 lg:hidden">
            <SavedSearches onRun={(q) => setF(fromQuery(q))} />
          </div>
        </div>
      </div>

      <Sheet open={filtersOpen} onOpenChange={setFiltersOpen}>
        <SheetContent side="left" width="max-w-sm" aria-describedby={undefined}>
          <div className="border-b border-border px-5 py-4">
            <DialogTitle className="text-lg">Filters</DialogTitle>
          </div>
          <div className="min-h-0 flex-1 overflow-y-auto px-5 py-4">{panel}</div>
          <div className="border-t border-border px-5 py-3">
            <Button block onClick={() => setFiltersOpen(false)}>
              Show results
            </Button>
          </div>
        </SheetContent>
      </Sheet>

      {saveOpen ? <SaveSearchDialog open={saveOpen} onOpenChange={setSaveOpen} query={toQuery(f)} /> : null}
    </div>
  );
}

function FilterPanel({ f, setF, yearsError }: { f: Filters; setF: (f: Filters) => void; yearsError: string | null }) {
  const facets = useQuery({ queryKey: qk.facets, queryFn: () => api().search.facets(), staleTime: 300_000 });
  const topSkills = (facets.data?.skills ?? []).filter((s) => !f.skills.some((x) => x.toLowerCase() === s.name.toLowerCase())).slice(0, 10);
  const toggle = <T extends string>(arr: T[], v: T) => (arr.includes(v) ? arr.filter((x) => x !== v) : [...arr, v]);
  return (
    <div className="space-y-5" data-testid="talent-filters">
      <div className="flex items-center justify-between">
        <h2 className="text-base font-semibold">Filters</h2>
        <Button variant="link" size="sm" onClick={() => setF({ ...EMPTY, q: f.q })} data-testid="talent-reset">
          <RotateCcw className="size-3.5" /> Reset
        </Button>
      </div>
      <Field label="Skills" htmlFor="tf-skills" hint="People who list all of these.">
        <TagInput id="tf-skills" value={f.skills} onChange={(skills) => setF({ ...f, skills })} max={10} placeholder="Add a skill" suggestions={(facets.data?.skills ?? []).map((s) => s.name)} testId="talent-skills" />
      </Field>
      {topSkills.length && f.skills.length < 10 ? (
        <div className="-mt-3 flex flex-wrap gap-1">
          {topSkills.map((s) => (
            <button key={s.name} type="button" onClick={() => setF({ ...f, skills: [...f.skills, s.name] })} className="rounded-full border border-border px-2 py-0.5 text-2xs font-semibold text-muted-foreground transition-colors hover:bg-muted hover:text-foreground">
              + {s.name} <span className="text-subtle-foreground">{s.count}</span>
            </button>
          ))}
        </div>
      ) : null}
      <Field label="Location" htmlFor="tf-location">
        <Input id="tf-location" value={f.location} maxLength={120} list="tf-locations" placeholder="City or region" onChange={(e) => setF({ ...f, location: e.target.value })} data-testid="talent-location" />
        <datalist id="tf-locations">
          {(facets.data?.locations ?? []).slice(0, 30).map((l) => (
            <option key={l.name} value={l.name}>
              {`${l.count}`}
            </option>
          ))}
        </datalist>
      </Field>
      <label className="flex items-center justify-between gap-3 text-sm font-medium">
        Open to work only
        <Switch checked={f.openToWork} onCheckedChange={(c) => setF({ ...f, openToWork: c })} data-testid="talent-otw" />
      </label>
      <fieldset>
        <legend className="mb-2 text-sm font-medium">Employment</legend>
        <div className="space-y-2">
          {EMPLOYMENT_TYPES.map((t) => (
            <label key={t} className="flex items-center gap-2 text-sm">
              <Checkbox checked={f.employment.includes(t)} onCheckedChange={() => setF({ ...f, employment: toggle<EmploymentType>(f.employment, t) })} />
              {EMPLOYMENT_LABEL[t]}
            </label>
          ))}
        </div>
      </fieldset>
      <fieldset>
        <legend className="mb-2 text-sm font-medium">Workplace</legend>
        <div className="space-y-2">
          {WORKPLACE_TYPES.map((t) => (
            <label key={t} className="flex items-center gap-2 text-sm">
              <Checkbox checked={f.workplace.includes(t)} onCheckedChange={() => setF({ ...f, workplace: toggle<WorkplaceType>(f.workplace, t) })} />
              {WORKPLACE_LABEL[t]}
            </label>
          ))}
        </div>
      </fieldset>
      <fieldset>
        <legend className="mb-2 text-sm font-medium">Years of experience</legend>
        <div className="flex items-center gap-2">
          <Input type="number" min={0} max={70} value={f.minYears} onChange={(e) => setF({ ...f, minYears: e.target.value })} placeholder="Min" aria-label="Minimum years" aria-invalid={!!yearsError} data-testid="talent-min-years" />
          <span className="text-sm text-subtle-foreground">to</span>
          <Input type="number" min={0} max={70} value={f.maxYears} onChange={(e) => setF({ ...f, maxYears: e.target.value })} placeholder="Max" aria-label="Maximum years" aria-invalid={!!yearsError} data-testid="talent-max-years" />
        </div>
        {yearsError ? (
          <p role="alert" className="mt-1 text-xs font-medium text-danger">
            {yearsError}
          </p>
        ) : null}
      </fieldset>
    </div>
  );
}

function SavedSearches({ onRun }: { onRun: (q: SavedSearch["query"]) => void }) {
  const qc = useQueryClient();
  const list = useQuery({ queryKey: qk.savedSearches, queryFn: () => api().recruiter.searches() });
  const remove = useMutation({
    mutationFn: (id: string) => api().recruiter.deleteSearch(id),
    onMutate: (id) => {
      const prev = qc.getQueryData<SavedSearch[]>(qk.savedSearches);
      qc.setQueryData<SavedSearch[]>(qk.savedSearches, (old) => old?.filter((s) => s.id !== id));
      return { prev };
    },
    onError: (_e, _id, ctx) => qc.setQueryData(qk.savedSearches, ctx?.prev),
    onSuccess: () => toast.success({ title: "Saved search deleted" }),
  });
  return (
    <Card className="p-4" data-testid="saved-searches">
      <h2 className="flex items-center gap-2 text-base font-semibold">
        <Bookmark className="size-4 text-muted-foreground" aria-hidden /> Saved searches
      </h2>
      {list.isPending ? (
        <div className="mt-3 space-y-2">
          <Skeleton className="h-8 w-full" />
          <Skeleton className="h-8 w-full" />
        </div>
      ) : list.isError ? (
        <ErrorState compact error={list.error} onRetry={() => list.refetch()} />
      ) : !list.data.length ? (
        <p className="mt-2 text-sm text-muted-foreground">Set filters and save the search to run it again in one click.</p>
      ) : (
        <ul className="mt-2 space-y-1">
          {list.data.map((s) => (
            <li key={s.id} className="group -mx-2 flex items-center gap-1 rounded-md px-2 py-1.5 hover:bg-muted">
              <button type="button" onClick={() => onRun(s.query)} className="min-w-0 flex-1 text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring" data-testid="saved-search-run">
                <span className="block truncate text-sm font-semibold">{s.name}</span>
                <span className="block truncate text-xs text-subtle-foreground">{summary(s.query)}</span>
              </button>
              <IconButton label={`Run ${s.name}`} size="sm" onClick={() => onRun(s.query)}>
                <Play />
              </IconButton>
              <IconButton label={`Delete ${s.name}`} size="sm" onClick={() => remove.mutate(s.id)} data-testid="saved-search-delete">
                <Trash2 />
              </IconButton>
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}

function SaveSearchDialog({ open, onOpenChange, query }: { open: boolean; onOpenChange: (o: boolean) => void; query: SavedSearch["query"] }) {
  const qc = useQueryClient();
  const [name, setName] = useState(query.q ?? query.skills?.slice(0, 3).join(", ") ?? "");
  const save = useMutation({
    mutationFn: () => api().recruiter.saveSearch(name.trim(), query),
    meta: { silent: true },
    onSuccess: (s) => {
      qc.setQueryData<SavedSearch[]>(qk.savedSearches, (old) => [s, ...(old ?? [])]);
      toast.success({ title: "Search saved" });
      onOpenChange(false);
    },
  });
  return (
    <Dialog open={open} onOpenChange={(o) => !save.isPending && onOpenChange(o)}>
      <DialogContent size="sm" data-testid="save-search-dialog">
        <form
          className="flex min-h-0 flex-col"
          onSubmit={(e) => {
            e.preventDefault();
            if (name.trim()) save.mutate();
          }}
        >
          <DialogHeader>
            <DialogTitle>Save this search</DialogTitle>
            <DialogDescription>{summary(query)}</DialogDescription>
          </DialogHeader>
          <DialogBody className="space-y-2">
            <Field label="Name" htmlFor="ss-name">
              <Input id="ss-name" autoFocus value={name} maxLength={80} onChange={(e) => setName(e.target.value)} placeholder="Senior designers, remote" data-testid="save-search-name" />
            </Field>
            {save.error ? (
              <p role="alert" className="text-sm font-medium text-danger">
                {errorMessage(save.error)}
              </p>
            ) : null}
          </DialogBody>
          <DialogFooter>
            <Button variant="ghost" onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
            <Button type="submit" disabled={!name.trim()} loading={save.isPending} data-testid="save-search-submit">
              Save
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
