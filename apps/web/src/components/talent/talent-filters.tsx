"use client";

import { useEffect, useId, useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Search, X } from "lucide-react";
import { Button, Checkbox, Input, Label, Select, Skeleton, Slider, Switch } from "@open-talent/ui";
import { EMPLOYMENT_TYPES, WORKPLACE_TYPES, type EmploymentType, type WorkplaceType } from "@open-talent/types";
import { api } from "@/lib/api";
import { useDebounced } from "@/lib/hooks/use-debounced";
import { qk } from "@/lib/query-keys";
import { EMPLOYMENT_LABEL, WORKPLACE_LABEL } from "@/components/jobs/job-format";
import { YEARS_MAX, type TalentFilters, type TalentSort } from "./talent-query";

const SKILLS_COLLAPSED = 8;

function Section({ title, children, action }: { title: string; children: React.ReactNode; action?: React.ReactNode }) {
  return (
    <fieldset className="space-y-2 border-t border-border px-4 py-4 first:border-t-0">
      <div className="flex items-center justify-between">
        <legend className="text-sm font-semibold text-foreground">{title}</legend>
        {action}
      </div>
      {children}
    </fieldset>
  );
}

function CheckRow({ id, label, checked, onChange, count }: { id: string; label: string; checked: boolean; onChange: (v: boolean) => void; count?: number }) {
  return (
    <div className="flex items-center gap-2.5">
      <Checkbox id={id} checked={checked} onCheckedChange={(v) => onChange(v === true)} />
      <Label htmlFor={id} className="flex flex-1 cursor-pointer items-center justify-between gap-2 font-normal">
        <span className="truncate">{label}</span>
        {count != null ? <span className="text-xs tabular-nums text-subtle-foreground">{count}</span> : null}
      </Label>
    </div>
  );
}

const toggle = <T,>(list: T[] | undefined, v: T, on: boolean): T[] => {
  const cur = list ?? [];
  return on ? (cur.includes(v) ? cur : [...cur, v]) : cur.filter((x) => x !== v);
};

