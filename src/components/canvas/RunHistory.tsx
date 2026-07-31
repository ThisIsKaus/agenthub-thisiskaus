import { useState } from "react";
import { diffWords, shortHash } from "@/lib/canvas-runs";
import { runText, type AskSource, type Run } from "@/lib/canvas-types";
import { fixed, toNum } from "@/lib/format";

export function stamp(iso: string | null | undefined) {
  if (!iso) return "—";
  const date = new Date(iso);
  return Number.isNaN(date.getTime()) ? "—" : date.toISOString().slice(0, 16).replace("T", " ");
}

export function seconds(ms: number) {
  return ms >= 1000 ? `${Math.round(ms / 1000)}s` : `${ms}ms`;
}

type GroupedSource = { name: string; best: number | undefined; passages: number };

/** One row per file: its best (lowest) distance, and how many chunks matched. */
export function groupSources(sources: AskSource[]): GroupedSource[] {
  const byName = new Map<string, GroupedSource>();
  for (const source of sources) {
    const name = source.file ?? source.path ?? "—";
    const existing = byName.get(name);
    if (!existing) {
      byName.set(name, { name, best: toNum(source.distance) ?? undefined, passages: 1 });
      continue;
    }
    existing.passages += 1;
    const distance = toNum(source.distance);
    if (distance != null && (existing.best == null || distance < existing.best)) {
      existing.best = distance;
    }
  }
  return [...byName.values()].sort((a, b) => (a.best ?? Infinity) - (b.best ?? Infinity));
}

export function distanceTone(value: unknown) {
  const distance = toNum(value);
  if (distance == null) return { className: "text-faint", title: undefined as string | undefined };
  if (distance < 0.5) return { className: "text-ok", title: undefined };
  if (distance <= 0.7) return { className: "text-muted-foreground", title: undefined };
  return { className: "text-watch", title: "weak match — the corpus may not cover this" };
}

export function SourceList({ sources, askedK }: { sources: AskSource[]; askedK?: number }) {
  if (sources.length === 0) return null;
  const grouped = groupSources(sources);
  return (
    <>
      <ul className="mt-3 border-t border-rule">
        {grouped.map((source) => {
          const tone = distanceTone(source.best);
          return (
            <li
              key={source.name}
              className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1 border-b border-rule py-1.5"
            >
              <span className="break-all font-mono text-[11.5px] text-paper">
                {source.name}
                {source.passages > 1 && (
                  <span className="ml-2 text-faint">{source.passages} passages</span>
                )}
              </span>
              <span
                className={`font-mono text-[10px] tabular-nums ${tone.className}`}
                title={tone.title}
              >
                {fixed(source.best, 3)}
              </span>
            </li>
          );
        })}
      </ul>
      {askedK != null && sources.length < askedK && (
        <p className="mt-2 font-mono text-[10px] text-faint">
          {sources.length} of {askedK} requested
        </p>
      )}
    </>
  );
}

const STATUS_TONE: Record<Run["status"], string> = {
  running: "text-copper",
  ok: "text-paper",
  failed: "text-risk",
  refused: "text-watch",
};

/**
 * The run history: every attempt this block has made, newest first. Selecting
 * one pins it — the pinned run is what the block "means" and what downstream
 * blocks consume. Comparing two shows what actually moved between them.
 */
export function RunStrip({
  runs,
  pinnedId,
  compareId,
  onPin,
  onCompare,
}: {
  runs: Run[];
  pinnedId: string | null;
  compareId: string | null;
  onPin: (id: string) => void;
  onCompare: (id: string | null) => void;
}) {
  const top = runs.filter((run) => run.parentRunId === null);
  if (top.length === 0) return null;

  return (
    <div className="mt-3 flex flex-wrap items-center gap-x-2 gap-y-1.5 border-t border-rule pt-3">
      <span className="font-mono text-[10px] uppercase tracking-[0.16em] text-faint">runs</span>
      {top.map((run, index) => {
        const pinned = run.id === (pinnedId ?? top[0]?.id);
        const compared = run.id === compareId;
        return (
          <span key={run.id} className="inline-flex items-center">
            <button
              type="button"
              data-testid="run-pill"
              onClick={() => onPin(run.id)}
              title={`${run.label} · ${stamp(run.provenance.startedAt)} · ${run.provenance.model}`}
              className={`border px-2 py-[3px] font-mono text-[10.5px] ${
                pinned ? "border-copper text-copper" : "border-rule text-muted-foreground hover:text-paper"
              }`}
            >
              <span className={STATUS_TONE[run.status]}>
                {run.status === "running" ? "…" : run.status === "ok" ? "·" : "!"}
              </span>{" "}
              {top.length - index}. {run.label}
            </button>
            {!pinned && run.status === "ok" && (
              <button
                type="button"
                onClick={() => onCompare(compared ? null : run.id)}
                title="Compare with the pinned run"
                className={`ml-1 border border-rule px-1.5 py-[3px] font-mono text-[10px] ${
                  compared ? "border-copper text-copper" : "text-faint hover:text-copper"
                }`}
              >
                diff
              </button>
            )}
          </span>
        );
      })}
    </div>
  );
}

