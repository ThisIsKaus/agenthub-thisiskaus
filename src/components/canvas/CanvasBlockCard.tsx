import { useCallback, useEffect, useRef, useState } from "react";
import { RefChip, ReferencePicker } from "@/components/canvas/ReferencePicker";
import { isRefusal, useLocal } from "@/lib/local-bridge";
import { useJobDrawer } from "@/lib/job-drawer";
import { insertJob } from "@/lib/jobs";
import {
  composeQuestion,
  JOB_KEYS,
  LANES,
  SOURCE_COUNTS,
  type AskOutcome,
  type AskSource,
  type CanvasBlock,
  type CanvasRef,
} from "@/lib/canvas-types";

const REFUSAL = /not in corpus|no relevant|not covered|cannot answer from the corpus/i;

type GroupedSource = { name: string; best: number | undefined; passages: number };

/** One row per file: its best (lowest) distance, and how many chunks matched. */
export function groupSources(sources: AskSource[]): GroupedSource[] {
  const byName = new Map<string, GroupedSource>();
  for (const source of sources) {
    const name = source.file ?? source.path ?? "—";
    const existing = byName.get(name);
    if (!existing) {
      byName.set(name, { name, best: source.distance, passages: 1 });
      continue;
    }
    existing.passages += 1;
    if (source.distance != null && (existing.best == null || source.distance < existing.best)) {
      existing.best = source.distance;
    }
  }
  return [...byName.values()].sort((a, b) => (a.best ?? Infinity) - (b.best ?? Infinity));
}

export function distanceTone(distance: number | undefined) {
  if (distance == null) return { className: "text-faint", title: undefined as string | undefined };
  if (distance < 0.5) return { className: "text-ok", title: undefined };
  if (distance <= 0.7) return { className: "text-muted-foreground", title: undefined };
  return { className: "text-watch", title: "weak match — the corpus may not cover this" };
}

function stamp(iso: string | null | undefined) {
  if (!iso) return "—";
  const date = new Date(iso);
  return Number.isNaN(date.getTime()) ? "—" : date.toISOString().slice(0, 16).replace("T", " ");
}

const KIND_LABEL: Record<CanvasBlock["kind"], string> = {
  prompt: "Ask",
  note: "Note",
  job: "Run",
  capture: "Hand over",
};

