"use client";

import { useEffect, useState } from "react";
import { ChevronDown, MapPin, Search, X } from "lucide-react";
import { Button, Checkbox, Input, Label, Popover, PopoverClose, PopoverContent, PopoverTrigger, Segmented, cn } from "@open-talent/ui";
import { EMPLOYMENT_TYPES, SENIORITIES, WORKPLACE_TYPES } from "@open-talent/types";
import { EMPLOYMENT_LABEL, SENIORITY_LABEL, WORKPLACE_LABEL } from "./job-format";
import { EMPTY_FILTERS, hasAnyFilter, POSTED_OPTIONS, type JobFilters } from "./job-query";

function FilterButton({ label, active, count, children, testId, width = "w-72" }: { label: string; active: boolean; count?: number; children: React.ReactNode; testId: string; width?: string }) {
  return (
    <Popover>
      <PopoverTrigger asChild>
        <button
          type="button"
          data-testid={testId}
          aria-label={count ? `${label}, ${count} selected` : label}
          className={cn(
            "inline-flex h-8 shrink-0 items-center gap-1 rounded-full border px-3 text-sm font-semibold transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
            active ? "border-primary bg-primary text-primary-foreground hover:bg-primary/90" : "border-input bg-card text-foreground hover:bg-muted",
          )}
        >
          {label}
          {count ? <span className="tabular-nums">({count})</span> : null}
          <ChevronDown className="size-4" aria-hidden />
        </button>
      </PopoverTrigger>
      <PopoverContent align="start" className={cn(width, "p-0")}>
        {children}
      </PopoverContent>
    </Popover>
  );
}

function PopoverFooter({ onReset, disabled }: { onReset: () => void; disabled: boolean }) {
  return (
    <div className="flex items-center justify-between border-t border-border px-3 py-2">
      <Button variant="ghost" size="sm" onClick={onReset} disabled={disabled}>
        Reset
      </Button>
      <PopoverClose asChild>
        <Button size="sm">Done</Button>
      </PopoverClose>
    </div>
  );
}

function MultiFilter<T extends string>({
  label,
  options,
  labels,
  value,
  onChange,
  testId,
}: {
  label: string;
  options: readonly T[];
  labels: Record<T, string>;
  value: T[];
  onChange: (v: T[]) => void;
  testId: string;
}) {
  return (
    <FilterButton label={label} active={value.length > 0} count={value.length} testId={testId}>
      <fieldset className="max-h-72 overflow-y-auto p-2">
        <legend className="sr-only">{label}</legend>
        {options.map((o) => {
          const id = `${testId}-${o.toLowerCase()}`;
          return (
            <label key={o} htmlFor={id} className="flex cursor-pointer items-center gap-3 rounded-md px-2 py-2 text-sm hover:bg-muted">
              <Checkbox id={id} checked={value.includes(o)} onCheckedChange={(c) => onChange(c ? [...value, o] : value.filter((v) => v !== o))} />
              {labels[o]}
            </label>
          );
        })}
      </fieldset>
      <PopoverFooter onReset={() => onChange([])} disabled={!value.length} />
    </FilterButton>
  );
}

const SALARY_PRESETS = [40_000, 60_000, 80_000, 100_000, 150_000, 200_000];

function SalaryFilter({ value, onChange }: { value: number | null; onChange: (v: number | null) => void }) {
  const [draft, setDraft] = useState(value ? String(value) : "");
  useEffect(() => setDraft(value ? String(value) : ""), [value]);
  const commit = () => {
    const n = Number(draft.replace(/[^\d]/g, ""));
    onChange(Number.isFinite(n) && n > 0 ? n : null);
  };
  return (
    <FilterButton label={value ? `Pay ${value.toLocaleString()}+` : "Salary"} active={!!value} testId="filter-salary">
      <div className="space-y-3 p-3">
        <div className="space-y-1.5">
          <Label htmlFor="filter-salary-min">Minimum pay</Label>
          <Input
            id="filter-salary-min"
            inputMode="numeric"
            placeholder="For example 80000"
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onBlur={commit}
            onKeyDown={(e) => {
              if (e.key === "Enter") commit();
            }}
          />
          <p className="text-xs text-subtle-foreground">Matches jobs whose posted range reaches this amount, in the currency and pay period of each job.</p>
        </div>
        <div className="flex flex-wrap gap-1.5">
          {SALARY_PRESETS.map((p) => (
            <button
              key={p}
              type="button"
              onClick={() => onChange(p)}
              className={cn("rounded-full border px-2.5 py-1 text-xs font-semibold transition-colors", value === p ? "border-primary bg-primary/10 text-foreground" : "border-border hover:bg-muted")}
            >
              {p.toLocaleString()}+
            </button>
          ))}
        </div>
      </div>
      <PopoverFooter onReset={() => onChange(null)} disabled={!value} />
    </FilterButton>
  );
}

