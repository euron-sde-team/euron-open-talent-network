import type { InfiniteData, QueryClient } from "@tanstack/react-query";
import { filterPages, mapPages } from "@open-talent/api-client";
import type { NetworkEntry, Page } from "@open-talent/types";

/** A network row keyed by the person, so it fits `usePagedList` (which dedupes by id). */
export type NetworkRow = NetworkEntry & { id: string };

export function withIds(page: Page<NetworkEntry>): Page<NetworkRow> {
  return { ...page, items: page.items.map((e) => ({ ...e, id: e.user.id })) };
}

/** Optimistically drop rows from an infinite list; returns the previous data for rollback. */
export function removeRows<T extends { id: string }>(qc: QueryClient, key: readonly unknown[], pred: (row: T) => boolean) {
  const prev = qc.getQueryData<InfiniteData<Page<T>>>(key);
  if (prev) qc.setQueryData<InfiniteData<Page<T>>>(key, { ...prev, pages: filterPages(prev.pages, (r) => !pred(r)) });
  return prev;
}

/** Optimistically patch rows of an infinite list; returns the previous data for rollback. */
export function patchRows<T extends { id: string }>(qc: QueryClient, key: readonly unknown[], fn: (row: T) => T) {
  const prev = qc.getQueryData<InfiniteData<Page<T>>>(key);
  if (prev) qc.setQueryData<InfiniteData<Page<T>>>(key, { ...prev, pages: mapPages(prev.pages, fn) });
  return prev;
}
