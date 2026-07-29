import type { ReactNode } from "react";

/** A large monospace figure with a hairline-quiet label. */
export function Stat({
  label,
  value,
  hint,
  tone = "paper",
}: {
  label: string;
  value: ReactNode;
  hint?: string;
  tone?: "paper" | "ok" | "watch" | "risk" | "copper" | "faint";
}) {
  const toneClass = {
    paper: "text-paper",
    ok: "text-ok",
    watch: "text-watch",
    risk: "text-risk",
    copper: "text-copper",
    faint: "text-faint",
  }[tone];

  return (
    <div className="border border-rule bg-panel2 px-3 py-3">
      <div className="font-mono text-[10px] uppercase tracking-[0.14em] text-faint">{label}</div>
      <div className={`mt-2 font-mono text-2xl leading-none tabular-nums ${toneClass}`}>{value}</div>
      {hint && <div className="mt-1.5 font-mono text-[10px] text-faint">{hint}</div>}
    </div>
  );
}

/** Label/value row separated by a hairline. */
export function Row({ label, value }: { label: string; value: ReactNode }) {
  return (
    <div className="flex items-baseline justify-between gap-4 border-t border-rule py-2.5 first:border-t-0">
      <span className="text-[13px] text-muted-foreground">{label}</span>
      <span className="font-mono text-[13px] tabular-nums text-paper">{value}</span>
    </div>
  );
}

export function Empty({ children }: { children: ReactNode }) {
  return <p className="font-mono text-[11px] text-faint">{children}</p>;
}

export function formatStamp(value: string | null | undefined) {
  if (!value) return "—";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "—";
  return date.toLocaleString(undefined, {
    month: "short",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  });
}
