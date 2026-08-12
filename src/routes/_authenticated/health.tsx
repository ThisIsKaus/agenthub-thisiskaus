import { createFileRoute } from "@tanstack/react-router";
import { Page } from "@/components/Page";
import { useCallback, useEffect, useState } from "react";
import { Panel } from "@/components/AppShell";
import { Empty, Skeleton } from "@/components/data";
import { LocalOnly } from "@/components/LocalOnly";
import { CascadePanel } from "@/components/CascadePanel";
import { Disclosure } from "@/components/Disclosure";
import { useLocal } from "@/lib/local-bridge";
import { useJobDrawer } from "@/lib/job-drawer";
import { Section } from "@/components/Section";

export const Route = createFileRoute("/_authenticated/health")({
  head: () => ({
    meta: [
      { title: "Health — AgentHub" },
      {
        name: "description",
        content: "Self-test results for the machine: checks passed, warnings and failures.",
      },
      { property: "og:title", content: "Health — AgentHub" },
      {
        property: "og:description",
        content: "Self-test results for the machine: checks passed, warnings and failures.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: () => (
    <Page title="Health" footer="Health · self-test read live from the machine">
      <LocalOnly>
        <HealthPage />
      </LocalOnly>
    </Page>
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
    seconds?: number;
    duration?: number | string;
  } & Record<string, unknown>;
  rows?: CheckRow[];
  at?: string;
  seconds?: number;
  duration?: number | string;
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

function isWarning(state: string | undefined) {
  return (state ?? "").toLowerCase().startsWith("warn");
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

/** "4 minutes ago" reads faster than a timestamp for the one line at the top. */
function relative(value: string | undefined) {
  if (!value) return "never run";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  const seconds = Math.round((Date.now() - date.getTime()) / 1000);
  if (seconds < 60) return "just now";
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `${minutes} minute${minutes === 1 ? "" : "s"} ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 48) return `${hours} hour${hours === 1 ? "" : "s"} ago`;
  return `${Math.round(hours / 24)} days ago`;
}

function durationOf(data: SelfTest | null) {
  const raw = data?.summary?.seconds ?? data?.summary?.duration ?? data?.seconds ?? data?.duration;
  if (raw == null) return null;
  const parsed = Number(raw);
  if (!Number.isFinite(parsed)) return String(raw);
  return `${parsed < 10 ? parsed.toFixed(1) : Math.round(parsed)}s`;
}

function CheckDetail({ row }: { row: CheckRow }) {
  return (
    <>
      {row.detail && (
        <p
          data-measure="health-detail"
          className="w-full font-mono text-[11px] leading-relaxed text-muted-foreground"
        >
          {row.detail}
        </p>
      )}
      {row.fix ? (
        <pre className="mt-2 whitespace-pre-wrap break-words border border-rule bg-panel2 p-3 font-mono text-[11px] leading-relaxed text-muted-foreground">
          {row.fix}
        </pre>
      ) : (
        !row.detail && <p className="font-mono text-[11px] text-faint">Nothing further recorded.</p>
      )}
    </>
  );
}

function CheckRowItem({ row, defaultOpen }: { row: CheckRow; defaultOpen: boolean }) {
  return (
    <li className="border-b border-rule last:border-b-0">
      <Disclosure
        tone="quiet"
        defaultOpen={defaultOpen}
        summary={
          <span className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
            <span className="min-w-0 flex-1 text-[13px] text-paper">{row.name ?? "—"}</span>
            {row.group ? (
              <span className="shrink-0 font-mono text-[10px] uppercase tracking-[0.27em] text-faint">
                {row.group}
              </span>
            ) : null}
            <span
              className={`shrink-0 border px-2 py-0.5 font-mono text-[10px] uppercase tracking-[0.27em] ${stateTone(row.state)}`}
            >
              {row.state ?? "—"}
            </span>
          </span>
        }
      >
        <CheckDetail row={row} />
      </Disclosure>
    </li>
  );
}

function HealthPage() {
  const local = useLocal();
  const { runJob } = useJobDrawer();
  const [data, setData] = useState<SelfTest | null>(null);
  const [loading, setLoading] = useState(true);

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
  const passed = Number(
    summary.passed ??
      rows.filter((row) => (row.state ?? "").toLowerCase().startsWith("pass") || (row.state ?? "").toLowerCase() === "ok")
        .length,
  );
  const warnings = Number(summary.warnings ?? rows.filter((row) => isWarning(row.state)).length);
  const failed = Number(summary.failed ?? rows.filter((row) => isFailed(row.state)).length);
  const at = (summary.at as string | undefined) ?? data?.at;
  const duration = durationOf(data);

  const worst = failed > 0 ? "text-risk" : warnings > 0 ? "text-watch" : "text-ok";

  const attention = rows.filter((row) => isFailed(row.state) || isWarning(row.state));

  const groupOrder = ["foundation", "services", "models", "memory", "pipeline", "safety", "schedule", "hygiene"];
  const groups = groupOrder
    .map((group) => ({ group, rows: rows.filter((row) => (row.group ?? "").toLowerCase() === group) }))
    .filter((entry) => entry.rows.length > 0);
  const ungrouped = rows.filter((row) => !groupOrder.includes((row.group ?? "").toLowerCase()));
  if (ungrouped.length > 0) groups.push({ group: "other", rows: ungrouped });

  return (
    <div className="space-y-6">
      {/* The answer, first. */}
      <section aria-label="Self-test summary">
        {loading ? (
          <Skeleton className="h-8 w-72" />
        ) : data === null ? (
          <Empty>No self-test has been recorded.</Empty>
        ) : (
          <>
            <p className={`font-serif text-[31px] leading-[1.1] tabular-nums ${worst}`}>
              {passed} passed · {warnings} warnings · {failed} failed
            </p>
            <p className="mt-2 font-mono text-[10px] text-faint">
              last run {relative(at)}
              {duration ? ` · ${duration}` : ""}
            </p>
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
            className="border border-copper px-3 py-1.5 font-mono text-[11px] uppercase tracking-[0.245em] text-copper"
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
            className="border border-rule px-3 py-1.5 font-mono text-[11px] uppercase tracking-[0.245em] text-muted-foreground hover:text-paper"
          >
            Repair to known-good
          </button>
        </div>
      </section>

      {/* Only what is wrong. A green run shows nothing here. */}
      {attention.length > 0 && (
        <Section title="Needs attention" note={`${failed} failed · ${warnings} warnings`}>
          <Panel title={`${attention.length} checks`}>
            <ul>
              {attention.map((row, index) => (
                <CheckRowItem key={`attention-${row.group}-${row.name}-${index}`} row={row} defaultOpen />
              ))}
            </ul>
          </Panel>
        </Section>
      )}

      <Section title="Cascade">
        <CascadePanel />
      </Section>

      <Section title="Checks" note={`as of ${stamp(at)}`}>
        {loading ? (
          <div className="space-y-2">
            {Array.from({ length: 8 }).map((_, index) => (
              <Skeleton key={index} className="h-4 w-full" />
            ))}
          </div>
        ) : rows.length === 0 ? (
          <Empty>No checks reported.</Empty>
        ) : (
          <div className="border border-rule bg-panel px-5">
            {groups.map(({ group, rows: groupRows }) => (
              <Disclosure
                key={group}
                summary={
                  <span className="flex flex-wrap items-baseline gap-x-3">
                    <span className="font-mono text-[11px] uppercase tracking-[0.245em] text-muted-foreground">
                      {group}
                    </span>
                    <span className="font-mono text-[10px] tabular-nums text-faint">
                      {groupRows.length} checks
                    </span>
                  </span>
                }
              >
                <ul>
                  {groupRows.map((row, index) => (
                    <CheckRowItem key={`${group}-${row.name}-${index}`} row={row} defaultOpen={false} />
                  ))}
                </ul>
              </Disclosure>
            ))}
          </div>
        )}
      </Section>
    </div>
  );
}
