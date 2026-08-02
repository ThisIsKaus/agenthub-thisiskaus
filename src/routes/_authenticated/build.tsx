import { createFileRoute } from "@tanstack/react-router";
import { Page } from "@/components/Page";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Panel } from "@/components/AppShell";
import { Empty, Skeleton, formatStamp } from "@/components/data";
import { LocalOnly } from "@/components/LocalOnly";
import { isRefusal, useLocal } from "@/lib/local-bridge";
import { useJobDrawer } from "@/lib/job-drawer";

export const Route = createFileRoute("/_authenticated/build")({
  head: () => ({
    meta: [
      { title: "Build — AgentHub" },
      {
        name: "description",
        content: "State an intent and the cascade implements it, verified before review.",
      },
      { property: "og:title", content: "Build — AgentHub" },
      {
        property: "og:description",
        content: "State an intent and the cascade implements it, verified before review.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: () => (
    <Page title="Build" subtitle="State an intent; the cascade implements it and verifies before you see it." footer="Build · cascade runs on the machine">
      <LocalOnly>
        <BuildPage />
      </LocalOnly>
    </Page>
  ),
});

const CASCADE_LINES = [
  "Tier 3 · local 35B · free · most changes",
  "Tier 4 · Claude Code · security-sensitive, multi-file, or after a local attempt fails",
  "Every attempt is verified against 96 checks before you see it.",
];

type StageKey = "routing" | "attempt" | "verification" | "escalation" | "result";
type StageState = "waiting" | "active" | "done" | "fail";
type Stage = { key: StageKey; label: string; state: StageState; detail: string };

const STAGE_LABELS: Record<StageKey, string> = {
  routing: "routing",
  attempt: "attempt",
  verification: "verification",
  escalation: "escalation",
  result: "result",
};

function matchLines(lines: string[], patterns: RegExp[]) {
  return lines.filter((line) => patterns.some((pattern) => pattern.test(line)));
}

/** The streaming job output is the only signal; parse it into the five cascade stages. */
function parseCascade(out: string, running: boolean, elapsed: number): Stage[] {
  const lines = out.split("\n").map((line) => line.trim()).filter(Boolean);

  const routing = matchLines(lines, [/rout/i, /\btier\s*\d.*(chosen|selected|because)/i]);
  const attempt = matchLines(lines, [/attempt/i, /executor/i, /claude code/i, /local 35b/i]);
  const verification = matchLines(lines, [/verif/i, /\b\d+\s*\/\s*96\b/i, /checks?\b/i]);
  const escalation = matchLines(lines, [/escalat/i, /falling back/i, /fell back/i]);
  const result = matchLines(lines, [
    /resolved at tier/i,
    /no tier could/i,
    /^result[: ]/i,
    /proposal/i,
  ]);

  const failed = /no tier could|failed|error/i.test(result.join(" ") || "");

  const order: { key: StageKey; hits: string[] }[] = [
    { key: "routing", hits: routing },
    { key: "attempt", hits: attempt },
    { key: "verification", hits: verification },
    { key: "escalation", hits: escalation },
    { key: "result", hits: result },
  ];

  const lastWithHits = order.reduce(
    (last, stage, index) => (stage.hits.length ? index : last),
    -1,
  );

  return order
    .filter((stage) => stage.key !== "escalation" || stage.hits.length > 0)
    .map((stage) => {
      const index = order.findIndex((entry) => entry.key === stage.key);
      let state: StageState = "waiting";
      if (stage.hits.length) state = "done";
      if (running && index === lastWithHits + 1) state = "active";
      if (running && index === lastWithHits && stage.key !== "result") state = "active";
      if (stage.key === "result" && stage.hits.length && failed) state = "fail";

      let detail = stage.hits.slice(-3).join("\n");
      if (stage.key === "attempt" && running) {
        detail = `${detail}${detail ? "\n" : ""}${elapsed}s elapsed`;
      }
      if (!detail && state === "active") detail = "working…";
      return { key: stage.key, label: STAGE_LABELS[stage.key], state, detail };
    });
}

type CascadeRun = {
  intent?: string;
  tier?: string | number;
  duration?: string | number;
  outcome?: string;
  created?: string;
  at?: string;
};

function formatDuration(value: string | number | undefined) {
  if (value === undefined || value === null || value === "") return "—";
  if (typeof value === "number") return `${Math.round(value)}s`;
  return value;
}

function BuildPage() {
  const local = useLocal();
  const { trackJob, jobs } = useJobDrawer();
  const [intent, setIntent] = useState("");
  const [jobId, setJobId] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const [elapsed, setElapsed] = useState(0);
  const [history, setHistory] = useState<CascadeRun[] | null>(null);
  const [loadingHistory, setLoadingHistory] = useState(true);
  const textarea = useRef<HTMLTextAreaElement>(null);

  const loadHistory = useCallback(async () => {
    setLoadingHistory(true);
    try {
      const data = await local.get<{ runs?: CascadeRun[]; history?: CascadeRun[] }>(
        "/api/cascade/stats",
      );
      setHistory((data.runs ?? data.history ?? []).slice(0, 20));
    } catch {
      setHistory(null);
    } finally {
      setLoadingHistory(false);
    }
  }, [local]);

  useEffect(() => {
    void loadHistory();
  }, [loadHistory]);

  const job = jobs.find((entry) => entry.id === jobId) ?? null;
  const running = job?.running ?? false;

  useEffect(() => {
    if (!running) return;
    const timer = window.setInterval(() => setElapsed((value) => value + 1), 1000);
    return () => window.clearInterval(timer);
  }, [running]);

  const stages = useMemo(
    () => (job ? parseCascade(job.out, job.running, elapsed) : []),
    [job, elapsed],
  );

  const succeeded = job && !job.running && job.code === 0;

  async function submit() {
    const text = intent.trim();
    if (!text) return;
    setNote(null);
    try {
      const started = await local.post<{ job: string }>("/api/build", { intent: text });
      const id = String(started.job);
      setJobId(id);
      setElapsed(0);
      trackJob(id, "build", "Build", () => void loadHistory());
    } catch (error) {
      setNote(
        isRefusal(error)
          ? error.message || "denied at the approval dialog"
          : "the machine did not start the build",
      );
    }
  }

  return (
    <div className="space-y-6">
      <Panel title="Intent">
        <ul className="space-y-1">
          {CASCADE_LINES.map((line) => (
            <li key={line} className="font-mono text-[11px] leading-relaxed text-faint">
              {line}
            </li>
          ))}
        </ul>

        <textarea
          ref={textarea}
          value={intent}
          onChange={(event) => setIntent(event.target.value)}
          onKeyDown={(event) => {
            if ((event.metaKey || event.ctrlKey) && event.key === "Enter") {
              event.preventDefault();
              void submit();
            }
          }}
          rows={6}
          placeholder="Describe a change. Be specific about the outcome, not the implementation."
          className="mt-4 w-full border border-rule bg-panel2 px-3 py-3 text-[14px] leading-[1.75] text-paper outline-none placeholder:text-faint focus:border-copper"
        />

        <div className="mt-3 flex flex-wrap items-center gap-3">
          <button
            onClick={() => void submit()}
            disabled={!intent.trim() || running}
            className="border border-copper/60 px-3 py-1.5 font-mono text-[11px] uppercase tracking-[0.12em] text-copper transition-colors hover:bg-copper/10 disabled:opacity-40"
          >
            {running ? "Building…" : "Build"}
          </button>
          <span className="font-mono text-[10px] uppercase tracking-[0.12em] text-faint">
            ⌘/Ctrl + Enter
          </span>
          {running && (
            <span className="font-mono text-[10px] tabular-nums text-faint">{elapsed}s</span>
          )}
        </div>

        {note && <p className="mt-3 text-[13px] text-muted-foreground">{note}</p>}
      </Panel>

      {job && (
        <Panel title="Run">
          <ol className="space-y-0">
            {stages.map((stage) => (
              <li key={stage.key} className="flex gap-3 border-t border-rule py-3 first:border-t-0">
                <span
                  aria-hidden
                  className={`mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full ${
                    stage.state === "done"
                      ? "bg-ok"
                      : stage.state === "active"
                        ? "bg-copper"
                        : stage.state === "fail"
                          ? "bg-risk"
                          : "bg-faint/50"
                  }`}
                />
                <div className="min-w-0">
                  <div className="font-mono text-[10px] uppercase tracking-[0.16em] text-faint">
                    {stage.label}
                  </div>
                  <pre className="mt-1 max-w-[72ch] whitespace-pre-wrap break-words font-mono text-[11px] leading-relaxed text-muted-foreground">
                    {stage.detail || "—"}
                  </pre>
                </div>
              </li>
            ))}
          </ol>

          {succeeded && (
            <p className="mt-4 border-t border-rule pt-4 text-[13px] leading-relaxed text-paper">
              This is now a proposal. Review it under Proposals before it merges.
            </p>
          )}
        </Panel>
      )}

      <Panel title="History">
        {loadingHistory ? (
          <div className="space-y-2">
            <Skeleton className="h-6 w-full" />
            <Skeleton className="h-6 w-full" />
          </div>
        ) : !history || history.length === 0 ? (
          <Empty>No builds yet.</Empty>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full border-collapse text-left">
              <thead>
                <tr className="font-mono text-[10px] uppercase tracking-[0.14em] text-faint">
                  <th className="py-2 pr-4 font-normal">Intent</th>
                  <th className="py-2 pr-4 font-normal">Tier</th>
                  <th className="py-2 pr-4 font-normal">Duration</th>
                  <th className="py-2 pr-4 font-normal">Outcome</th>
                  <th className="py-2 font-normal">When</th>
                </tr>
              </thead>
              <tbody>
                {history.map((run, index) => (
                  <tr key={index} className="border-t border-rule align-top">
                    <td className="max-w-[36ch] py-2 pr-4 text-[13px] text-paper">
                      {run.intent ?? "—"}
                    </td>
                    <td className="py-2 pr-4 font-mono text-[11px] tabular-nums text-muted-foreground">
                      {run.tier ?? "—"}
                    </td>
                    <td className="py-2 pr-4 font-mono text-[11px] tabular-nums text-muted-foreground">
                      {formatDuration(run.duration)}
                    </td>
                    <td
                      className={`py-2 pr-4 font-mono text-[11px] ${
                        /fail|no tier|error/i.test(run.outcome ?? "")
                          ? "text-risk"
                          : "text-muted-foreground"
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
      </Panel>
    </div>
  );
}
