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

  const groupOrder = ["foundation", "services", "models", "memory", "pipeline", "safety", "schedule", "hygiene"];
  const groups = groupOrder
    .map((group) => ({ group, rows: rows.filter((row) => (row.group ?? "").toLowerCase() === group) }))
    .filter((entry) => entry.rows.length > 0);
  const ungrouped = rows.filter((row) => !groupOrder.includes((row.group ?? "").toLowerCase()));
  if (ungrouped.length > 0) groups.push({ group: "other", rows: ungrouped });

  return (
    <div className="space-y-4">
      <Section title="Self-test">
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
      </Panel>
      </Section>

      {loading ? (
        <Panel title={`Checks · as of ${stamp(at)}`}>
          <div className="space-y-2">
            {Array.from({ length: 8 }).map((_, index) => (
              <Skeleton key={index} className="h-4 w-full" />
            ))}
          </div>
        </Panel>
      ) : rows.length === 0 ? (
        <Panel title={`Checks · as of ${stamp(at)}`}>
          <Empty>No checks reported.</Empty>
        </Panel>
      ) : (
        groups.map(({ group, rows: groupRows }) => (
          <Section key={group} title={group} note={`as of ${stamp(at)}`}>
            <Panel title={`${groupRows.length} checks`}>
              <ul>
                {groupRows.map((row, index) => (
                  <li key={`${row.group}-${row.name}-${index}`} className="border-b border-rule last:border-b-0">
                    <Disclosure
                      tone="quiet"
                      summary={
                        <span className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
                          <span className="min-w-0 flex-1 text-[13px] text-paper">{row.name ?? "—"}</span>
                          <span
                            className={`shrink-0 border px-2 py-0.5 font-mono text-[10px] uppercase tracking-[0.27em] ${stateTone(row.state)}`}
                          >
                            {row.state ?? "—"}
                          </span>
                        </span>
                      }
                      defaultOpen={isFailed(row.state)}
                    >
                      {row.detail && (
                        <p data-measure="health-detail" className="w-full font-mono text-[11px] leading-relaxed text-muted-foreground">
                          {row.detail}
                        </p>
                      )}
                      {row.fix ? (
                        <pre className="mt-2 whitespace-pre-wrap break-words border border-rule bg-panel2 p-3 font-mono text-[11px] leading-relaxed text-muted-foreground">
                          {row.fix}
                        </pre>
                      ) : (
                        !row.detail && (
                          <p className="font-mono text-[11px] text-faint">Nothing further recorded.</p>
                        )
                      )}
                    </Disclosure>
                  </li>
                ))}
              </ul>
            </Panel>
          </Section>
        ))
      )}

      <LocalOnly>
        <Section title="Cascade">
          <CascadePanel />
        </Section>
      </LocalOnly>
    </div>
  );
}
