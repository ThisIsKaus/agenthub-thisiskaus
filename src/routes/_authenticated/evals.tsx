import { createFileRoute } from "@tanstack/react-router";
import { useCallback, useEffect, useRef, useState } from "react";
import { Panel } from "@/components/AppShell";
import { Empty, Figure, Skeleton } from "@/components/data";
import { LocalOnly } from "@/components/LocalOnly";
import { isRefusal, useLocal } from "@/lib/local-bridge";

export const Route = createFileRoute("/_authenticated/evals")({
  head: () => ({
    meta: [
      { title: "Evals — AgentHub Remote" },
      {
        name: "description",
        content: "Golden eval items, scoring history and triage scoring runs.",
      },
      { property: "og:title", content: "Evals — AgentHub Remote" },
      {
        property: "og:description",
        content: "Golden eval items, scoring history and triage scoring runs.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: () => (
    <LocalOnly>
      <EvalsPage />
    </LocalOnly>
  ),
});

type Scores = {
  class?: number;
  cls?: number;
  entity?: number;
  sensitivity?: number;
  injection?: number;
};
type EvalResult = { date?: string; model?: string; scores?: Scores };
type EvalsData = { results?: EvalResult[]; set_size?: number; real_items?: number };
type Job = { out?: string; running?: boolean };

function pct(value: number | undefined) {
  if (value == null) return "—";
  const percent = value <= 1 ? value * 100 : value;
  return `${percent.toFixed(0)}%`;
}

function isBelowFull(value: number | undefined) {
  if (value == null) return false;
  const percent = value <= 1 ? value * 100 : value;
  return percent < 100;
}

function EvalsPage() {
  const local = useLocal();
  const [data, setData] = useState<EvalsData | null>(null);
  const [loading, setLoading] = useState(true);
  const [running, setRunning] = useState(false);
  const [output, setOutput] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const poll = useRef<number | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      setData(await local.get<EvalsData>("/api/evals"));
    } catch {
      setData(null);
    } finally {
      setLoading(false);
    }
  }, [local]);

  useEffect(() => {
    void load();
    return () => {
      if (poll.current) window.clearInterval(poll.current);
    };
  }, [load]);

  async function score() {
    setRunning(true);
    setOutput("");
    setNote(null);
    try {
      const started = await local.post<{ job: string }>("/api/run", { key: "eval" });
      poll.current = window.setInterval(async () => {
        try {
          const job = await local.get<Job>("/api/job", { id: started.job });
          setOutput(job.out ?? "");
          if (!job.running) {
            if (poll.current) window.clearInterval(poll.current);
            poll.current = null;
            setRunning(false);
            await load();
          }
        } catch {
          if (poll.current) window.clearInterval(poll.current);
          poll.current = null;
          setRunning(false);
        }
      }, 900);
    } catch (error) {
      setRunning(false);
      setNote(
        isRefusal(error) ? error.message || "denied at the approval dialog" : "the machine did not start the score",
      );
    }
  }

  const results = data?.results ?? [];
  const anyBelow = results.some((row) => isBelowFull(row.scores?.injection));

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 gap-4">
        <Figure label="Golden items" value={loading ? "—" : (data?.set_size ?? "—")} />
        <Figure
          label="From real corrections"
          value={loading ? "—" : (data?.real_items ?? "—")}
          tone="copper"
        />
      </div>

      <Panel title="Results">
        {loading ? (
          <div className="space-y-2">
            {Array.from({ length: 4 }).map((_, index) => (
              <Skeleton key={index} className="h-4 w-full" />
            ))}
          </div>
        ) : results.length === 0 ? (
          <Empty>No scoring runs on record.</Empty>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left">
              <thead>
                <tr className="border-b border-rule font-mono text-[10px] uppercase tracking-[0.14em] text-faint">
                  <th className="py-1.5 font-normal">Date</th>
                  <th className="py-1.5 font-normal">Model</th>
                  <th className="py-1.5 text-right font-normal">Class</th>
                  <th className="py-1.5 text-right font-normal">Entity</th>
                  <th className="py-1.5 text-right font-normal">Sens.</th>
                  <th className="py-1.5 text-right font-normal">Inj.</th>
                </tr>
              </thead>
              <tbody>
                {results.map((row, index) => {
                  const injection = row.scores?.injection;
                  return (
                    <tr key={`${row.date}-${index}`} className="border-b border-rule last:border-b-0">
                      <td className="py-2 pr-2 font-mono text-[11px] text-muted-foreground">
                        {row.date ?? "—"}
                      </td>
                      <td className="break-all py-2 pr-2 font-mono text-[11px] text-paper">
                        {row.model ?? "—"}
                      </td>
                      <td className="py-2 text-right font-mono text-[11px] tabular-nums text-paper">
                        {pct(row.scores?.class ?? row.scores?.cls)}
                      </td>
                      <td className="py-2 text-right font-mono text-[11px] tabular-nums text-paper">
                        {pct(row.scores?.entity)}
                      </td>
                      <td className="py-2 text-right font-mono text-[11px] tabular-nums text-paper">
                        {pct(row.scores?.sensitivity)}
                      </td>
                      <td
                        className={`py-2 text-right font-mono text-[11px] tabular-nums ${
                          isBelowFull(injection) ? "text-risk" : "text-paper"
                        }`}
                      >
                        {pct(injection)}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
            {anyBelow && (
              <p className="mt-2 font-mono text-[10px] text-risk">
                must be 100% to be eligible as default
              </p>
            )}
          </div>
        )}
      </Panel>

      <Panel title="Score">
        <button
          type="button"
          disabled={running}
          onClick={() => void score()}
          className="border border-copper px-3 py-1.5 font-mono text-[11px] uppercase tracking-[0.12em] text-copper disabled:opacity-50"
        >
          {running ? "Scoring…" : "Score triage"}
        </button>
        {output !== null && (
          <pre className="mt-3 max-h-[40vh] overflow-y-auto whitespace-pre-wrap break-words border border-rule bg-panel2 p-3 font-mono text-[11px] leading-relaxed text-muted-foreground">
            {output || "waiting for output…"}
          </pre>
        )}
        {note && <p className="mt-2 font-mono text-[10px] text-faint">{note}</p>}
      </Panel>
    </div>
  );
}
