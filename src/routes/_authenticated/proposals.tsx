import { createFileRoute } from "@tanstack/react-router";
import { Page } from "@/components/Page";
import { useCallback, useEffect, useMemo, useState } from "react";
import { Panel } from "@/components/AppShell";
import { ChevronDown } from "lucide-react";
import { Section } from "@/components/Section";
import { Disclosure } from "@/components/Disclosure";
import { Empty, Skeleton, StatusPill, formatStamp } from "@/components/data";
import { LocalOnly } from "@/components/LocalOnly";
import { Field } from "@/components/Field";

import { isRefusal, useLocal } from "@/lib/local-bridge";
import { useJobDrawer } from "@/lib/job-drawer";
import { relativeTime } from "@/lib/captures";


export const Route = createFileRoute("/_authenticated/proposals")({
  head: () => ({
    meta: [
      { title: "Proposals — AgentHub" },
      {
        name: "description",
        content: "Ranked queue of changes the system proposes to itself, with evidence first.",
      },
      { property: "og:title", content: "Proposals — AgentHub" },
      {
        property: "og:description",
        content: "Ranked queue of changes the system proposes to itself, with evidence first.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: () => (
    <Page title="Proposals" footer="Proposals · read and acted on over loopback">
      <LocalOnly>
        <ProposalsPage />
      </LocalOnly>
    </Page>
  ),
});

type Proposal = {
  id: string;
  title?: string;
  why?: string;
  change?: string;
  files?: string[];
  category?: string;
  impact?: string | number;
  effort?: string | number;
  confidence?: string | number;
  score?: number;
  status?: string;
  created?: string;
  note?: string;
  reason?: string;
  job?: string | number | null;
  job_running?: boolean;
  job_result?: string | null;
};

type ProposalsData = {
  proposals?: Proposal[];
  open?: Proposal[];
  counts?: Record<string, unknown>;
  last_diagnosed?: string | null;
  stats?: Record<string, unknown> & { last_diagnosed?: string; diagnosed?: string };
};

/** The statuses the queue speaks in, in the order they are worth reading. */
const STATUS_ORDER = ["open", "building", "built", "build failed", "rejected", "deferred"];



const PROTECTED: { match: (path: string) => boolean; control: string }[] = [
  { match: (p) => p === "machine/scripts/approve.sh", control: "the approval dialog" },
  { match: (p) => p === "machine/console/console.py", control: "the local API" },
  { match: (p) => p.startsWith("machine/canon/"), control: "a canon policy" },
  { match: (p) => p.startsWith("machine/launchd/"), control: "a scheduled job" },
  { match: (p) => p === "machine/scripts/selftest.py", control: "the test suite" },
];

function protectedControls(files: string[]) {
  const found: string[] = [];
  for (const file of files) {
    const path = file.replace(/^\.?\//, "");
    for (const rule of PROTECTED) {
      if (rule.match(path) && !found.includes(rule.control)) found.push(rule.control);
    }
  }
  return found;
}

function figure(value: string | number | undefined) {
  if (value === undefined || value === null || value === "") return "—";
  if (typeof value === "number") return value <= 1 ? `${Math.round(value * 100)}%` : String(value);
  return value;
}

function ProposalsPage() {
  const local = useLocal();
  const { runJob, trackJob } = useJobDrawer();
  const [data, setData] = useState<ProposalsData | null>(null);
  const [loading, setLoading] = useState(true);
  const [openId, setOpenId] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      setData(await local.get<ProposalsData>("/api/proposals"));
    } catch {
      setData(null);
    } finally {
      setLoading(false);
    }
  }, [local]);

  useEffect(() => {
    void load();
  }, [load]);

  const all = useMemo(
    () => [...(data?.proposals ?? [])].sort((a, b) => (b.score ?? 0) - (a.score ?? 0)),
    [data],
  );

  /** The queue shows only what still needs a decision. */
  const queue = useMemo(() => {
    const reported = data?.open;
    const rows = Array.isArray(reported)
      ? [...reported]
      : all.filter((proposal) => (proposal.status ?? "open").toLowerCase() === "open");
    return rows.sort((a, b) => (b.score ?? 0) - (a.score ?? 0));
  }, [data, all]);

  const decided = useMemo(() => {
    const openIds = new Set(queue.map((proposal) => proposal.id));
    return all.filter((proposal) => !openIds.has(proposal.id));
  }, [all, queue]);

  /**
   * One figure per status the machine reports, each labelled by its own status.
   * Never a single total: "approved 3" for three open proposals states the opposite
   * of the truth.
   */
  const counts = useMemo(() => {
    const map = new Map<string, number>();
    const reported = data?.counts;
    if (reported && typeof reported === "object") {
      for (const [status, value] of Object.entries(reported)) {
        const parsed = Number(value);
        if (Number.isFinite(parsed)) map.set(status, parsed);
      }
    }
    if (map.size === 0) {
      for (const proposal of all) {
        const key = proposal.status ?? "open";
        map.set(key, (map.get(key) ?? 0) + 1);
      }
    }
    return [...map.entries()].sort((a, b) => {
      const ai = STATUS_ORDER.indexOf(a[0]);
      const bi = STATUS_ORDER.indexOf(b[0]);
      return (ai === -1 ? 99 : ai) - (bi === -1 ? 99 : bi);
    });
  }, [data, all]);

  const lastDiagnosed =
    data?.last_diagnosed ?? data?.stats?.last_diagnosed ?? data?.stats?.diagnosed ?? null;

  /** While a build is running the page refreshes itself; the user should not have to. */
  const building = decided.some((proposal) => proposal.job_running === true);
  useEffect(() => {
    if (!building) return;
    const timer = window.setInterval(() => void load(), 5000);
    return () => window.clearInterval(timer);
  }, [building, load]);

  async function act(id: string, action: string, actionNote: string) {
    setNote(null);
    try {
      const result = await local.post<{
        ok?: boolean;
        status?: string;
        job?: string | number;
        label?: string;
      }>("/api/proposals/act", { id, action, note: actionNote });
      setOpenId(null);
      if (result?.job) {
        trackJob(String(result.job), "cascade", result.label ?? `build ${id}`, () => void load());
      }
      await load();
      if (action === "approve") {
        setNote(
          result?.job
            ? `Approved — building as job ${result.job}. It is in Decided below and streaming into the drawer.`
            : "Approved. It has moved to Decided below.",
        );
      }
    } catch (error) {
      setNote(
        isRefusal(error)
          ? error.message || "denied at the approval dialog"
          : "the machine did not record that action",
      );
    }
  }

  return (
    <div className="space-y-6">
      <Section title="Queue">
      <header className="flex flex-wrap items-end justify-between gap-4">
        <div className="flex flex-wrap items-center gap-2">
          {counts.map(([status, n]) => (
            <StatusPill key={status} label={status} value={n} />
          ))}
          <StatusPill
            label="last diagnosed"
            tone={lastDiagnosed ? "paper" : "watch"}
            value={
              lastDiagnosed ? (
                <span title={String(lastDiagnosed)}>{relativeTime(String(lastDiagnosed))}</span>
              ) : (
                "never"
              )
            }
          />

          <button
            onClick={() => void runJob("diagnose", "Run diagnosis", () => void load())}
            className="border border-copper/60 px-3 py-1.5 font-mono text-[11px] uppercase tracking-[0.245em] text-copper transition-colors hover:bg-copper/10"
          >
            Run diagnosis
          </button>
        </div>
      </header>

      {note && <p className="text-[13px] text-muted-foreground">{note}</p>}

      {loading ? (
        <div className="space-y-2">
          <Skeleton className="h-14 w-full" />
          <Skeleton className="h-14 w-full" />
        </div>
      ) : queue.length === 0 ? (
        <Panel title="Queue">
          <Empty>Nothing awaiting a decision. The diagnostician runs nightly.</Empty>
        </Panel>
      ) : (
        <div className="border border-rule bg-panel">
          {queue.map((proposal, index) => (
            <ProposalRow
              key={proposal.id}
              proposal={proposal}
              hint={index === 0}
              open={openId === proposal.id}
              onToggle={() => setOpenId(openId === proposal.id ? null : proposal.id)}
              onAct={act}
            />
          ))}
        </div>
      )}
      </Section>

      {!loading && decided.length > 0 && (
        <Section title="Decided">
          <div className="border border-rule bg-panel px-4">
            <Disclosure
              summary={
                <span className="font-mono text-[11px] uppercase tracking-[0.245em] text-muted-foreground">
                  {decided.length} acted on · what happened next
                </span>
              }
            >
              <div className="space-y-4">
                {decided.map((proposal) => (
                  <DecidedRow key={proposal.id} proposal={proposal} />
                ))}
              </div>
            </Disclosure>
          </div>
        </Section>
      )}
    </div>
  );
}

function Elapsed({ since }: { since?: string }) {
  const [, tick] = useState(0);
  useEffect(() => {
    const timer = window.setInterval(() => tick((value) => value + 1), 1000);
    return () => window.clearInterval(timer);
  }, []);
  const start = since ? new Date(since).getTime() : NaN;
  if (!Number.isFinite(start)) return <>running</>;
  const seconds = Math.max(0, Math.round((Date.now() - start) / 1000));
  return <>{`${Math.floor(seconds / 60)}m ${String(seconds % 60).padStart(2, "0")}s elapsed`}</>;
}

function DecidedRow({ proposal }: { proposal: Proposal }) {
  const status = (proposal.status ?? "").toLowerCase();
  const tone =
    status === "build failed" ? "text-risk" : status === "built" ? "text-ok" : "text-muted-foreground";

  return (
    <article className="space-y-1.5">
      <p className="text-[14px] text-paper">{proposal.title ?? proposal.id}</p>
      <p className={`font-mono text-[10px] uppercase tracking-[0.27em] ${tone}`}>
        {proposal.status ?? "acted"}
        {proposal.job ? ` · job ${proposal.job}` : ""}
        {proposal.job_running ? (
          <>
            {" · "}
            <Elapsed since={proposal.created} />
          </>
        ) : null}
      </p>

      {status === "building" && (
        <p className="text-[12px] leading-relaxed text-faint">
          Building. Its output is streaming into the job drawer.
        </p>
      )}
      {status === "built" && (
        <p className="text-[12px] leading-relaxed text-muted-foreground">
          built — review the branch under Build before it merges
        </p>
      )}
      {status === "build failed" && proposal.job_result && (
        <pre className="max-w-[72ch] whitespace-pre-wrap break-words border border-rule bg-panel2 px-3 py-2 font-mono text-[11px] leading-relaxed text-muted-foreground">
          {proposal.job_result.slice(-400)}
        </pre>
      )}
      {status === "rejected" && (
        <p className="max-w-[72ch] text-[13px] leading-relaxed text-paper">
          {proposal.reason?.trim() || proposal.note?.trim() || "no reason recorded"}
        </p>
      )}
      {status === "deferred" && (proposal.note?.trim() || proposal.reason?.trim()) && (
        <p className="max-w-[72ch] text-[13px] leading-relaxed text-muted-foreground">
          {proposal.note?.trim() || proposal.reason?.trim()}
        </p>
      )}
    </article>
  );
}


function ProposalRow({
  proposal,
  hint = false,
  open,
  onToggle,
  onAct,
}: {
  proposal: Proposal;
  hint?: boolean;
  open: boolean;
  onToggle: () => void;
  onAct: (id: string, action: string, note: string) => Promise<void>;
}) {
  const files = proposal.files ?? [];
  const controls = protectedControls(files);
  const [acknowledged, setAcknowledged] = useState(false);
  const [approveNote, setApproveNote] = useState("");
  const [showApproveNote, setShowApproveNote] = useState(false);
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);

  const approveBlocked = controls.length > 0 && !acknowledged;

  async function run(action: string, value: string) {
    setBusy(true);
    await onAct(proposal.id, action, value);
    setBusy(false);
  }

  return (
    <article className="border-t border-rule first:border-t-0">
      <button
        onClick={onToggle}
        className="flex w-full items-center justify-between gap-4 px-4 py-3 text-left transition-colors hover:bg-panel2"
        aria-expanded={open}
      >
        <span className="min-w-0">
          <span className="block truncate text-[14px] text-paper">{proposal.title ?? proposal.id}</span>
          <span className="mt-1 flex flex-wrap items-center gap-2 font-mono text-[10px] uppercase tracking-[0.27em] text-faint">
            {proposal.category && (
              <span className="border border-rule px-1.5 py-0.5 text-muted-foreground">
                {proposal.category}
              </span>
            )}
            <span>{files.length} file{files.length === 1 ? "" : "s"}</span>
            {controls.length > 0 && <span className="text-watch">control</span>}
          </span>
        </span>
        <span className="flex shrink-0 items-center gap-3">
          <span className="font-mono text-lg tabular-nums text-copper" title="score">
            {typeof proposal.score === "number" ? proposal.score.toFixed(2) : (proposal.score ?? "—")}
          </span>
          <ChevronDown
            aria-hidden
            className={`h-4 w-4 text-faint transition-transform ${open ? "rotate-180" : ""}`}
          />
        </span>

      </button>

      {hint && !open && (
        <p className="px-4 pb-3 text-[12px] leading-relaxed text-faint">
          Expand to see the evidence, the change and what it cost.
        </p>
      )}

      {open && (
        <div className="space-y-5 border-t border-rule px-4 py-5">
          {controls.length > 0 && (
            <div className="border border-watch/60 bg-watch/5 px-3 py-2">
              <p className="font-mono text-[11px] leading-relaxed text-watch">
                {controls.map((control) => `This would change ${control}`).join(" · ")}
              </p>
            </div>
          )}

          <section>
            <h3 className="font-mono text-[10px] uppercase tracking-[0.27em] text-faint">Why</h3>
            <pre className="mt-2 max-w-[72ch] whitespace-pre-wrap break-words font-mono text-[11px] leading-relaxed text-muted-foreground">
              {proposal.why?.trim() || "—"}
            </pre>
          </section>

          <section>
            <h3 className="font-mono text-[10px] uppercase tracking-[0.27em] text-faint">What</h3>
            <p className="mt-2 max-w-[72ch] text-[13px] leading-relaxed text-paper">
              {proposal.change?.trim() || "—"}
            </p>
            {files.length > 0 && (
              <ul className="mt-3 space-y-1">
                {files.map((file) => (
                  <li key={file} className="font-mono text-[11px] break-all text-muted-foreground">
                    {file}
                  </li>
                ))}
              </ul>
            )}
          </section>

          <section>
            <h3 className="font-mono text-[10px] uppercase tracking-[0.27em] text-faint">Cost</h3>
            <div className="mt-2 grid grid-cols-3 gap-2">
              {[
                ["impact", proposal.impact],
                ["effort", proposal.effort],
                ["confidence", proposal.confidence],
              ].map(([label, value]) => (
                <Field
                  key={String(label)}
                  label={label as string}
                  value={figure(value as string | number | undefined)}
                  className="px-3 py-3 sm:px-3 sm:py-3"
                />
              ))}
            </div>
          </section>


          {controls.length > 0 && (
            <label className="flex items-start gap-2 text-[13px] text-muted-foreground">
              <input
                type="checkbox"
                checked={acknowledged}
                onChange={(event) => setAcknowledged(event.target.checked)}
                className="mt-1 accent-[var(--accent)]"
              />
              I understand this alters a control
            </label>
          )}

          <div className="space-y-3 border-t border-rule pt-4">
            <div className="flex flex-wrap gap-2">
              <button
                disabled={busy || approveBlocked}
                onClick={() => void run("approve", "")}
                className="border border-copper/60 px-3 py-1.5 font-mono text-[11px] uppercase tracking-[0.245em] text-copper transition-colors hover:bg-copper/10 disabled:opacity-40"
              >
                Approve
              </button>
              <button
                disabled={busy}
                onClick={() => setShowApproveNote((value) => !value)}
                className="border border-rule px-3 py-1.5 font-mono text-[11px] uppercase tracking-[0.245em] text-muted-foreground transition-colors hover:text-paper disabled:opacity-40"
              >
                Approve with note
              </button>
              <button
                disabled={busy}
                onClick={() => void run("defer", approveNote.trim())}
                className="border border-rule px-3 py-1.5 font-mono text-[11px] uppercase tracking-[0.245em] text-muted-foreground transition-colors hover:text-paper disabled:opacity-40"
              >
                Defer
              </button>
            </div>

            {showApproveNote && (
              <div className="space-y-2">
                <textarea
                  value={approveNote}
                  onChange={(event) => setApproveNote(event.target.value)}
                  rows={3}
                  placeholder="Note saved with the proposal"
                  className="w-full border border-rule bg-panel2 px-3 py-2 font-mono text-[12px] leading-relaxed text-paper outline-none focus:border-copper"
                />
                <button
                  disabled={busy || approveBlocked || !approveNote.trim()}
                  onClick={() => void run("approve", approveNote.trim())}
                  className="border border-copper/60 px-3 py-1.5 font-mono text-[11px] uppercase tracking-[0.245em] text-copper transition-colors hover:bg-copper/10 disabled:opacity-40"
                >
                  Approve with this note
                </button>
              </div>
            )}

            <div className="space-y-2">
              <textarea
                value={reason}
                onChange={(event) => setReason(event.target.value)}
                rows={2}
                placeholder="Reason for rejection — required, and how the system stops re-proposing"
                className="w-full border border-rule bg-panel2 px-3 py-2 font-mono text-[12px] leading-relaxed text-paper outline-none focus:border-copper"
              />
              <button
                disabled={busy || !reason.trim()}
                onClick={() => void run("reject", reason.trim())}
                className="border border-risk/60 px-3 py-1.5 font-mono text-[11px] uppercase tracking-[0.245em] text-risk transition-colors hover:bg-risk/10 disabled:opacity-40"
              >
                Reject
              </button>
            </div>
          </div>

          <p className="font-mono text-[10px] text-faint">
            {proposal.status ?? "open"} · created {formatStamp(proposal.created)}
          </p>
        </div>
      )}
    </article>
  );
}
