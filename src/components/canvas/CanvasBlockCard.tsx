import { useCallback, useEffect, useRef, useState } from "react";
import { RefChip, ReferencePicker } from "@/components/canvas/ReferencePicker";
import {
  ProvenanceFold,
  RunDiff,
  RunStrip,
  SourceList,
  stamp,
} from "@/components/canvas/RunHistory";
import { isRefusal, useLocal } from "@/lib/local-bridge";
import { assertAnswer, isLaneFault, LaneFault, useLaneCapacity } from "@/lib/lane-capacity";
import { useAutopilot } from "@/lib/model-autopilot";
import { useJobDrawer } from "@/lib/job-drawer";
import { insertJob } from "@/lib/jobs";
import {
  appendRun,
  composeQuestion,
  fanOutTargets,
  inputDigest,
  inputsOf,
  outputHashOf,
  replaceRun,
  staleness,
  upstreamsOf,
  type Upstream,
} from "@/lib/canvas-runs";
import {
  JOB_KEYS,
  newId,
  pinnedRun,
  runText,
  SOURCE_COUNTS,
  type AskSource,
  type CanvasBlock,
  type CanvasDoc,
  type CanvasRef,
  type Run,
  type RunOutput,
} from "@/lib/canvas-types";

const REFUSAL = /not in corpus|no relevant|not covered|cannot answer from the corpus/i;

/** Two at a time: the machine has one GPU, and eight at once only queues. */
const FAN_CONCURRENCY = 2;

const KIND_LABEL: Record<CanvasBlock["kind"], string> = {
  prompt: "Ask",
  note: "Note",
  job: "Run",
  capture: "Hand over",
};

type AskResponse = { answer?: string; model?: string; sources?: AskSource[] };

async function pool<T, R>(items: T[], limit: number, worker: (item: T, index: number) => Promise<R>) {
  const results: R[] = new Array(items.length);
  let cursor = 0;
  const lanes = new Array(Math.min(limit, items.length)).fill(null).map(async () => {
    for (;;) {
      const index = cursor;
      cursor += 1;
      if (index >= items.length) return;
      results[index] = await worker(items[index], index);
    }
  });
  await Promise.all(lanes);
  return results;
}

