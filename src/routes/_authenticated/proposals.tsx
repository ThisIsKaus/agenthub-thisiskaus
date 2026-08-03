import { createFileRoute } from "@tanstack/react-router";
import { Page } from "@/components/Page";
import { useCallback, useEffect, useMemo, useState } from "react";
import { Panel } from "@/components/AppShell";
import { Empty, Skeleton, StatusPill, formatStamp } from "@/components/data";
import { LocalOnly } from "@/components/LocalOnly";
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
    <Page title="Proposals" subtitle="Changes the machine suggests to itself. Nothing lands without your decision." footer="Proposals · read and acted on over loopback">
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
};

type ProposalsData = {
  proposals?: Proposal[];
  counts?: Record<string, unknown>;
  last_diagnosed?: string | null;
  stats?: Record<string, unknown> & { last_diagnosed?: string; diagnosed?: string };
};

/** The statuses the queue speaks in, in the order they are worth reading. */
const STATUS_ORDER = ["open", "approved", "rejected", "deferred"];


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
  const { runJob } = useJobDrawer();
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

  const proposals = useMemo(
    () => [...(data?.proposals ?? [])].sort((a, b) => (b.score ?? 0) - (a.score ?? 0)),
    [data],
  );

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
      for (const proposal of proposals) {
        const key = proposal.status ?? "open";
        map.set(key, (map.get(key) ?? 0) + 1);
      }
    }
    return [...map.entries()].sort((a, b) => {
      const ai = STATUS_ORDER.indexOf(a[0]);
      const bi = STATUS_ORDER.indexOf(b[0]);
      return (ai === -1 ? 99 : ai) - (bi === -1 ? 99 : bi);
    });
  }, [data, proposals]);

  const lastDiagnosed =
    data?.last_diagnosed ?? data?.stats?.last_diagnosed ?? data?.stats?.diagnosed ?? null;


  async function act(id: string, action: string, actionNote: string) {
    setNote(null);
    try {
      await local.post("/api/proposals/act", { id, action, note: actionNote });
      setOpenId(null);
      await load();
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
            className="border border-copper/60 px-3 py-1.5 font-mono text-[11px] uppercase tracking-[0.12em] text-copper transition-colors hover:bg-copper/10"
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
      ) : proposals.length === 0 ? (
        <Panel title="Queue">
          <Empty>Nothing proposed. The diagnostician runs nightly.</Empty>
        </Panel>
      ) : (
        <div className="border border-rule bg-panel">
          {proposals.map((proposal) => (
            <ProposalRow
              key={proposal.id}
              proposal={proposal}
              open={openId === proposal.id}
              onToggle={() => setOpenId(openId === proposal.id ? null : proposal.id)}
              onAct={act}
            />
          ))}
        </div>
      )}
    </div>
  );
}

function ProposalRow({
  proposal,
  open,
  onToggle,
  onAct,
}: {
  proposal: Proposal;
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
          <span className="mt-1 flex flex-wrap items-center gap-2 font-mono text-[10px] uppercase tracking-[0.12em] text-faint">
            {proposal.category && (
              <span className="border border-rule px-1.5 py-0.5 text-muted-foreground">
                {proposal.category}
              </span>
            )}
            <span>{files.length} file{files.length === 1 ? "" : "s"}</span>
            {controls.length > 0 && <span className="text-watch">control</span>}
          </span>
        </span>
        <span className="shrink-0 font-mono text-lg tabular-nums text-copper">
          {proposal.score ?? "—"}
        </span>
      </button>

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
            <h3 className="font-mono text-[10px] uppercase tracking-[0.16em] text-faint">Why</h3>
            <pre className="mt-2 max-w-[72ch] whitespace-pre-wrap break-words font-mono text-[11px] leading-relaxed text-muted-foreground">
              {proposal.why?.trim() || "—"}
            </pre>
          </section>

          <section>
            <h3 className="font-mono text-[10px] uppercase tracking-[0.16em] text-faint">What</h3>
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
            <h3 className="font-mono text-[10px] uppercase tracking-[0.16em] text-faint">Cost</h3>
            <div className="mt-2 grid grid-cols-3 gap-2">
              {[
                ["impact", proposal.impact],
                ["effort", proposal.effort],
                ["confidence", proposal.confidence],
              ].map(([label, value]) => (
                <div key={String(label)} className="border border-rule bg-panel2 px-3 py-2">
                  <div className="font-mono text-[10px] uppercase tracking-[0.14em] text-faint">
                    {label as string}
                  </div>
                  <div className="mt-1.5 font-mono text-sm tabular-nums text-paper">
                    {figure(value as string | number | undefined)}
                  </div>
                </div>
              ))}
            </div>
          </section>

          {controls.length > 0 && (
            <label className="flex items-start gap-2 text-[13px] text-muted-foreground">
              <input
                type="checkbox"
                checked={acknowledged}
                onChange={(event) => setAcknowledged(event.target.checked)}
                className="mt-1 accent-[#C8744A]"
              />
              I understand this alters a control
            </label>
          )}

          <div className="space-y-3 border-t border-rule pt-4">
            <div className="flex flex-wrap gap-2">
              <button
                disabled={busy || approveBlocked}
                onClick={() => void run("approve", "")}
                className="border border-copper/60 px-3 py-1.5 font-mono text-[11px] uppercase tracking-[0.12em] text-copper transition-colors hover:bg-copper/10 disabled:opacity-40"
              >
                Approve
              </button>
              <button
                disabled={busy}
                onClick={() => setShowApproveNote((value) => !value)}
                className="border border-rule px-3 py-1.5 font-mono text-[11px] uppercase tracking-[0.12em] text-muted-foreground transition-colors hover:text-paper disabled:opacity-40"
              >
                Approve with note
              </button>
              <button
                disabled={busy}
                onClick={() => void run("defer", approveNote.trim())}
                className="border border-rule px-3 py-1.5 font-mono text-[11px] uppercase tracking-[0.12em] text-muted-foreground transition-colors hover:text-paper disabled:opacity-40"
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
                  className="border border-copper/60 px-3 py-1.5 font-mono text-[11px] uppercase tracking-[0.12em] text-copper transition-colors hover:bg-copper/10 disabled:opacity-40"
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
                className="border border-risk/60 px-3 py-1.5 font-mono text-[11px] uppercase tracking-[0.12em] text-risk transition-colors hover:bg-risk/10 disabled:opacity-40"
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
