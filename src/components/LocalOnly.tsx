import type { ReactNode } from "react";
import { useLocal } from "@/lib/local-bridge";

/**
 * Local-plane sections. Away from the machine this renders one quiet line —
 * no error styling, no spinner, no retry, and never a Supabase fallback.
 */
export function LocalOnly({ children }: { children: ReactNode }) {
  const { available } = useLocal();

  if (!available) {
    return (
      <div className="border border-rule bg-panel px-4 py-4">
        <p className="text-[13px] leading-relaxed text-muted-foreground">
          Available on the machine. This section reads material that never leaves it.
        </p>
      </div>
    );
  }

  return <>{children}</>;
}

/** A 403 is a control working correctly, so it reads as a refusal, not a failure. */
export function LocalRefusalNote({ message }: { message: string }) {
  return <p className="text-[13px] leading-relaxed text-muted-foreground">{message}</p>;
}
