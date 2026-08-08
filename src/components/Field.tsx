import type { ReactNode } from "react";

export type FieldTone = "paper" | "ok" | "watch" | "risk" | "copper" | "faint";

const TONE: Record<FieldTone, string> = {
  paper: "text-paper",
  ok: "text-ok",
  watch: "text-watch",
  risk: "text-risk",
  copper: "text-copper",
  faint: "text-faint",
};

/**
 * <Field> owns the three-part figure used everywhere:
 *   1 · a large number in Bricolage Grotesque 500, tabular-nums
 *   2 · an uppercase Geist Mono 10px label beneath it, 2.7px tracking
 *   3 · a tertiary detail line third
 * Any h3 inside computes to exactly 15px medium.
 */
export function Field({
  label,
  value,
  unit,
  detail,
  tone = "paper",
  missing = false,
  className = "",
}: {
  label: ReactNode;
  value: ReactNode;
  unit?: ReactNode;
  detail?: ReactNode;
  tone?: FieldTone;
  missing?: boolean;
  className?: string;
}) {
  return (
    <div className={`border border-rule bg-panel2 px-3 py-4 sm:px-4 sm:py-5 ${className}`}>
      <div
        className={`font-serif text-[1.85rem] leading-none tabular-nums sm:text-[2.1rem] ${
          missing ? "text-faint" : TONE[tone]
        }`}
      >
        {missing ? "—" : value}
        {!missing && unit ? (
          <span className="ml-1 font-mono text-[13px] text-muted-foreground">{unit}</span>
        ) : null}
      </div>
      <div className="mono-label mt-3 text-muted-foreground">{label}</div>
      {detail || missing ? (
        <div className="mt-1 break-words font-mono text-[10px] leading-relaxed text-faint">
          {missing ? "needs the machine" : detail}
        </div>
      ) : null}
    </div>
  );
}

/** The one h3 in the app: 15px medium, sentence case. */
export function FieldHeading({ children }: { children: ReactNode }) {
  return <h3 className="font-serif text-[15px] font-medium leading-tight text-paper">{children}</h3>;
}
