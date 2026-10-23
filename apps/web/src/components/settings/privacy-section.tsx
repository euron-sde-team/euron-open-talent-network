"use client";

import { useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { BriefcaseBusiness, Globe2, Lock } from "lucide-react";
import { Button, cn, toast } from "@open-talent/ui";
import type { MessageRequestPolicy } from "@open-talent/types";
import { api } from "@/lib/api";
import { useAuth, useMe } from "@/lib/auth";
import { SettingsCard } from "./section";

const OPTIONS: { value: MessageRequestPolicy; title: string; body: string; icon: typeof Globe2 }[] = [
  { value: "ANYONE", title: "Anyone on the network", body: "Your connections message you directly. Anyone else can send a message request, which waits in your Requests tab until you accept it.", icon: Globe2 },
  { value: "RECRUITERS", title: "Only verified recruiters", body: "Your connections message you directly. Only recruiters with a verified work email can send you a message request.", icon: BriefcaseBusiness },
  { value: "NOBODY", title: "Nobody new", body: "Only your connections, and recruiters whose approach you accepted, can message you. Existing conversations stay open.", icon: Lock },
];

export function PrivacySection() {
  const me = useMe();
  const { setUser } = useAuth();
  const [value, setValue] = useState<MessageRequestPolicy>(me.messageRequestPolicy);
  const save = useMutation({
    mutationFn: () => api().users.updateMe({ messageRequestPolicy: value }),
    onSuccess: (m) => {
      setUser(m);
      toast.success({ title: "Privacy updated" });
    },
  });
  return (
    <SettingsCard
      title="Message requests"
      description="Choose who can reach you when you are not connected. Blocked people can never message you."
      footer={
        <Button onClick={() => save.mutate()} loading={save.isPending} disabled={value === me.messageRequestPolicy} data-testid="settings-save">
          Save
        </Button>
      }
    >
      <div role="radiogroup" aria-label="Who can send you message requests" className="space-y-2">
        {OPTIONS.map((o) => {
          const active = value === o.value;
          return (
            <button
              key={o.value}
              type="button"
              role="radio"
              aria-checked={active}
              onClick={() => setValue(o.value)}
              data-testid={`message-policy-${o.value.toLowerCase()}`}
              className={cn("flex w-full items-start gap-3 rounded-lg border p-4 text-left transition-colors", active ? "border-primary bg-primary/10" : "border-border hover:bg-muted")}
            >
              <span className={cn("mt-0.5 flex size-9 shrink-0 items-center justify-center rounded-full", active ? "bg-primary text-primary-foreground" : "bg-muted text-muted-foreground")}>
                <o.icon className="size-4" />
              </span>
              <span className="min-w-0 flex-1">
                <span className="block text-sm font-semibold">{o.title}</span>
                <span className="mt-0.5 block text-sm text-muted-foreground">{o.body}</span>
              </span>
              <span className={cn("mt-1 size-4 shrink-0 rounded-full border-2", active ? "border-primary bg-primary shadow-[inset_0_0_0_3px_hsl(var(--card))]" : "border-input")} aria-hidden />
            </button>
          );
        })}
      </div>
    </SettingsCard>
  );
}