export function CanvasBlockCard({
  block,
  index,
  total,
  onChange,
  onRemove,
  onMove,
  onDuplicate,
}: {
  block: CanvasBlock;
  index: number;
  total: number;
  onChange: (patch: Partial<CanvasBlock>) => void;
  onRemove: () => void;
  onMove: (direction: -1 | 1) => void;
  onDuplicate: () => void;
}) {
  const local = useLocal();
  const drawer = useJobDrawer();
  const [picker, setPicker] = useState(false);
  const [pickerQuery, setPickerQuery] = useState("");
  const [busy, setBusy] = useState(false);
  const [elapsed, setElapsed] = useState(0);
  const [status, setStatus] = useState<string | null>(null);
  const box = useRef<HTMLTextAreaElement>(null);
  const trigger = useRef<number | null>(null);

  useEffect(() => {
    if (!busy) return;
    const started = Date.now();
    setElapsed(0);
    const timer = window.setInterval(
      () => setElapsed(Math.floor((Date.now() - started) / 1000)),
      1000,
    );
    return () => window.clearInterval(timer);
  }, [busy]);

  const addRef = useCallback(
    (reference: CanvasRef) => {
      const already = block.refs.some((item) => item.id === reference.id);
      const refs = already ? block.refs : [...block.refs, reference];
      const element = box.current;
      let text = block.text;
      if (element && trigger.current != null) {
        const at = trigger.current;
        text = `${block.text.slice(0, at)}@${reference.label} ${block.text.slice(element.selectionStart)}`;
      }
      trigger.current = null;
      onChange({ refs, text } as Partial<CanvasBlock>);
      setPicker(false);
      setPickerQuery("");
      window.setTimeout(() => box.current?.focus(), 0);
    },
    [block.refs, block.text, onChange],
  );

  const removeRef = (id: string) =>
    onChange({ refs: block.refs.filter((item) => item.id !== id) } as Partial<CanvasBlock>);

  function onText(value: string, caret: number) {
    onChange({ text: value } as Partial<CanvasBlock>);
    const previous = value[caret - 1];
    if (previous === "@") {
      trigger.current = caret - 1;
      setPickerQuery("");
      setPicker(true);
    }
  }

  async function runPrompt() {
    if (block.kind !== "prompt" || busy) return;
    const question = composeQuestion(block.text, block.refs);
    if (!question) return;
    setBusy(true);
    setStatus("thinking on the machine…");
    const started = Date.now();
    try {
      const data = await local.post<{ answer?: string; model?: string; sources?: AskSource[] }>(
        "/api/ask",
        { q: question, model: block.model, k: String(block.k) },
      );
      const result: AskOutcome = {
        answer: data.answer ?? "",
        model: data.model ?? block.model,
        sources: data.sources ?? [],
        at: new Date().toISOString(),
        seconds: Math.round((Date.now() - started) / 1000),
        askedK: block.k,
      };
      onChange({ result, note: null } as Partial<CanvasBlock>);
      setStatus(null);
    } catch (error) {
      onChange({
        note: isRefusal(error)
          ? error.message || "denied at the approval dialog"
          : "the machine did not answer that question",
      } as Partial<CanvasBlock>);
      setStatus(null);
    } finally {
      setBusy(false);
    }
  }

  async function runJobBlock() {
    if (block.kind !== "job" || busy) return;
    const entry = JOB_KEYS.find((item) => item.key === block.jobKey);
    setBusy(true);
    onChange({ note: "running on the machine…" } as Partial<CanvasBlock>);
    await drawer.runJob(block.jobKey, entry?.label ?? block.jobKey, (job) => {
      onChange({
        out: job.out,
        code: job.code,
        at: new Date().toISOString(),
        note: null,
      } as Partial<CanvasBlock>);
      setBusy(false);
    });
  }

  async function sendCapture() {
    if (block.kind !== "capture" || busy) return;
    const text = composeQuestion(block.text, block.refs);
    if (!text) return;
    setBusy(true);
    try {
      if (local.available) {
        await local.post("/api/capture", { text });
        onChange({ sentAt: new Date().toISOString(), note: "captured on the machine" } as Partial<CanvasBlock>);
      } else {
        await insertJob("capture", { text });
        onChange({ sentAt: new Date().toISOString(), note: "queued for the machine" } as Partial<CanvasBlock>);
      }
    } catch (error) {
      onChange({
        note: isRefusal(error)
          ? error.message || "denied at the approval dialog"
          : "the capture was not accepted",
      } as Partial<CanvasBlock>);
    } finally {
      setBusy(false);
    }
  }

  function primary() {
    if (block.kind === "prompt") return void runPrompt();
    if (block.kind === "job") return void runJobBlock();
    if (block.kind === "capture") return void sendCapture();
  }

  const canRun =
    block.kind === "job" ||
    (block.kind !== "note" && (block.text.trim().length > 0 || block.refs.length > 0));

  return (
    <article
      className="border border-rule bg-panel"
      data-testid="canvas-block"
      data-block-kind={block.kind}
    >
      <header className="flex flex-wrap items-center gap-x-3 gap-y-2 border-b border-rule px-4 py-2">
        <span className="font-mono text-[10px] uppercase tracking-[0.16em] text-copper">
          {KIND_LABEL[block.kind]}
        </span>
        <span className="font-mono text-[10px] text-faint">
          {String(index + 1).padStart(2, "0")}/{String(total).padStart(2, "0")}
        </span>
        <div className="ml-auto flex items-center gap-3">
          <button
            type="button"
            onClick={() => onChange({ collapsed: !block.collapsed } as Partial<CanvasBlock>)}
            className="font-mono text-[10px] uppercase tracking-[0.14em] text-faint hover:text-copper"
          >
            {block.collapsed ? "open" : "fold"}
          </button>
          <button
            type="button"
            onClick={() => onMove(-1)}
            disabled={index === 0}
            aria-label="Move block up"
            className="font-mono text-[11px] text-faint hover:text-copper disabled:opacity-30"
          >
            ↑
          </button>
          <button
            type="button"
            onClick={() => onMove(1)}
            disabled={index === total - 1}
            aria-label="Move block down"
            className="font-mono text-[11px] text-faint hover:text-copper disabled:opacity-30"
          >
            ↓
          </button>
          <button
            type="button"
            onClick={onDuplicate}
            className="font-mono text-[10px] uppercase tracking-[0.14em] text-faint hover:text-copper"
          >
            copy
          </button>
          <button
            type="button"
            onClick={onRemove}
            className="font-mono text-[10px] uppercase tracking-[0.14em] text-faint hover:text-risk"
          >
            remove
          </button>
        </div>
      </header>

      {!block.collapsed && (
        <div className="px-4 py-4">
          <textarea
            ref={box}
            value={block.text}
            data-testid="block-input"
            onChange={(event) => onText(event.target.value, event.target.selectionStart)}
            onKeyDown={(event) => {
              if ((event.metaKey || event.ctrlKey) && event.key === "Enter") {
                event.preventDefault();
                primary();
              }
            }}
            rows={block.kind === "note" ? 4 : 5}
            placeholder={
              block.kind === "prompt"
                ? "A question for the corpus — type @ to reference a file, skill, project or tool…"
                : block.kind === "capture"
                  ? "Something to hand the machine…"
                  : block.kind === "job"
                    ? "Why you are running this…"
                    : "A note that stays on the machine…"
            }
            className="w-full resize-y border border-rule bg-panel2 px-3 py-3 text-[15px] leading-[1.75] text-paper outline-none placeholder:text-faint focus:border-copper"
          />

          <div className="mt-2 flex flex-wrap items-center gap-1.5">
            {block.refs.map((reference) => (
              <RefChip key={reference.id} reference={reference} onRemove={() => removeRef(reference.id)} />
            ))}
            <button
              type="button"
              data-testid="add-reference"
              onClick={() => {
                trigger.current = null;
                setPicker((open) => !open);
              }}
              className="border border-rule px-2 py-[3px] font-mono text-[10.5px] text-faint hover:border-copper hover:text-copper"
            >
              + reference
            </button>
          </div>

          <ReferencePicker
            open={picker}
            initialQuery={pickerQuery}
            selected={block.refs}
            onPick={addRef}
            onClose={() => {
              trigger.current = null;
              setPicker(false);
            }}
          />

          {block.kind === "prompt" && (
            <div className="mt-3 flex flex-wrap items-center gap-2">
              <select
                value={block.model}
                aria-label="Lane"
                onChange={(event) => onChange({ model: event.target.value } as Partial<CanvasBlock>)}
                className="border border-rule bg-panel2 px-2 py-1 font-mono text-[11px] text-paper outline-none focus:border-copper"
              >
                {LANES.map((lane) => (
                  <option key={lane.id} value={lane.id}>
                    {lane.label} · {lane.cost}
                  </option>
                ))}
              </select>
              <span className="font-mono text-[10px] uppercase tracking-[0.16em] text-faint">
                sources
              </span>
              {SOURCE_COUNTS.map((count) => (
                <button
                  key={count}
                  type="button"
                  onClick={() => onChange({ k: count } as Partial<CanvasBlock>)}
                  className={`border px-2 py-1 font-mono text-[11px] tabular-nums ${
                    count === block.k ? "border-copper text-copper" : "border-rule text-muted-foreground"
                  }`}
                >
                  {count}
                </button>
              ))}
            </div>
          )}

          {block.kind === "job" && (
            <div className="mt-3 flex flex-wrap items-center gap-2">
              <select
                value={block.jobKey}
                aria-label="Job"
                onChange={(event) => onChange({ jobKey: event.target.value } as Partial<CanvasBlock>)}
                className="border border-rule bg-panel2 px-2 py-1 font-mono text-[11px] text-paper outline-none focus:border-copper"
              >
                {JOB_KEYS.map((entry) => (
                  <option key={entry.key} value={entry.key}>
                    {entry.label} · {entry.tier}
                  </option>
                ))}
              </select>
            </div>
          )}

          {block.kind !== "note" && (
            <div className="mt-3 flex flex-wrap items-center gap-3">
              <button
                type="button"
                data-testid="run-block"
                onClick={primary}
                disabled={busy || !canRun}
                className="border border-copper px-4 py-2 font-mono text-[11px] uppercase tracking-[0.14em] text-copper disabled:opacity-40"
              >
                {block.kind === "prompt" ? "Ask" : block.kind === "job" ? "Run" : "Hand over"}
              </button>
              {busy && (
                <span className="font-mono text-[10px] tabular-nums text-faint">
                  {status ?? "working…"} {elapsed}s
                </span>
              )}
              {busy && elapsed >= 20 && block.kind === "prompt" && (
                <span className="font-mono text-[10px] text-faint">
                  the 35B reasons before answering — this is normal
                </span>
              )}
            </div>
          )}

          {"note" in block && block.note && (
            <p className="mt-2 font-mono text-[10px] text-faint" data-testid="block-note">
              {block.note}
            </p>
          )}

          {block.kind === "prompt" && block.result && (
            <section className="mt-4 border-t border-rule pt-3" data-testid="block-answer">
              {REFUSAL.test(block.result.answer) ? (
                <>
                  <p className="max-w-[72ch] whitespace-pre-wrap break-words text-[14px] leading-[1.85] text-muted-foreground">
                    {block.result.answer}
                  </p>
                  <p className="mt-3 font-mono text-[10px] text-faint">
                    The corpus does not cover this. That refusal is correct behaviour.
                  </p>
                </>
              ) : (
                <p className="max-w-[72ch] whitespace-pre-wrap break-words text-[15px] leading-[1.85] text-paper">
                  {block.result.answer}
                </p>
              )}

              <p className="mt-3 font-mono text-[10px] tabular-nums text-faint">
                {block.result.model} · {block.result.seconds}s · {stamp(block.result.at)}
              </p>

              {block.result.sources.length > 0 && (
                <ul className="mt-3 border-t border-rule">
                  {groupSources(block.result.sources).map((source) => {
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
                          {source.best != null ? source.best.toFixed(3) : "—"}
                        </span>
                      </li>
                    );
                  })}
                </ul>
              )}
              {block.result.sources.length < block.result.askedK && (
                <p className="mt-2 font-mono text-[10px] text-faint">
                  {block.result.sources.length} of {block.result.askedK} requested
                </p>
              )}
            </section>
          )}

          {block.kind === "job" && block.out && (
            <section className="mt-4 border-t border-rule pt-3" data-testid="block-output">
              <pre className="max-h-[280px] overflow-auto whitespace-pre-wrap break-words font-mono text-[11px] leading-relaxed text-muted-foreground">
                {block.out}
              </pre>
              <p className="mt-2 font-mono text-[10px] tabular-nums text-faint">
                exit {block.code ?? "—"} · {stamp(block.at)}
              </p>
            </section>
          )}

          {block.kind === "capture" && block.sentAt && (
            <p className="mt-3 border-t border-rule pt-3 font-mono text-[10px] tabular-nums text-faint">
              handed over {stamp(block.sentAt)}
            </p>
          )}
        </div>
      )}
    </article>
  );
}
