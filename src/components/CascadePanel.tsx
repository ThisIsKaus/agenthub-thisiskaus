import { useCallback, useEffect, useMemo, useState } from "react";
import { Panel } from "@/components/AppShell";
import { Empty, Skeleton, formatStamp } from "@/components/data";
import { useLocal } from "@/lib/local-bridge";

type CascadeRun = {
  intent?: string;
  tier?: string | number;
  duration?: string | number;
  seconds?: number;
  outcome?: string;
  verify?: string | boolean;
  first_pass?: boolean;
  created?: string;
  at?: string;
};

type CascadeStats = {
  by_tier?: Record<string, number> | { tier: string | number; count: number }[];
  mean_seconds?: number;
  runs?: CascadeRun[];
  verify_first_pass?: number;
  proposals?: { approved?: number; rejected?: number };
  approved?: number;
  rejected?: number;
};

function normaliseTiers(by_tier: CascadeStats["by_tier"]) {
  if (!by_tier) return [] as { tier: number; count: number }[];
  const entries = Array.isArray(by_tier)
    ? by_tier.map((entry) => [String(entry.tier), Number(entry.count)] as const)
    : Object.entries(by_tier).map(([tier, count]) => [tier, Number(count)] as const);
  return entries
    .map(([tier, count]) => ({ tier: Number(String(tier).replace(/[^\d]/g, "")) || 0, count }))
    .filter((entry) => entry.count > 0)
    .sort((a, b) => a.tier - b.tier);
}

function formatDuration(run: CascadeRun) {
  const value = run.duration ?? run.seconds;
  if (value === undefined || value === null || value === "") return "—";
  if (typeof value === "number") return `${Math.round(value)}s`;
  return String(value);
}

function isFailure(outcome: string | undefined) {
  return /fail|no tier|error|reject/i.test(outcome ?? "");
}

