import type { ReactNode } from "react";
import { useLocal } from "@/lib/local-bridge";

/**
 * Renders children only when the app is running on the machine itself.
 * Absence is correct behaviour — never fall back to remote data here.
 */
export function LocalOnly({ children }: { children: ReactNode }) {
  const { available } = useLocal();

  if (!available) {
    return (
      <section className="border border-rule bg-panel p-5">
        <p className="text-[13px] leading-relaxed text-muted-foreground">
          Available on the machine. This section reads material that never leaves it.
        </p>
      </section>
    );
  }

  return <>{children}</>;
}

/** A 403 is a control working correctly, not an error. */
export function LocalRefusal({ message }: { message: string }) {
  return <p className="text-[13px] leading-relaxed text-muted-foreground">{message}</p>;
}

export function LocalPlanePill() {
  const { available, machine } = useLocal();
  const posture = (machine?.posture as string | undefined) ?? "on";

  return (
    <span className="inline-flex shrink-0 items-center gap-2 border border-rule bg-panel2 px-2 py-1 font-mono text-[11px] tracking-tight">
      <span
        aria-hidden
        className={`h-1.5 w-1.5 rounded-full ${available ? "bg-copper" : "bg-faint"}`}
      />
      <span className={available ? "text-paper" : "text-faint"}>
        {available ? `local · ${posture}` : "remote"}
      </span>
    </span>
  );
}
