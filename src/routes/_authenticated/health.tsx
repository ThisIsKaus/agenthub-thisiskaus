import { createFileRoute } from "@tanstack/react-router";
import { useCallback, useEffect, useState } from "react";
import { Panel } from "@/components/AppShell";
import { Empty, Skeleton } from "@/components/data";
import { LocalOnly } from "@/components/LocalOnly";
import { useLocal } from "@/lib/local-bridge";
import { useJobDrawer } from "@/lib/job-drawer";

export const Route = createFileRoute("/_authenticated/health")({
  head: () => ({
    meta: [
      { title: "Health — AgentHub Remote" },
      {
        name: "description",
        content: "Self-test results for the machine: checks passed, warnings and failures.",
      },
      { property: "og:title", content: "Health — AgentHub Remote" },
      {
        property: "og:description",
        content: "Self-test results for the machine: checks passed, warnings and failures.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: () => (
    <LocalOnly>
      <HealthPage />
    </LocalOnly>
  ),
});

type CheckRow = {
  group?: string;
  name?: string;
  state?: string;
  detail?: string;
  fix?: string;
};

type SelfTest = {
  summary?: {
    passed?: number;
    warnings?: number;
    failed?: number;
    at?: string;
  } & Record<string, unknown>;
  rows?: CheckRow[];
  at?: string;
};

function stateTone(state: string | undefined) {
  const value = (state ?? "").toLowerCase();
  if (value.startsWith("pass") || value === "ok") return "text-ok border-ok/50";
  if (value.startsWith("warn")) return "text-watch border-watch/50";
  if (value.startsWith("fail") || value === "error") return "text-risk border-risk/50";
  return "text-faint border-rule";
}

function isFailed(state: string | undefined) {
  const value = (state ?? "").toLowerCase();
  return value.startsWith("fail") || value === "error";
}

function stamp(value: string | undefined) {
  if (!value) return "—";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleString(undefined, {
    month: "short",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  });
}

function HealthPage() {
  const local = useLocal();
  const { runJob } = useJobDrawer();
  const [data, setData] = useState<SelfTest | null>(null);
  const [loading, setLoading] = useState(true);
  const [expanded, setExpanded] = useState<Record<number, boolean>>({});

  const load = useCallback(async () => {
    setLoading(true);
    try {
      setData(await local.get<SelfTest>("/api/selftest"));
    } catch {
      setData(null);
    } finally {
      setLoading(false);
    }
  }, [local]);

  useEffect(() => {
    void load();
  }, [load]);

  const rows = data?.rows ?? [];
  const summary = data?.summary ?? {};
  const passed = Number(summary.passed ?? rows.filter((row) => !isFailed(row.state) && (row.state ?? "").toLowerCase().startsWith("pass")).length);
  const warnings = Number(summary.warnings ?? rows.filter((row) => (row.state ?? "").toLowerCase().startsWith("warn")).length);
  const failed = Number(summary.failed ?? rows.filter((row) => isFailed(row.state)).length);
  const at = (summary.at as string | undefined) ?? data?.at;

  const worst = failed > 0 ? "text-risk" : warnings > 0 ? "text-watch" : "text-ok";

  return (
    <div className="space-y-4">
      <Panel title="Self-test">
        {loading ? (
          <Skeleton className="h-6 w-64" />
        ) : data === null ? (
          <Empty>No self-test has been recorded.</Empty>
        ) : (
          <>
            <p className={`font-mono text-[15px] tabular-nums ${worst}`}>
              {passed} passed · {warnings} warnings · {failed} failed
            </p>
            <p className="mt-1 font-mono text-[10px] text-faint">last run {stamp(at)}</p>
          </>
        )}

        <div className="mt-4 flex flex-wrap gap-2">
          <button
            type="button"
            onClick={() =>
              void runJob("verify", "self-test", () => {
                void load();
              })
            }
            className="border border-copper px-3 py-1.5 font-mono text-[11px] uppercase tracking-[0.12em] text-copper"
          >
            Run self-test
          </button>
          <button
            type="button"
            onClick={() =>
              void runJob("repair", "repair", () => {
                void load();
              })
            }
            className="border border-rule px-3 py-1.5 font-mono text-[11px] uppercase tracking-[0.12em] text-muted-foreground hover:text-paper"
          >
            Repair to known-good
          </button>
        </div>
      </Panel>

      <Panel title={`Checks · as of ${stamp(at)}`}>
        {loading ? (
          <div className="space-y-2">
            {Array.from({ length: 8 }).map((_, index) => (
              <Skeleton key={index} className="h-4 w-full" />
            ))}
          </div>
        ) : rows.length === 0 ? (
          <Empty>No checks reported.</Empty>
        ) : (
          <ul>
            {rows.map((row, index) => {
              const failedRow = isFailed(row.state);
              const isOpen = expanded[index] ?? false;
              return (
                <li key={`${row.group}-${row.name}-${index}`} className="border-b border-rule last:border-b-0">
                  <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1 py-2.5">
                    <span className="w-full shrink-0 font-mono text-[10px] uppercase tracking-[0.12em] text-faint sm:w-28">
                      {row.group ?? "—"}
                    </span>
                    <span className="min-w-0 flex-1 text-[13px] text-paper">{row.name ?? "—"}</span>
                    <span
                      className={`shrink-0 border px-2 py-0.5 font-mono text-[10px] uppercase tracking-[0.12em] ${stateTone(row.state)}`}
                    >
                      {row.state ?? "—"}
                    </span>
                    {row.detail && (
                      <span className="w-full font-mono text-[11px] text-muted-foreground">
                        {row.detail}
                      </span>
                    )}
                    {failedRow && row.fix && (
                      <button
                        type="button"
                        onClick={() => setExpanded((prev) => ({ ...prev, [index]: !isOpen }))}
                        aria-expanded={isOpen}
                        className="font-mono text-[10px] uppercase tracking-[0.12em] text-copper"
                      >
                        {isOpen ? "hide fix" : "show fix"}
                      </button>
                    )}
                  </div>
                  {failedRow && row.fix && isOpen && (
                    <pre className="mb-3 whitespace-pre-wrap break-words border border-rule bg-panel2 p-3 font-mono text-[11px] leading-relaxed text-muted-foreground">
                      {row.fix}
                    </pre>
                  )}
                </li>
              );
            })}
          </ul>
        )}
      </Panel>
    </div>
  );
}
