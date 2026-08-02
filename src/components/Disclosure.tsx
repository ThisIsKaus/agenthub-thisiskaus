/**
 * Disclosure — the single expansion primitive.
 *
 * Summary by default, detail on expansion, raw on request. Every expansion in
 * the app behaves identically: the chevron rotates, the panel opens over 150ms,
 * and both animations are dropped under prefers-reduced-motion.
 */
import { useId, useState, type ReactNode } from "react";

export function Disclosure({
  summary,
  children,
  defaultOpen = false,
  tone = "default",
  testId,
}: {
  summary: ReactNode;
  children: ReactNode;
  defaultOpen?: boolean;
  /** `quiet` is for nested rows inside an already-expanded panel. */
  tone?: "default" | "quiet";
  testId?: string;
}) {
  const [open, setOpen] = useState(defaultOpen);
  const id = useId();

  return (
    <div className={tone === "quiet" ? "" : "border-t border-rule first:border-t-0"} data-testid={testId}>
      <button
        type="button"
        aria-expanded={open}
        aria-controls={id}
        onClick={() => setOpen((value) => !value)}
        className="flex w-full items-start gap-2 py-2.5 text-left"
      >
        <span
          aria-hidden
          className={`mt-[3px] shrink-0 text-copper transition-transform duration-150 motion-reduce:transition-none ${
            open ? "rotate-90" : ""
          }`}
        >
          ›
        </span>
        <span className="min-w-0 flex-1">{summary}</span>
      </button>
      <div
        id={id}
        hidden={!open}
        className="grid transition-[grid-template-rows] duration-150 ease-out motion-reduce:transition-none"
        style={{ gridTemplateRows: open ? "1fr" : "0fr" }}
      >
        <div className="overflow-hidden">
          <div className="pb-3 pl-4">{children}</div>
        </div>
      </div>
    </div>
  );
}