function PostedFilter({ value, onChange }: { value: number | null; onChange: (v: number | null) => void }) {
  const label = POSTED_OPTIONS.find((o) => o.value === value)?.label ?? "Any time";
  return (
    <FilterButton label={value ? label : "Date posted"} active={!!value} testId="filter-posted" width="w-60">
      <div role="radiogroup" aria-label="Date posted" className="p-2">
        {POSTED_OPTIONS.map((o) => (
          <PopoverClose asChild key={o.label}>
            <button
              type="button"
              role="radio"
              aria-checked={value === o.value}
              onClick={() => onChange(o.value)}
              className={cn("flex w-full items-center gap-3 rounded-md px-2 py-2 text-left text-sm hover:bg-muted", value === o.value && "bg-primary/10 font-semibold")}
            >
              <span className={cn("size-4 rounded-full border", value === o.value ? "border-[5px] border-primary" : "border-input")} aria-hidden />
              {o.label}
            </button>
          </PopoverClose>
        ))}
      </div>
    </FilterButton>
  );
}

/** Keywords, location and the filter pills; every change lands in the URL. */
export function JobFilterBar({ filters, onChange }: { filters: JobFilters; onChange: (f: JobFilters) => void }) {
  const [q, setQ] = useState(filters.q);
  const [location, setLocation] = useState(filters.location);
  useEffect(() => setQ(filters.q), [filters.q]);
  useEffect(() => setLocation(filters.location), [filters.location]);
  const set = (p: Partial<JobFilters>) => onChange({ ...filters, ...p });
  const any = hasAnyFilter(filters);

  return (
    <div className="space-y-3" data-testid="job-filter-bar">
      <form
        role="search"
        className="flex flex-col gap-2 sm:flex-row"
        onSubmit={(e) => {
          e.preventDefault();
          set({ q, location });
        }}
      >
        <div className="relative flex-1">
          <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-subtle-foreground" aria-hidden />
          <Input aria-label="Search by title, skill or company" placeholder="Title, skill or company" value={q} onChange={(e) => setQ(e.target.value)} className="pl-9" maxLength={100} data-testid="job-search-q" />
        </div>
        <div className="relative flex-1 sm:max-w-xs">
          <MapPin className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-subtle-foreground" aria-hidden />
          <Input aria-label="Location" placeholder="City or region" value={location} onChange={(e) => setLocation(e.target.value)} className="pl-9" maxLength={120} data-testid="job-search-location" />
        </div>
        <Button type="submit" className="sm:w-auto" data-testid="job-search-submit">
          Search
        </Button>
      </form>
      <div className="-mx-1 flex items-center gap-2 overflow-x-auto px-1 pb-0.5 [scrollbar-width:none]">
        <MultiFilter label="Workplace" options={WORKPLACE_TYPES} labels={WORKPLACE_LABEL} value={filters.workplace} onChange={(workplace) => set({ workplace })} testId="filter-workplace" />
        <MultiFilter label="Job type" options={EMPLOYMENT_TYPES} labels={EMPLOYMENT_LABEL} value={filters.employment} onChange={(employment) => set({ employment })} testId="filter-employment" />
        <MultiFilter label="Experience level" options={SENIORITIES} labels={SENIORITY_LABEL} value={filters.seniority} onChange={(seniority) => set({ seniority })} testId="filter-seniority" />
        <PostedFilter value={filters.postedWithinDays} onChange={(postedWithinDays) => set({ postedWithinDays })} />
        <SalaryFilter value={filters.salaryMin} onChange={(salaryMin) => set({ salaryMin })} />
        {any ? (
          <Button variant="ghost" size="sm" className="shrink-0" onClick={() => onChange({ ...EMPTY_FILTERS, sort: filters.sort })} data-testid="filter-clear">
            <X aria-hidden />
            Clear all
          </Button>
        ) : null}
        <div className="ml-auto shrink-0">
          <Segmented
            aria-label="Sort by"
            value={filters.sort}
            onChange={(sort) => set({ sort })}
            options={[
              { value: "recent", label: "Most recent" },
              { value: "relevance", label: "Most relevant" },
            ]}
          />
        </div>
      </div>
      {filters.sort === "relevance" && !filters.q.trim() ? <p className="text-xs text-subtle-foreground">Relevance ranks by your keywords. Without keywords, the newest jobs come first.</p> : null}
    </div>
  );
}
