"use client";

import { useEffect, useRef, useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { MailCheck } from "lucide-react";
import { isApiError } from "@open-talent/api-client";
import type { RecruiterAccount } from "@open-talent/types";
import { Button, Card, toast } from "@open-talent/ui";
import { api } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import { errorMessage } from "@/lib/errors";
import { qk } from "@/lib/query-keys";

const RESEND_COOLDOWN = 60;

export function VerifyCode({ account, onVerified, onRestart }: { account: RecruiterAccount; onVerified: (r: RecruiterAccount) => void; onRestart: () => void }) {
  const { reloadMe } = useAuth();
  const qc = useQueryClient();
  const [code, setCode] = useState("");
  const [cooldown, setCooldown] = useState(RESEND_COOLDOWN);
  const [problem, setProblem] = useState<{ text: string; dead: boolean } | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (cooldown <= 0) return;
    const t = setTimeout(() => setCooldown((c) => c - 1), 1000);
    return () => clearTimeout(t);
  }, [cooldown]);

  const verify = useMutation({
    mutationFn: (c: string) => api().recruiter.verify(c),
    meta: { silent: true },
    onSuccess: async (r) => {
      qc.setQueryData(qk.recruiterMe, r);
      await reloadMe();
      onVerified(r);
    },
    onError: (e) => {
      setCode("");
      if (isApiError(e) && e.code === "CODE_WRONG") {
        const left = (e.details as { attemptsLeft?: number } | undefined)?.attemptsLeft;
        setProblem({ text: left === undefined ? errorMessage(e) : left > 0 ? `That code is not right. ${left} attempt${left === 1 ? "" : "s"} left.` : "That code is not right, and that was the last attempt. Send a new code.", dead: left === 0 });
      } else if (isApiError(e) && (e.code === "CODE_LOCKED" || e.code === "CODE_EXPIRED")) {
        setProblem({ text: errorMessage(e), dead: true });
      } else {
        setProblem({ text: errorMessage(e), dead: false });
      }
      setTimeout(() => inputRef.current?.focus(), 0);
    },
  });

  const resend = useMutation({
    mutationFn: () => api().recruiter.resendCode(),
    onSuccess: () => {
      setCooldown(RESEND_COOLDOWN);
      setProblem(null);
      setCode("");
      toast.success({ title: "New code sent", description: `Check ${account.workEmail}.` });
      inputRef.current?.focus();
    },
  });

  const submit = (c: string) => {
    if (c.length === 6 && !verify.isPending && !problem?.dead) verify.mutate(c);
  };

  return (
    <Card className="p-6 sm:p-8" data-testid="recruiter-verify">
      <div className="mx-auto max-w-md text-center">
        <span className="mx-auto flex size-14 items-center justify-center rounded-full bg-primary-soft text-primary-soft-foreground">
          <MailCheck className="size-6" aria-hidden />
        </span>
        <h2 className="mt-4 text-xl font-semibold">Check your work email</h2>
        <p className="mt-1 text-sm text-muted-foreground">
          We sent a six-digit code to <span className="font-semibold text-foreground">{account.workEmail}</span> for {account.company.name}. It expires after a short while.
        </p>
        <form
          className="mt-6"
          onSubmit={(e) => {
            e.preventDefault();
            submit(code);
          }}
        >
          <label htmlFor="rc-code" className="sr-only">
            Six-digit code
          </label>
          <input
            ref={inputRef}
            id="rc-code"
            autoFocus
            inputMode="numeric"
            autoComplete="one-time-code"
            pattern="\d{6}"
            maxLength={6}
            value={code}
            disabled={verify.isPending || problem?.dead}
            aria-invalid={!!problem}
            aria-describedby={problem ? "rc-code-error" : undefined}
            onChange={(e) => {
              const v = e.target.value.replace(/\D/g, "").slice(0, 6);
              setCode(v);
              if (problem && !problem.dead) setProblem(null);
              if (v.length === 6) submit(v);
            }}
            className="h-14 w-full rounded-lg border border-input bg-card text-center font-mono text-3xl font-semibold tracking-[0.5em] text-foreground shadow-sm placeholder:text-subtle-foreground focus-visible:border-ring focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/30 disabled:opacity-60 aria-[invalid=true]:border-danger"
            placeholder="000000"
            data-testid="rc-code-input"
          />
          {problem ? (
            <p id="rc-code-error" role="alert" className="mt-2 text-sm font-medium text-danger" data-testid="rc-code-error">
              {problem.text}
            </p>
          ) : null}
          <Button type="submit" block size="lg" className="mt-4" loading={verify.isPending} disabled={code.length !== 6 || problem?.dead} data-testid="rc-code-submit">
            Verify
          </Button>
        </form>
        <div className="mt-4 flex flex-wrap items-center justify-center gap-x-4 gap-y-2 text-sm">
          <Button variant="link" disabled={cooldown > 0 || resend.isPending} onClick={() => resend.mutate()} data-testid="rc-code-resend">
            {cooldown > 0 ? `Send a new code in ${cooldown}s` : resend.isPending ? "Sending..." : "Send a new code"}
          </Button>
          <Button variant="link" onClick={onRestart} data-testid="rc-code-restart">
            Use a different email or company
          </Button>
        </div>
      </div>
    </Card>
  );
}
