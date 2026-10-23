"use client";

import { useEffect, useRef, useState } from "react";
import { Mic, RotateCcw, Square } from "lucide-react";
import { Button, cn } from "@open-talent/ui";

const MAX_SECONDS = 300;
/** Audio formats the API accepts for imports, in order of preference (WebM/Opus first: Chrome and Firefox record it). */
const CANDIDATES: { mime: string; base: string; ext: string }[] = [
  { mime: "audio/webm;codecs=opus", base: "audio/webm", ext: "webm" },
  { mime: "audio/webm", base: "audio/webm", ext: "webm" },
  { mime: "audio/mp4", base: "audio/mp4", ext: "m4a" },
  { mime: "audio/ogg;codecs=opus", base: "audio/ogg", ext: "ogg" },
  { mime: "audio/ogg", base: "audio/ogg", ext: "ogg" },
];

export function recorderFormat(): (typeof CANDIDATES)[number] | null {
  if (typeof window === "undefined" || typeof MediaRecorder === "undefined" || !navigator.mediaDevices?.getUserMedia) return null;
  return CANDIDATES.find((c) => MediaRecorder.isTypeSupported(c.mime)) ?? null;
}

const clock = (s: number) => `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;

/** Record a voice note about your work; hands back a File ready for the IMPORT upload. */
export function VoiceRecorder({ onFile, disabled }: { onFile: (f: File) => void; disabled?: boolean }) {
  const [state, setState] = useState<"idle" | "recording" | "done" | "denied">("idle");
  const [seconds, setSeconds] = useState(0);
  const [url, setUrl] = useState<string | null>(null);
  const rec = useRef<MediaRecorder | null>(null);
  const timer = useRef<ReturnType<typeof setInterval> | null>(null);
  const format = recorderFormat();

  const stopTracks = () => rec.current?.stream.getTracks().forEach((t) => t.stop());
  useEffect(
    () => () => {
      if (timer.current) clearInterval(timer.current);
      stopTracks();
    },
    [],
  );
  useEffect(() => () => void (url && URL.revokeObjectURL(url)), [url]);

  const start = async () => {
    if (!format) return;
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const chunks: Blob[] = [];
      const r = new MediaRecorder(stream, { mimeType: format.mime });
      r.ondataavailable = (e) => e.data.size && chunks.push(e.data);
      r.onstop = () => {
        stopTracks();
        if (timer.current) clearInterval(timer.current);
        const blob = new Blob(chunks, { type: format.base });
        const file = new File([blob], `voice-note.${format.ext}`, { type: format.base });
        setUrl(URL.createObjectURL(blob));
        setState("done");
        onFile(file);
      };
      rec.current = r;
      r.start(1000);
      setSeconds(0);
      setState("recording");
      const startedAt = Date.now();
      timer.current = setInterval(() => {
        const s = Math.floor((Date.now() - startedAt) / 1000);
        setSeconds(s);
        if (s >= MAX_SECONDS && r.state === "recording") r.stop();
      }, 500);
    } catch {
      setState("denied");
    }
  };
  const stop = () => rec.current?.state === "recording" && rec.current.stop();

  if (!format)
    return (
      <p className="rounded-md bg-muted px-4 py-3 text-sm text-muted-foreground">
        This browser can not record in a format we accept. Record a voice memo on your phone and upload it as a file (MP3, M4A, OGG or WAV).
      </p>
    );

  return (
    <div className="flex flex-col items-center gap-3 rounded-lg border border-dashed border-border px-4 py-6 text-center" data-testid="voice-recorder">
      <p className="max-w-md text-sm text-muted-foreground">Talk for two or three minutes: your current role, what you built, the tools you use and what you want next. Up to {MAX_SECONDS / 60} minutes.</p>
      <div className={cn("text-3xl font-bold tabular-nums", state === "recording" ? "text-danger" : "text-foreground")} aria-live="polite">
        {clock(seconds)}
      </div>
      {state === "recording" ? (
        <Button variant="danger" onClick={stop} data-testid="voice-stop">
          <Square /> Stop recording
        </Button>
      ) : state === "done" ? (
        <>
          {url ? <audio controls src={url} className="w-full max-w-sm" aria-label="Your recording" /> : null}
          <Button variant="outline" onClick={() => void start()} disabled={disabled}>
            <RotateCcw /> Record again
          </Button>
        </>
      ) : (
        <Button onClick={() => void start()} disabled={disabled} data-testid="voice-start">
          <Mic /> Start recording
        </Button>
      )}
      {state === "denied" ? <p className="text-sm text-danger">Microphone access was blocked. Allow it in your browser settings, or upload a file instead.</p> : null}
    </div>
  );
}
