"use client";

import type { ReactNode } from "react";
import { InvitationsCard } from "./invitations-card";
import { ManageCard } from "./manage-card";
import { SuggestionsGrid } from "./suggestions-grid";

/** Network pages: the "Manage my network" card on the left (stacked on top on small screens). */
export function NetworkShell({ children, active }: { children: ReactNode; active?: "connections" }) {
  return (
    <main id="main" className="mx-auto grid max-w-[1128px] gap-4 px-4 py-4 lg:grid-cols-[300px_minmax(0,1fr)] lg:gap-6">
      <aside className="lg:sticky lg:top-[calc(var(--header-height)+1rem)] lg:self-start">
        <ManageCard active={active} />
      </aside>
      <div className="min-w-0 space-y-4">{children}</div>
    </main>
  );
}

export function NetworkPage() {
  return (
    <NetworkShell>
      <InvitationsCard />
      <SuggestionsGrid />
    </NetworkShell>
  );
}