export function CanvasBlockCard({
  block,
  index,
  total,
  doc,
  onChange,
  onUpdate,
  onRemove,
  onMove,
  onDuplicate,
}: {
  block: CanvasBlock;
  index: number;
  total: number;
  doc: CanvasDoc;
  onChange: (patch: Partial<CanvasBlock>) => void;
  /** Functional update — the only safe way to append a run from async code. */
  onUpdate: (updater: (block: CanvasBlock) => CanvasBlock) => void;
  onRemove: () => void;
  onMove: (direction: -1 | 1) => void;
  onDuplicate: () => void;
}) {
  const local = useLocal();
  const capacity = useLaneCapacity();
  const drawer = useJobDrawer();
  const [picker, setPicker] = useState(false);
  const [pickerQuery, setPickerQuery] = useState("");
  const [deps, setDeps] = useState(false);
  const [busy, setBusy] = useState(false);
  const [elapsed, setElapsed] = useState(0);
  const [status, setStatus] = useState<string | null>(null);
  const [compareId, setCompareId] = useState<string | null>(null);
  const box = useRef<HTMLTextAreaElement>(null);
  const trigger = useRef<number | null>(null);

  const current = pinnedRun(block);
  const compared = compareId ? (block.runs.find((run) => run.id === compareId) ?? null) : null;
  const state = staleness(block, doc);
  const upstreams = upstreamsOf(block, doc);
  const targets = fanOutTargets(block);
  const children = current ? block.runs.filter((run) => run.parentRunId === current.id) : [];

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

  /** Append a run and pin it, in one functional update. */
  function startRun(run: Run) {
    onUpdate((live) => ({
      ...live,
      runs: appendRun(live.runs, run, live.pinnedRunId),
      pinnedRunId: run.parentRunId ? live.pinnedRunId : run.id,
      note: null,
    }));
  }

  function patchRun(id: string, patch: Partial<Run>) {
    onUpdate((live) => ({ ...live, runs: replaceRun(live.runs, id, patch) }));
  }

  function finishRun(id: string, output: RunOutput, extra: Partial<Run> = {}) {
    onUpdate((live) => ({
      ...live,
      runs: replaceRun(live.runs, id, {
        status: "ok",
        output,
        ...extra,
        provenance: {
          ...(live.runs.find((run) => run.id === id)?.provenance ?? ({} as Run["provenance"])),
          ...(extra.provenance ?? {}),
          outputHash: outputHashOf(output),
        },
      }),
    }));
  }

  function failRun(id: string, error: unknown, fallback: string) {
    if (isLaneFault(error)) {
      // The machine answered, but with a refusal to load, not with an answer.
      patchRun(id, { status: "refused", note: error.message });
      return;
    }
    const refused = isRefusal(error);
    patchRun(id, {
      status: refused ? "refused" : "failed",
      note: refused ? error.message || "denied at the approval dialog" : fallback,
    });
  }

  function shell(options: {
    label: string;
    prompt: string;
    requested: string;
    upstreams: Upstream[];
    digest: string;
    parentRunId?: string | null;
    attempt?: number;
    k?: number;
    jobKey?: string;
  }): Run {
    return {
      id: newId("run"),
      blockId: block.id,
      status: "running",
      label: options.label,
      parentRunId: options.parentRunId ?? null,
      childRunIds: [],
      attempt: options.attempt ?? block.runs.filter((run) => run.parentRunId === null).length + 1,
      output: { type: "none" },
      provenance: {
        requested: options.requested,
        model: options.requested,
        k: options.k,
        promptSent: options.prompt,
        jobKey: options.jobKey,
        inputs: inputsOf(options.upstreams),
        startedAt: new Date().toISOString(),
        ms: 0,
        inputDigest: options.digest,
        outputHash: "",
      },
      note: null,
    };
  }

  /**
   * One call, one contract: a body that carries an upstream error is a failure,
   * never an answer. Anything else would pin a router error as the block's
   * output and quote it into every downstream block.
   */
  async function ask(prompt: string, model: string, k: number): Promise<AskResponse> {
    const lane = capacity.byId(model);
    if (lane?.status === "cold") {
      // Autopilot makes room and loads it; with autopilot off this is a refusal
      // carrying the plan, never a router error pinned as an answer.
      const readied = await autopilot.ensureLane(model);
      if (!readied.ok) throw new LaneFault(readied.message, "capacity");
    }
    const data = await local.post<AskResponse>("/api/ask", { q: prompt, model, k: String(k) });
    assertAnswer(data.answer, lane?.label ?? model);
    return data;
  }

  /** One question, one lane, one answer. */
  async function runAsk() {
    if (block.kind !== "prompt" || busy) return;
    const prompt = composeQuestion(block.text, block.refs, upstreams);
    if (!prompt.trim()) return;

    if (block.fanOut && targets.length >= 2) return runFanOut(prompt);

    setBusy(true);
    setStatus("thinking on the machine…");
    const run = shell({
      label: `ask · ${block.model}`,
      prompt,
      requested: block.model,
      upstreams,
      digest: inputDigest(block, prompt, upstreams),
      k: block.k,
    });
    startRun(run);
    const started = Date.now();
    try {
      const data = await ask(prompt, block.model, block.k);
      finishRun(run.id, {
        type: "answer",
        answer: data.answer ?? "",
        sources: data.sources ?? [],
      }, {
        provenance: {
          ...run.provenance,
          model: data.model ?? block.model,
          retrieval: data.sources ?? [],
          ms: Date.now() - started,
        },
      });
    } catch (error) {
      failRun(run.id, error, "the machine did not answer that question");
    } finally {
      setBusy(false);
      setStatus(null);
    }
  }

  /**
   * Fan out one child run per referenced source, then merge. Each child is
   * scoped to a single source so a weak match in one cannot quietly colour the
   * others; the merge sees every child answer and is told to name disagreement.
   */
  async function runFanOut(prompt: string) {
    if (block.kind !== "prompt") return;
    setBusy(true);
    const digest = inputDigest(block, prompt, upstreams);
    const parent = shell({
      label: `merge · ${targets.length} sources`,
      prompt,
      requested: block.model,
      upstreams,
      digest,
      k: block.k,
    });
    startRun(parent);
    const started = Date.now();

    try {
      setStatus(`0/${targets.length} sources`);
      let done = 0;
      const answers = await pool(targets, FAN_CONCURRENCY, async (target, position) => {
        const scoped = composeQuestion(block.text, block.refs, upstreams, target);
        const child = shell({
          label: `${target.label}`,
          prompt: scoped,
          requested: block.model,
          upstreams,
          digest,
          parentRunId: parent.id,
          attempt: position + 1,
          k: block.k,
        });
        startRun(child);
        const childStarted = Date.now();
        try {
          const data = await ask(scoped, block.model, block.k);
          finishRun(child.id, {
            type: "answer",
            answer: data.answer ?? "",
            sources: data.sources ?? [],
          }, {
            provenance: {
              ...child.provenance,
              model: data.model ?? block.model,
              retrieval: data.sources ?? [],
              ms: Date.now() - childStarted,
            },
          });
          return { target, answer: data.answer ?? "", id: child.id };
        } catch (error) {
          failRun(child.id, error, "this source did not answer");
          return { target, answer: "", id: child.id };
        } finally {
          done += 1;
          setStatus(`${done}/${targets.length} sources`);
        }
      });

      onUpdate((live) => ({
        ...live,
        runs: replaceRun(live.runs, parent.id, { childRunIds: answers.map((entry) => entry.id) }),
      }));

      const usable = answers.filter((entry) => entry.answer.trim());
      if (usable.length === 0) {
        patchRun(parent.id, { status: "failed", note: "no source answered" });
        return;
      }

      setStatus("merging…");
      const mergePrompt = [
        `${usable.length} sources were each asked the question below, separately.`,
        `Write one answer. Where they agree, say it once. Where they disagree, name the`,
        `disagreement and which source said what. Do not invent anything absent from all of them.`,
        "",
        `Question: ${block.text.trim()}`,
        "",
        ...usable.map((entry) => `--- ${entry.target.label} ---\n${entry.answer.trim()}`),
      ].join("\n");

      const data = await ask(mergePrompt, block.model, block.k);
      finishRun(parent.id, {
        type: "answer",
        answer: data.answer ?? "",
        sources: usable.flatMap((entry) => [{ file: entry.target.label, path: entry.target.path }]),
      }, {
        provenance: {
          ...parent.provenance,
          model: data.model ?? block.model,
          promptSent: mergePrompt,
          ms: Date.now() - started,
        },
      });
    } catch (error) {
      failRun(parent.id, error, "the merge did not complete");
    } finally {
      setBusy(false);
      setStatus(null);
    }
  }

  /**
   * Reflection, done honestly: the critique runs on a different lane than the
   * answer it is reviewing. A model reviewing its own weights mostly re-hedges.
   */
  async function runCritique() {
    if (block.kind !== "prompt" || busy || !current) return;
    const answer = runText(current);
    if (!answer.trim()) return;
    // Never auto-select a cold lane: loading a second large model is what the
    // machine refuses, and a refusal is not a second opinion.
    const lane = capacity.critiqueLane(current.provenance.model);
    if (!lane) {
      setStatus(null);
      onUpdate((live) => ({ ...live, note: "no second lane is loaded — load one on Engine · Models" }));
      return;
    }

    const prompt = [
      "Review the answer below against the question. Name anything unsupported by the",
      "cited sources, anything overstated, and anything the question asked for that is",
      "missing. Then give a corrected answer. Be brief where it is already right.",
      "",
      `Question: ${block.text.trim()}`,
      "",
      `Answer under review:\n"""\n${answer.trim()}\n"""`,
    ].join("\n");

    setBusy(true);
    setStatus(`critique on ${lane.id}…`);
    const run = shell({
      label: `critique · ${lane.id}`,
      prompt,
      requested: lane.id,
      upstreams,
      digest: inputDigest(block, composeQuestion(block.text, block.refs, upstreams), upstreams),
      k: block.k,
    });
    startRun(run);
    const started = Date.now();
    try {
      const data = await ask(prompt, lane.id, block.k);
      finishRun(run.id, {
        type: "answer",
        answer: data.answer ?? "",
        sources: data.sources ?? [],
      }, {
        provenance: {
          ...run.provenance,
          model: data.model ?? lane.id,
          retrieval: data.sources ?? [],
          ms: Date.now() - started,
        },
      });
    } catch (error) {
      failRun(run.id, error, "the critique did not complete");
    } finally {
      setBusy(false);
      setStatus(null);
    }
  }

  /**
   * Job blocks now record the machine's job id, so a run written to disk can be
   * told apart from a run that merely finished while the tab was open.
   */
  async function runJobBlock() {
    if (block.kind !== "job" || busy) return;
    const entry = JOB_KEYS.find((item) => item.key === block.jobKey);
    const prompt = composeQuestion(block.text, block.refs, upstreams);
    setBusy(true);
    setStatus("starting on the machine…");
    const run = shell({
      label: entry?.label ?? block.jobKey,
      prompt,
      requested: block.jobKey,
      upstreams,
      digest: inputDigest(block, prompt, upstreams),
      jobKey: block.jobKey,
    });
    startRun(run);
    const started = Date.now();

    try {
      const response = await local.post<{ job: string; label?: string }>("/api/run", {
        key: block.jobKey,
      });
      const jobId = String(response.job);
      patchRun(run.id, { provenance: { ...run.provenance, jobId } });
      setStatus("running on the machine…");
      drawer.trackJob(jobId, block.jobKey, entry?.label ?? block.jobKey, (job) => {
        finishRun(run.id, { type: "console", out: job.out, code: job.code }, {
          provenance: { ...run.provenance, jobId, ms: Date.now() - started },
        });
        setBusy(false);
        setStatus(null);
      });
    } catch (error) {
      failRun(run.id, error, "the machine did not start the job");
      setBusy(false);
      setStatus(null);
    }
  }

  async function sendCapture() {
    if (block.kind !== "capture" || busy) return;
    const text = composeQuestion(block.text, block.refs, upstreams);
    if (!text.trim()) return;
    setBusy(true);
    const run = shell({
      label: local.available ? "handed to the machine" : "queued",
      prompt: text,
      requested: "handoff",
      upstreams,
      digest: inputDigest(block, text, upstreams),
    });
    startRun(run);
    const started = Date.now();
    try {
      if (local.available) {
        await local.post("/api/capture", { text });
        finishRun(run.id, { type: "handoff", text, via: "machine" }, {
          provenance: { ...run.provenance, ms: Date.now() - started },
        });
      } else {
        await insertJob("capture", { text });
        finishRun(run.id, { type: "handoff", text, via: "queue" }, {
          provenance: { ...run.provenance, ms: Date.now() - started },
        });
      }
    } catch (error) {
      failRun(run.id, error, "the capture was not accepted");
    } finally {
      setBusy(false);
    }
  }

  function primary() {
    if (block.kind === "prompt") return void runAsk();
    if (block.kind === "job") return void runJobBlock();
    if (block.kind === "capture") return void sendCapture();
  }

  function toggleDependency(id: string) {
    onChange({
      dependsOn: block.dependsOn.includes(id)
        ? block.dependsOn.filter((entry) => entry !== id)
        : [...block.dependsOn, id],
    } as Partial<CanvasBlock>);
  }

  const canRun =
    block.kind === "job" ||
    (block.kind !== "note" &&
      (block.text.trim().length > 0 || block.refs.length > 0 || upstreams.length > 0));

  const available = doc.blocks.filter((candidate) => candidate.id !== block.id);
  const output = current?.output;

  return (
    <article
      className="border border-rule bg-panel"
      data-testid="canvas-block"
      data-block-kind={block.kind}
      data-stale={state.state === "stale" ? "true" : "false"}
    >
      <header className="flex flex-wrap items-center gap-x-3 gap-y-2 border-b border-rule px-4 py-2">
        <span className="font-mono text-[10px] uppercase tracking-[0.16em] text-copper">
          {KIND_LABEL[block.kind]}
        </span>
        <span className="font-mono text-[10px] text-faint">
          {String(index + 1).padStart(2, "0")}/{String(total).padStart(2, "0")}
        </span>
        {state.state === "stale" && (
          <span
            data-testid="stale-badge"
            title={
              state.changed.length
                ? `changed since this ran: ${state.changed.join(", ")}`
                : "the inputs changed since this ran"
            }
            className="border border-watch/60 px-2 py-[2px] font-mono text-[9.5px] uppercase tracking-[0.14em] text-watch"
          >
            stale
          </span>
        )}
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

      {block.collapsed ? (
        <p className="px-4 py-2 font-mono text-[11px] text-faint">
          {block.text.trim().slice(0, 90) || "empty"}
          {block.text.trim().length > 90 ? "…" : ""}
        </p>
      ) : (
        <div className="px-4 py-4">
          {upstreams.length > 0 && (
            <p className="mb-2 flex flex-wrap items-center gap-1.5 font-mono text-[10px] text-faint">
              <span className="uppercase tracking-[0.16em]">built from</span>
              {upstreams.map((upstream) => (
                <span
                  key={upstream.block.id}
                  className="border border-rule bg-panel2 px-2 py-[2px] text-muted-foreground"
                  title={upstream.run ? "its pinned run feeds this block" : "this block has no run yet"}
                >
                  {String(upstream.index + 1).padStart(2, "0")}{" "}
                  <span className={upstream.run || upstream.block.kind === "note" ? "text-paper" : "text-watch"}>
                    {upstream.block.kind === "note" ? "note" : (upstream.run ? "pinned run" : "not run yet")}
                  </span>
                </span>
              ))}
            </p>
          )}

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
            <button
              type="button"
              data-testid="add-dependency"
              onClick={() => setDeps((open) => !open)}
              disabled={available.length === 0}
              title={
                available.length === 0
                  ? "Add a second block first — then this one can be built from its answer"
                  : "Feed another block's pinned answer into this one"
              }
              className="border border-rule px-2 py-[3px] font-mono text-[10.5px] text-faint hover:border-copper hover:text-copper disabled:cursor-not-allowed disabled:opacity-40 disabled:hover:border-rule disabled:hover:text-faint"
            >
              + built from
            </button>

          </div>

          {deps && (
            <div className="mt-2 border border-rule bg-panel2" data-testid="dependency-picker">
              {available.map((candidate) => {
                const position = doc.blocks.findIndex((entry) => entry.id === candidate.id);
                const on = block.dependsOn.includes(candidate.id);
                return (
                  <button
                    key={candidate.id}
                    type="button"
                    onClick={() => toggleDependency(candidate.id)}
                    className={`flex w-full items-baseline gap-3 border-t border-rule px-3 py-2 text-left first:border-t-0 hover:bg-panel ${
                      on ? "text-copper" : "text-paper"
                    }`}
                  >
                    <span className="font-mono text-[10px] text-faint">
                      {String(position + 1).padStart(2, "0")}
                    </span>
                    <span className="font-mono text-[10px] uppercase tracking-[0.14em] text-faint">
                      {KIND_LABEL[candidate.kind]}
                    </span>
                    <span className="min-w-0 flex-1 truncate text-[12.5px]">
                      {candidate.text.trim() || "empty block"}
                    </span>
                    <span className="font-mono text-[10px] text-faint">{on ? "linked" : "link"}</span>
                  </button>
                );
              })}
              <p className="border-t border-rule px-3 py-2 font-mono text-[10px] leading-relaxed text-faint">
                A linked block's pinned run is quoted into this one before it is sent. Change the
                upstream and this block goes stale rather than re-running itself.
              </p>
            </div>
          )}

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
                {capacity.lanes.map((lane) => (
                  <option key={lane.id} value={lane.id}>
                    {lane.label} · {lane.cost}
                    {lane.status === "cold" ? " · not loaded" : lane.status === "resident" ? " · resident" : ""}
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
              <button
                type="button"
                data-testid="toggle-fanout"
                onClick={() => onChange({ fanOut: !block.fanOut } as Partial<CanvasBlock>)}
                disabled={targets.length < 2}
                title={
                  targets.length < 2
                    ? "Reference two or more files and this asks each one separately, then merges"
                    : "Ask each referenced source separately, then merge the answers"
                }
                className={`border px-2 py-1 font-mono text-[11px] disabled:cursor-not-allowed disabled:opacity-40 ${
                  block.fanOut ? "border-copper text-copper" : "border-rule text-muted-foreground"
                }`}
              >
                one pass per source{targets.length >= 2 ? ` · ${targets.length}` : ""}
              </button>
              {capacity.byId(block.model)?.status === "cold" && (
                <span className="w-full font-mono text-[10px] text-watch">
                  {capacity.byId(block.model)?.label} is not loaded — the machine will refuse a second
                  large model while one is resident. Load it on Engine · Models, or pick a resident lane.
                </span>
              )}
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
                {block.kind === "prompt"
                  ? current
                    ? "Ask again"
                    : "Ask"
                  : block.kind === "job"
                    ? "Run"
                    : "Hand over"}
              </button>
              {block.kind === "prompt" && (
                <button
                  type="button"
                  data-testid="critique-block"
                  onClick={() => void runCritique()}
                  disabled={busy || current?.output.type !== "answer"}
                  title={
                    current?.output.type === "answer"
                      ? "Re-read the answer on a different model and correct it"
                      : "Ask something first — then a second model reviews the answer"
                  }
                  className="border border-rule px-3 py-2 font-mono text-[11px] uppercase tracking-[0.14em] text-muted-foreground hover:border-copper hover:text-copper disabled:cursor-not-allowed disabled:opacity-40 disabled:hover:border-rule disabled:hover:text-muted-foreground"
                >
                  Critique on another lane
                </button>
              )}

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

          {state.state === "stale" && state.changed.length > 0 && (
            <p className="mt-2 font-mono text-[10px] text-watch">
              changed since this ran: {state.changed.join(", ")} — the answer below is the old one
            </p>
          )}

          {block.note && (
            <p className="mt-2 font-mono text-[10px] text-faint" data-testid="block-note">
              {block.note}
            </p>
          )}

          {current?.note && (
            <p className="mt-2 font-mono text-[10px] text-watch" data-testid="run-note">
              {current.note}
            </p>
          )}

          <RunStrip
            runs={block.runs}
            pinnedId={block.pinnedRunId}
            compareId={compareId}
            onPin={(id) => {
              setCompareId(null);
              onChange({ pinnedRunId: id } as Partial<CanvasBlock>);
            }}
            onCompare={setCompareId}
          />

          {current && compared && current.id !== compared.id && (
            <RunDiff pinned={current} other={compared} />
          )}

          {output?.type === "answer" && (
            <section className="mt-4 border-t border-rule pt-3" data-testid="block-answer">
              {REFUSAL.test(output.answer) ? (
                <>
                  <p className="max-w-[72ch] whitespace-pre-wrap break-words text-[14px] leading-[1.85] text-muted-foreground">
                    {output.answer}
                  </p>
                  <p className="mt-3 font-mono text-[10px] text-faint">
                    The corpus does not cover this. That refusal is correct behaviour.
                  </p>
                </>
              ) : (
                <p className="max-w-[72ch] whitespace-pre-wrap break-words text-[15px] leading-[1.85] text-paper">
                  {output.answer}
                </p>
              )}

              {children.length > 0 && (
                <details className="mt-3 border border-rule bg-panel2" data-testid="fanout-children">
                  <summary className="cursor-pointer px-3 py-2 font-mono text-[10.5px] text-muted-foreground">
                    {children.filter((run) => run.status === "ok").length}/{children.length} sources
                    answered separately
                  </summary>
                  <div className="border-t border-rule">
                    {children.map((child) => (
                      <div key={child.id} className="border-b border-rule px-3 py-2 last:border-b-0">
                        <p className="font-mono text-[10px] text-faint">
                          {child.label} · {child.provenance.model} ·{" "}
                          {child.status === "ok" ? "answered" : (child.note ?? child.status)}
                        </p>
                        {child.output.type === "answer" && child.output.answer && (
                          <p className="mt-1 max-w-[72ch] whitespace-pre-wrap break-words text-[13px] leading-[1.8] text-muted-foreground">
                            {child.output.answer}
                          </p>
                        )}
                      </div>
                    ))}
                  </div>
                </details>
              )}

              {current && (
                <ProvenanceFold run={current}>
                  <SourceList
                    sources={current.provenance.retrieval ?? output.sources}
                    askedK={current.provenance.k}
                  />
                </ProvenanceFold>
              )}

              <SourceList sources={output.sources} askedK={current?.provenance.k} />
            </section>
          )}

          {output?.type === "console" && output.out && (
            <section className="mt-4 border-t border-rule pt-3" data-testid="block-output">
              <pre className="max-h-[280px] overflow-auto whitespace-pre-wrap break-words font-mono text-[11px] leading-relaxed text-muted-foreground">
                {output.out}
              </pre>
              <p className="mt-2 font-mono text-[10px] tabular-nums text-faint">
                exit {output.code ?? "—"} · {stamp(current?.provenance.startedAt)}
              </p>
              {current && <ProvenanceFold run={current} />}
            </section>
          )}

          {output?.type === "handoff" && (
            <p className="mt-3 border-t border-rule pt-3 font-mono text-[10px] tabular-nums text-faint">
              {output.via === "machine" ? "handed over" : "queued for the machine"}{" "}
              {stamp(current?.provenance.startedAt)}
            </p>
          )}
        </div>
      )}
    </article>
  );
}
