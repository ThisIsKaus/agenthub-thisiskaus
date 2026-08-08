import type { ReactNode } from "react";
import { Field } from "@/components/Field";

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
      <div className="font-mono text-[10px] uppercase tracking-[0.27em] text-faint">{label}</div>
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

/** Editorial figure — the shared <Field> pattern. */
export function Figure({
  label,
  value,
  detail,
  tone = "paper",
}: {
  label: ReactNode;
  value: ReactNode;
  detail?: string;
  tone?: "paper" | "ok" | "watch" | "risk" | "copper";
}) {
  return <Field label={label} value={value} detail={detail} tone={tone} />;
}


/** Small monospace status pill. */
export function StatusPill({
  label,
  value,
  tone = "paper",
}: {
  label: string;
  value: ReactNode;
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
    <span className="inline-flex shrink-0 items-center gap-2 border border-rule bg-panel2 px-2 py-1 font-mono text-[11px]">
      <span className="uppercase tracking-[0.12em] text-faint">{label}</span>
      <span className={`tabular-nums ${toneClass}`}>{value}</span>
    </span>
  );
}

/** Loading placeholder in panel grey. Never a spinner. */
export function Skeleton({ className = "h-4 w-24" }: { className?: string }) {
  return <div className={`skeleton bg-panel2 ${className}`} aria-hidden />;
}

export function FigureSkeleton() {
  return (
    <div className="border border-rule bg-panel2 px-4 py-5">
      <Skeleton className="h-9 w-20" />
      <Skeleton className="mt-3 h-2.5 w-16" />
    </div>
  );
}

/** A plain-language heading that says what a section is for. */
export function PageIntro({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div className="border-b border-rule pb-3">
      <h1 className="font-serif text-2xl leading-none text-paper">{title}</h1>
      <p className="mt-2 max-w-[62ch] text-[13px] leading-relaxed text-muted-foreground">
        {children}
      </p>
    </div>
  );
}