/** The directory filter panel. Text inputs commit after a short pause so typing does not spam the URL. */
export function TalentFilters({ filters, onChange }: { filters: TalentFilters; onChange: (next: TalentFilters) => void }) {
  const uid = useId();
  const facets = useQuery({ queryKey: qk.facets, queryFn: () => api().search.facets(), staleTime: 10 * 60_000, meta: { silent: true } });
  const [skillFilter, setSkillFilter] = useState("");
  const [showAllSkills, setShowAllSkills] = useState(false);
  const [location, setLocation] = useState(filters.location ?? "");
  const [years, setYears] = useState<[number, number]>([filters.minYears ?? 0, filters.maxYears ?? YEARS_MAX]);
  const debouncedLocation = useDebounced(location.trim(), 400);

  // Follow outside changes (clear all, back button) without fighting the user's typing.
  useEffect(() => setLocation(filters.location ?? ""), [filters.location]);
  useEffect(() => setYears([filters.minYears ?? 0, filters.maxYears ?? YEARS_MAX]), [filters.minYears, filters.maxYears]);
  useEffect(() => {
    if ((debouncedLocation || undefined) !== filters.location) onChange({ ...filters, location: debouncedLocation || undefined });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [debouncedLocation]);

  const selected = useMemo(() => filters.skills ?? [], [filters.skills]);
  const skillOptions = useMemo(() => {
    const all = facets.data?.skills ?? [];
    const known = new Set(all.map((s) => s.name.toLowerCase()));
    // Keep selected skills visible even when they are not among the top facets.
    const extra = selected.filter((s) => !known.has(s.toLowerCase())).map((name) => ({ name, count: undefined as number | undefined }));
    const needle = skillFilter.trim().toLowerCase();
    const merged = [...extra, ...all.map((s) => ({ name: s.name, count: s.count as number | undefined }))];
    return needle ? merged.filter((s) => s.name.toLowerCase().includes(needle)) : merged;
  }, [facets.data, selected, skillFilter]);
  const visibleSkills = showAllSkills || skillFilter ? skillOptions : skillOptions.slice(0, SKILLS_COLLAPSED);
  const customSkill = skillFilter.trim();
  const canAddCustom = customSkill.length >= 2 && !skillOptions.some((s) => s.name.toLowerCase() === customSkill.toLowerCase());

  return (
    <div data-testid="talent-filters">
      <Section title="Sort by">
        <Select
          aria-label="Sort results"
          value={filters.sort ?? (filters.q ? "relevance" : "recent")}
          onValueChange={(v) => onChange({ ...filters, sort: v as TalentSort })}
          options={[
            { value: "relevance", label: "Best match" },
            { value: "recent", label: "Recently published" },
            { value: "experience", label: "Most experience" },
          ]}
          data-testid="talent-sort"
        />
      </Section>

      <Section title="Availability">
        <div className="flex items-center justify-between gap-3">
          <Label htmlFor={`${uid}-otw`} className="font-normal">
            Open to work only
          </Label>
          <Switch id={`${uid}-otw`} checked={!!filters.openToWork} onCheckedChange={(v) => onChange({ ...filters, openToWork: v || undefined })} data-testid="talent-open-to-work" />
        </div>
      </Section>

      <Section
        title="Skills"
        action={
          selected.length ? (
            <button type="button" className="text-xs font-medium text-link hover:underline" onClick={() => onChange({ ...filters, skills: [] })}>
              Clear
            </button>
          ) : undefined
        }
      >
        <p className="text-xs text-subtle-foreground">People must have every skill you pick.</p>
        <div className="relative">
          <Search className="pointer-events-none absolute left-2.5 top-1/2 size-3.5 -translate-y-1/2 text-subtle-foreground" aria-hidden />
          <Input
            value={skillFilter}
            onChange={(e) => setSkillFilter(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && canAddCustom) {
                e.preventDefault();
                onChange({ ...filters, skills: toggle(filters.skills, customSkill, true).slice(0, 10) });
                setSkillFilter("");
              }
            }}
            placeholder="Find a skill"
            aria-label="Find a skill"
            className="h-9 pl-8"
            data-testid="talent-skill-filter"
          />
        </div>
        {facets.isPending ? (
          <div className="space-y-2">
            {Array.from({ length: 5 }, (_, i) => (
              <Skeleton key={i} className="h-4" />
            ))}
          </div>
        ) : (
          <div className="max-h-72 space-y-2 overflow-y-auto pr-1">
            {visibleSkills.map((s) => (
              <CheckRow
                key={s.name}
                id={`${uid}-skill-${s.name}`}
                label={s.name}
                count={s.count}
                checked={selected.some((x) => x.toLowerCase() === s.name.toLowerCase())}
                onChange={(on) => onChange({ ...filters, skills: on ? toggle(filters.skills, s.name, true).slice(0, 10) : selected.filter((x) => x.toLowerCase() !== s.name.toLowerCase()) })}
              />
            ))}
            {canAddCustom ? (
              <button
                type="button"
                className="text-sm font-medium text-link hover:underline"
                onClick={() => {
                  onChange({ ...filters, skills: toggle(filters.skills, customSkill, true).slice(0, 10) });
                  setSkillFilter("");
                }}
              >
                Add &quot;{customSkill}&quot;
              </button>
            ) : !visibleSkills.length ? (
              <p className="text-xs text-subtle-foreground">No matching skills.</p>
            ) : null}
          </div>
        )}
        {!skillFilter && skillOptions.length > SKILLS_COLLAPSED ? (
          <button type="button" className="text-sm font-medium text-link hover:underline" onClick={() => setShowAllSkills((v) => !v)}>
            {showAllSkills ? "Show fewer" : `Show all ${skillOptions.length}`}
          </button>
        ) : null}
      </Section>

      <Section title="Location">
        <div className="relative">
          <Input
            value={location}
            onChange={(e) => setLocation(e.target.value)}
            placeholder="City or region"
            aria-label="Location"
            list={`${uid}-locations`}
            className="h-9 pr-8"
            data-testid="talent-location"
          />
          {location ? (
            <button type="button" aria-label="Clear location" onClick={() => setLocation("")} className="absolute right-2 top-1/2 -translate-y-1/2 rounded p-0.5 text-subtle-foreground hover:bg-muted">
              <X className="size-4" />
            </button>
          ) : null}
          <datalist id={`${uid}-locations`}>
            {(facets.data?.locations ?? []).map((l) => (
              <option key={l.name} value={l.name} />
            ))}
          </datalist>
        </div>
      </Section>

      <Section title="Years of experience">
        <Slider
          min={0}
          max={YEARS_MAX}
          step={1}
          value={years}
          onValueChange={(v) => setYears([v[0] ?? 0, v[1] ?? YEARS_MAX])}
          onValueCommit={(v) => {
            const lo = v[0] ?? 0;
            const hi = v[1] ?? YEARS_MAX;
            onChange({ ...filters, minYears: lo > 0 ? lo : undefined, maxYears: hi < YEARS_MAX ? hi : undefined });
          }}
          thumbLabels={["Minimum years", "Maximum years"]}
          data-testid="talent-years"
        />
        <p className="text-xs tabular-nums text-muted-foreground">
          {years[0]} to {years[1] >= YEARS_MAX ? `${YEARS_MAX}+` : years[1]} years
        </p>
      </Section>

      <Section title="Employment type">
        {EMPLOYMENT_TYPES.map((t) => (
          <CheckRow
            key={t}
            id={`${uid}-emp-${t}`}
            label={EMPLOYMENT_LABEL[t]}
            checked={!!filters.employment?.includes(t)}
            onChange={(on) => onChange({ ...filters, employment: toggle<EmploymentType>(filters.employment, t, on) })}
          />
        ))}
      </Section>

      <Section title="Workplace">
        {WORKPLACE_TYPES.map((t) => (
          <CheckRow
            key={t}
            id={`${uid}-wp-${t}`}
            label={WORKPLACE_LABEL[t]}
            checked={!!filters.workplace?.includes(t)}
            onChange={(on) => onChange({ ...filters, workplace: toggle<WorkplaceType>(filters.workplace, t, on) })}
          />
        ))}
      </Section>
    </div>
  );
}

export function ClearFiltersButton({ onClick }: { onClick: () => void }) {
  return (
    <Button variant="ghost" size="sm" onClick={onClick} data-testid="talent-clear-filters">
      Clear filters
    </Button>
  );
}