export function CascadePanel() {
  const local = useLocal();
  const [data, setData] = useState<CascadeStats | null>(null);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      setData(await local.get<CascadeStats>("/api/cascade/stats"));
    } catch {
      setData(null);
    } finally {
      setLoading(false);
    }
  }, [local]);

  useEffect(() => {
    void load();
  }, [load]);

  const runs = useMemo(() => (data?.runs ?? []).slice(0, 30), [data]);
  const tiers = useMemo(() => normaliseTiers(data?.by_tier), [data]);
  const total = tiers.reduce((sum, entry) => sum + entry.count, 0);
  const tier4 = tiers.filter((entry) => entry.tier >= 4).reduce((sum, e) => sum + e.count, 0);
  const localShare = total ? Math.round(((total - tier4) / total) * 100) : null;
  const escalationShare = total ? (tier4 / total) * 100 : 0;

  const verifyRate = useMemo(() => {
    if (typeof data?.verify_first_pass === "number") {
      const value = data.verify_first_pass;
      return Math.round(value <= 1 ? value * 100 : value);
    }
    const judged = runs.filter((run) => run.first_pass !== undefined || run.verify !== undefined);
    if (!judged.length) return null;
    const passed = judged.filter(
      (run) => run.first_pass === true || /pass|ok|true/i.test(String(run.verify ?? "")),
    ).length;
    return Math.round((passed / judged.length) * 100);
  }, [data, runs]);

  const approved = data?.proposals?.approved ?? data?.approved;
  const rejected = data?.proposals?.rejected ?? data?.rejected;

  return (
    <Panel title="Cascade">
      {loading ? (
        <div className="space-y-2">
          <Skeleton className="h-6 w-full" />
          <Skeleton className="h-4 w-48" />
        </div>
      ) : !data || total === 0 ? (
        <Empty>No cascade runs recorded.</Empty>
      ) : (
        <div className="space-y-4">
          <div>
            <div className="flex h-4 w-full overflow-hidden border border-rule">
              {tiers.map((entry) => (
                <div
                  key={entry.tier}
                  title={`Tier ${entry.tier} · ${entry.count}`}
                  style={{
                    width: `${(entry.count / total) * 100}%`,
                    backgroundColor: entry.tier >= 4 ? "#C8744A" : "#7FA88C",
                  }}
                />
              ))}
            </div>
            <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1">
              {tiers.map((entry) => (
                <span
                  key={entry.tier}
                  className="inline-flex items-center gap-1.5 font-mono text-[10px] tabular-nums text-muted-foreground"
                >
                  <span
                    aria-hidden
                    className="h-1.5 w-1.5"
                    style={{ backgroundColor: entry.tier >= 4 ? "#C8744A" : "#7FA88C" }}
                  />
                  tier {entry.tier} · {entry.count} · {Math.round((entry.count / total) * 100)}%
                </span>
              ))}
            </div>
          </div>

          {/* Cost and quality are one reading — never separated. */}
          <div className="border border-rule bg-panel2 px-4 py-4">
            <p className="font-mono text-[15px] tabular-nums text-paper">
              {localShare ?? "—"}% resolved locally at $0
            </p>
            <p className="mt-1 font-mono text-[15px] tabular-nums text-paper">
              verify pass rate {verifyRate ?? "—"}%
            </p>
            <div className="mt-3 grid grid-cols-2 gap-3 border-t border-rule pt-3 sm:grid-cols-3">
              <div>
                <div className="font-mono text-[10px] uppercase tracking-[0.27em] text-faint">
                  verify first attempt
                </div>
                <div className="mt-1 font-mono text-sm tabular-nums text-paper">
                  {verifyRate === null ? "—" : `${verifyRate}%`}
                </div>
              </div>
              <div>
                <div className="font-mono text-[10px] uppercase tracking-[0.27em] text-faint">
                  proposals approved
                </div>
                <div className="mt-1 font-mono text-sm tabular-nums text-ok">{approved ?? "—"}</div>
              </div>
              <div>
                <div className="font-mono text-[10px] uppercase tracking-[0.27em] text-faint">
                  proposals rejected
                </div>
                <div className="mt-1 font-mono text-sm tabular-nums text-risk">
                  {rejected ?? "—"}
                </div>
              </div>
            </div>
            {typeof data.mean_seconds === "number" && (
              <p className="mt-3 font-mono text-[10px] text-faint">
                mean run {Math.round(data.mean_seconds)}s
              </p>
            )}
          </div>

          {escalationShare > 40 && (
            <div className="border border-watch/60 bg-watch/5 px-3 py-2">
              <p className="font-mono text-[11px] leading-relaxed text-watch">
                Escalation above 40% — the cascade is costing more than it saves. Review the routing
                rules.
              </p>
            </div>
          )}

          {runs.length === 0 ? (
            <Empty>No runs recorded.</Empty>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full border-collapse text-left">
                <thead>
                  <tr className="font-mono text-[10px] uppercase tracking-[0.27em] text-faint">
                    <th className="py-2 pr-4 font-normal">Intent</th>
                    <th className="py-2 pr-4 font-normal">Tier</th>
                    <th className="py-2 pr-4 font-normal">Duration</th>
                    <th className="py-2 pr-4 font-normal">Outcome</th>
                    <th className="py-2 font-normal">When</th>
                  </tr>
                </thead>
                <tbody>
                  {runs.map((run, index) => (
                    <tr key={index} className="border-t border-rule align-top">
                      <td className="max-w-[36ch] py-2 pr-4 text-[13px] text-paper">
                        {run.intent ?? "—"}
                      </td>
                      <td className="py-2 pr-4 font-mono text-[11px] tabular-nums text-muted-foreground">
                        {run.tier ?? "—"}
                      </td>
                      <td className="py-2 pr-4 font-mono text-[11px] tabular-nums text-muted-foreground">
                        {formatDuration(run)}
                      </td>
                      <td
                        className={`py-2 pr-4 font-mono text-[11px] ${
                          isFailure(run.outcome) ? "text-risk" : "text-muted-foreground"
                        }`}
                      >
                        {run.outcome ?? "—"}
                      </td>
                      <td className="py-2 font-mono text-[11px] text-faint">
                        {formatStamp(run.created ?? run.at)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}
    </Panel>
  );
}
