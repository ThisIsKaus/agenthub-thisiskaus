import { useEffect, useRef } from "react";
import { useJobDrawer } from "@/lib/job-drawer";
import { useLocal } from "@/lib/local-bridge";

function stamp(date: Date) {
  return date.toLocaleTimeString(undefined, {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  });
}

/** Persistent output drawer docked to the bottom — collapsed until a job runs. */
export function JobDrawer() {
  const { available } = useLocal();
  const { jobs, activeId, open, setOpen, setActiveId } = useJobDrawer();
  const scroller = useRef<HTMLPreElement>(null);
  const active = jobs.find((job) => job.id === activeId) ?? jobs[0] ?? null;

  useEffect(() => {
    const node = scroller.current;
    if (!node || !open) return;
    node.scrollTop = node.scrollHeight;
  }, [active?.out, active?.running, open]);

  if (!available || jobs.length === 0) return null;

  const running = jobs.some((job) => job.running);

  return (
    <div className="fixed inset-x-0 bottom-0 z-30 border-t border-rule bg-panel">
      <div className="page-width">
        <button
          type="button"
          onClick={() => setOpen(!open)}
          aria-expanded={open}
          className="flex w-full items-center justify-between gap-3 py-2.5 text-left"
        >
          <span className="flex items-center gap-2 font-mono text-[11px] uppercase tracking-[0.245em] text-faint">
            <span
              aria-hidden
              className={`h-1.5 w-1.5 rounded-full ${running ? "bg-copper" : "bg-faint"}`}
            />
            Jobs
            <span className="text-muted-foreground normal-case tracking-normal">
              {active ? `${active.label} · ${running ? "running" : `exit ${active.code ?? 0}`}` : ""}
            </span>
          </span>
          <span className="font-mono text-[11px] text-faint">{open ? "collapse" : "expand"}</span>
        </button>

        {open && (
          <div className="pb-3">
            <div className="-mx-4 mb-2 flex gap-2 overflow-x-auto px-4 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
              {jobs.map((job) => {
                const isActive = job.id === active?.id;
                return (
                  <button
                    key={job.id}
                    type="button"
                    onClick={() => setActiveId(job.id)}
                    className={`shrink-0 border px-2 py-1 font-mono text-[10px] uppercase tracking-[0.27em] ${
                      isActive
                        ? "border-copper text-copper"
                        : "border-rule text-faint hover:text-paper"
                    }`}
                  >
                    {job.label} · {stamp(job.startedAt)}
                  </button>
                );
              })}
            </div>

            {active && (
              <pre
                ref={scroller}
                className="max-h-[38vh] overflow-y-auto whitespace-pre-wrap break-words border border-rule bg-panel2 p-3 font-mono text-[11px] leading-relaxed text-muted-foreground"
              >
                {active.out || (active.running ? "…" : "")}
                {!active.running && (
                  <span className={active.code === 0 ? "text-ok" : "text-risk"}>
                    {`\n— finished, exit ${active.code ?? 0}`}
                  </span>
                )}
              </pre>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