/** Two runs side by side: what differed in the inputs, and in the words. */
export function RunDiff({ pinned, other }: { pinned: Run; other: Run }) {
  const parts = diffWords(runText(other), runText(pinned));
  const rows: { label: string; before: string; after: string }[] = [
    { label: "model", before: other.provenance.model, after: pinned.provenance.model },
    {
      label: "sources asked",
      before: String(other.provenance.k ?? "—"),
      after: String(pinned.provenance.k ?? "—"),
    },
    { label: "took", before: seconds(other.provenance.ms), after: seconds(pinned.provenance.ms) },
    {
      label: "input digest",
      before: shortHash(other.provenance.inputDigest),
      after: shortHash(pinned.provenance.inputDigest),
    },
  ];

  return (
    <section className="mt-3 border border-rule bg-panel2 p-3" data-testid="run-diff">
      <p className="font-mono text-[10px] uppercase tracking-[0.16em] text-faint">
        {other.label} → {pinned.label}
      </p>
      <ul className="mt-2">
        {rows.map((row) => (
          <li
            key={row.label}
            className="flex flex-wrap items-baseline gap-x-3 border-b border-rule py-1 font-mono text-[10.5px] last:border-b-0"
          >
            <span className="w-[92px] shrink-0 text-faint">{row.label}</span>
            <span className={row.before === row.after ? "text-faint" : "text-watch line-through"}>
              {row.before}
            </span>
            {row.before !== row.after && <span className="text-paper">{row.after}</span>}
          </li>
        ))}
      </ul>
      <p className="mt-3 max-w-[72ch] whitespace-pre-wrap break-words text-[13.5px] leading-[1.8]">
        {parts.map((part, index) => (
          <span
            key={index}
            className={
              part.state === "removed"
                ? "bg-risk/15 text-risk line-through"
                : part.state === "added"
                  ? "bg-ok/15 text-ok"
                  : "text-muted-foreground"
            }
          >
            {part.text}
          </span>
        ))}
      </p>
    </section>
  );
}

/**
 * The provenance record, folded away by default. This is what makes an answer
 * still readable in six months: the prompt as actually sent, the lane that
 * answered, and the upstream outputs it consumed, each by content hash.
 */
export function ProvenanceFold({ run, children }: { run: Run; children?: React.ReactNode }) {
  const [open, setOpen] = useState(false);
  const provenance = run.provenance;

  return (
    <div className="mt-3 border-t border-rule pt-2">
      <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
        <p className="font-mono text-[10px] tabular-nums text-faint">
          {provenance.model}
          {provenance.requested !== provenance.model && (
            <span title="the machine answered on a different lane than requested">
              {" "}
              (asked {provenance.requested})
            </span>
          )}{" "}
          · {seconds(provenance.ms)} · {stamp(provenance.startedAt)}
        </p>
        <button
          type="button"
          data-testid="provenance-toggle"
          onClick={() => setOpen((value) => !value)}
          className="font-mono text-[10px] uppercase tracking-[0.14em] text-faint hover:text-copper"
        >
          {open ? "hide record" : "record"}
        </button>
        <span className="font-mono text-[10px] text-faint" title="digest of everything that determined this result">
          {shortHash(provenance.inputDigest)}
        </span>
      </div>

      {open && (
        <div className="mt-2 border border-rule bg-panel2 p-3" data-testid="provenance-record">
          <dl className="grid grid-cols-[92px_1fr] gap-x-3 gap-y-1 font-mono text-[10.5px]">
            <dt className="text-faint">run</dt>
            <dd className="break-all text-muted-foreground">{run.id}</dd>
            <dt className="text-faint">attempt</dt>
            <dd className="text-muted-foreground">{run.attempt}</dd>
            {provenance.jobKey && (
              <>
                <dt className="text-faint">job</dt>
                <dd className="text-muted-foreground">
                  {provenance.jobKey}
                  {provenance.jobId ? ` · ${provenance.jobId}` : ""}
                </dd>
              </>
            )}
            {provenance.k != null && (
              <>
                <dt className="text-faint">sources</dt>
                <dd className="text-muted-foreground">{provenance.k} requested</dd>
              </>
            )}
            <dt className="text-faint">output</dt>
            <dd className="text-muted-foreground">{shortHash(provenance.outputHash)}</dd>
            {provenance.inputs.length > 0 && (
              <>
                <dt className="text-faint">consumed</dt>
                <dd className="text-muted-foreground">
                  {provenance.inputs.map((input) => (
                    <span key={input.blockId} className="mr-2 inline-block break-all">
                      {input.blockId.split("-")[0]} @ {shortHash(input.outputHash)}
                    </span>
                  ))}
                </dd>
              </>
            )}
          </dl>

          {provenance.promptSent && (
            <>
              <p className="mt-3 font-mono text-[10px] uppercase tracking-[0.16em] text-faint">
                sent verbatim
              </p>
              <pre className="mt-1 max-h-[220px] overflow-auto whitespace-pre-wrap break-words border border-rule bg-panel p-2 font-mono text-[10.5px] leading-relaxed text-muted-foreground">
                {provenance.promptSent}
              </pre>
            </>
          )}

          {children}
        </div>
      )}
    </div>
  );
}
