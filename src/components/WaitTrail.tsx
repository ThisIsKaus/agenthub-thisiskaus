/**
 * One wait treatment, used everywhere a local operation takes longer than a
 * glance: Canvas ask, Build, and the approve path on Proposals.
 *
 * A spinner says only that something is happening. A number says how long it
 * has been happening, and the staged lines say what is happening now — which
 * is the difference between a slow answer and an apparently broken one.
 */
import { useEffect, useState } from "react";

export type WaitStage = { at: number; text: string };

/** Seconds since `active` went true; frozen at 0 while inactive. */
export function useElapsed(active: boolean): number {
  const [elapsed, setElapsed] = useState(0);
  useEffect(() => {
    if (!active) return;
    const started = Date.now();
    setElapsed(0);
    const timer = window.setInterval(
      () => setElapsed(Math.floor((Date.now() - started) / 1000)),
      1000,
    );
    return () => window.clearInterval(timer);
  }, [active]);
  return elapsed;
}

/** A local 35B answering from a 50,000-chunk corpus takes 30 to 90 seconds. */
export function askStages(chunks: number | null): WaitStage[] {
  return [
    { at: 3, text: `retrieving from ${chunks ? chunks.toLocaleString() : "the"} chunks` },
    { at: 10, text: "the 35B is reasoning · local answers take 30 to 90 seconds" },
    {
      at: 45,
      text: "still going · the model may be loading, which adds about a minute the first time",
    },
  ];
}

/** A tier-4 cascade run can take five minutes. */
export const BUILD_STAGES: WaitStage[] = [
  { at: 3, text: "starting the cascade on the machine" },
  { at: 10, text: "the build is running · a cascade takes minutes, not seconds" },
  { at: 45, text: "still going · a tier-4 run can take about five minutes" },
];

export function formatElapsed(seconds: number) {
  if (seconds < 60) return `${seconds}s`;
  return `${Math.floor(seconds / 60)}m ${String(seconds % 60).padStart(2, "0")}s`;
}

export type WaitTrailProps = {
  running: boolean;
  elapsed: number;
  stages: WaitStage[];
  /** Verbatim failure text — status and message — rendered in --fail. */
  error?: string | null;
  /** Seconds after which the operation is declared unanswered. */
  giveUpAt?: number;
  giveUpText?: string;
  onRetry?: () => void;
  /** Offered alongside the 45s line: a faster, already-resident path. */
  fastLane?: { label: string; at?: number; run: () => void } | null;
};

export function WaitTrail({
  running,
  elapsed,
  stages,
  error,
  giveUpAt = 180,
  giveUpText = "no answer after three minutes",
  onRetry,
  fastLane,
}: WaitTrailProps) {
  if (!running && !error) return null;

  const reached = stages.filter((stage) => elapsed >= stage.at);
  const current = reached.length ? reached[reached.length - 1] : null;
  const gaveUp = running && elapsed >= giveUpAt;
  const fastAt = fastLane?.at ?? 45;
  const offerFast = running && !!fastLane && elapsed >= fastAt;

  return (
    <div className="space-y-1" data-testid="wait-trail" aria-live="polite">
      {running && (
        <p className="font-mono text-[12px] tabular-nums text-paper" data-testid="wait-elapsed">
          {formatElapsed(elapsed)}
          {current && <span className="ml-2 text-faint">{current.text}</span>}
        </p>
      )}

      {gaveUp && (
        <p className="flex flex-wrap items-center gap-3 font-mono text-[11px] text-risk">
          <span>
            {giveUpText} · {formatElapsed(elapsed)}
          </span>
          {onRetry && (
            <button type="button" onClick={onRetry} className="underline underline-offset-4">
              retry
            </button>
          )}
        </p>
      )}

      {offerFast && (
        <button
          type="button"
          onClick={fastLane.run}
          className="border border-rule px-2 py-1 font-mono text-[10px] uppercase tracking-[0.27em] text-faint hover:border-copper hover:text-copper"
        >
          {fastLane.label}
        </button>
      )}

      {error && (
        <p className="flex flex-wrap items-center gap-3 font-mono text-[11px] text-risk">
          <span data-testid="wait-error">
            {error} · {formatElapsed(elapsed)}
          </span>
          {onRetry && (
            <button type="button" onClick={onRetry} className="underline underline-offset-4">
              retry
            </button>
          )}
        </p>
      )}
    </div>
  );
}
