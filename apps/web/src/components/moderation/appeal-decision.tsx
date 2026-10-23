"use client";

import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { isApiError } from "@open-talent/api-client";
import { Button, Field, Textarea, toast } from "@open-talent/ui";
import type { Appeal } from "@open-talent/types";
import { api } from "@/lib/api";
import { errorMessage } from "@/lib/errors";
import { qk } from "@/lib/query-keys";

/** Uphold or overturn an appeal; shared by the appeals tab and the case drawer. */
export function useDecideAppeal(appeal: Appeal) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (v: { status: "UPHELD" | "OVERTURNED"; note?: string }) => api().moderation.decideAppeal(appeal.id, v.status, v.note),
    meta: { silent: true },
    onSuccess: (_a, v) => {
      toast.success({ title: v.status === "OVERTURNED" ? "Decision overturned" : "Decision upheld", description: "The member was notified." });
      void qc.invalidateQueries({ queryKey: ["mod-appeals"] });
      void qc.invalidateQueries({ queryKey: qk.modStats });
      void qc.invalidateQueries({ queryKey: qk.modCase(appeal.caseId) });
      void qc.invalidateQueries({ queryKey: qk.modCasesAll });
    },
    onError: (e) => {
      const conflict = isApiError(e) && (e.code === "APPEAL_CONFLICT" || e.code === "SELF_MODERATION");
      toast.error({
        title: conflict ? "Another moderator needs to decide this appeal" : "Could not record the decision",
        description: isApiError(e) && e.code === "APPEAL_CONFLICT" ? "You made the original decision. An admin can override with a written note." : errorMessage(e),
      });
    },
  });
}

export function AppealDecision({ appeal }: { appeal: Appeal }) {
  const [note, setNote] = useState("");
  const decide = useDecideAppeal(appeal);
  return (
    <div className="space-y-2">
      <Field label="Note to the member" htmlFor={`note-${appeal.id}`} optional>
        <Textarea id={`note-${appeal.id}`} rows={2} value={note} onChange={(e) => setNote(e.target.value)} maxLength={1000} />
      </Field>
      <div className="flex flex-wrap justify-end gap-2">
        <Button
          variant="outline"
          size="sm"
          onClick={() => decide.mutate({ status: "UPHELD", note: note.trim() || undefined })}
          loading={decide.isPending && decide.variables?.status === "UPHELD"}
          disabled={decide.isPending}
          data-testid="appeal-uphold"
        >
          Uphold decision
        </Button>
        <Button
          size="sm"
          onClick={() => decide.mutate({ status: "OVERTURNED", note: note.trim() || undefined })}
          loading={decide.isPending && decide.variables?.status === "OVERTURNED"}
          disabled={decide.isPending}
          data-testid="appeal-overturn"
        >
          Overturn and restore
        </Button>
      </div>
    </div>
  );
}
