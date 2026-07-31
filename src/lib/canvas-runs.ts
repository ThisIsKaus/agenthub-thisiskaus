/**
 * The run engine: how a block's inputs are composed, hashed, and compared.
 *
 * Staleness here is the same idea a build system uses. Every run records a
 * digest of everything that determined it — the prompt as sent, the lane, the
 * source count, and the content hashes of the upstream outputs it consumed. If
 * the digest recomputed from the block's current state differs from the digest
 * stored on its pinned run, the result on screen was produced from inputs that
 * have since changed. It is marked stale and never silently re-run: a local
 * 35B answer costs real minutes, so recomputation stays the reader's decision.
 */

import {
  pinnedRun,
  REF_LABEL,
  runText,
  type CanvasBlock,
  type CanvasDoc,
  type CanvasRef,
  type Provenance,
  type Run,
  type RunOutput,
  RUN_KEEP,
} from "@/lib/canvas-types";

/** FNV-1a, 32-bit. Not cryptographic — this detects change, it does not attest. */
export function hash(input: string): string {
  let value = 0x811c9dc5;
  for (let index = 0; index < input.length; index += 1) {
    value ^= input.charCodeAt(index);
    value = Math.imul(value, 0x01000193);
  }
  return (value >>> 0).toString(16).padStart(8, "0");
}

export function shortHash(digest: string) {
  return digest ? digest.slice(0, 8) : "—";
}

/** Upstream blocks resolved to their pinned output, in document order. */
export type Upstream = { block: CanvasBlock; run: Run | null; index: number };

export function upstreamsOf(block: CanvasBlock, doc: CanvasDoc): Upstream[] {
  return block.dependsOn
    .map((id) => {
      const index = doc.blocks.findIndex((candidate) => candidate.id === id);
      if (index < 0) return null;
      const upstream = doc.blocks[index];
      return { block: upstream, run: pinnedRun(upstream), index };
    })
    .filter((entry): entry is Upstream => entry !== null);
}

/** Cut upstream text so one long answer cannot crowd out the question itself. */
const UPSTREAM_BUDGET = 4000;

function upstreamBody(upstream: Upstream): string {
  const text = upstream.block.kind === "note" ? upstream.block.text : runText(upstream.run);
  const trimmed = text.trim();
  if (!trimmed) return "";
  return trimmed.length > UPSTREAM_BUDGET
    ? `${trimmed.slice(0, UPSTREAM_BUDGET)}\n… truncated at ${UPSTREAM_BUDGET} characters`
    : trimmed;
}

/**
 * References travel to the model as a short, explicit preamble, and upstream
 * blocks as quoted context. Paths are only ever rendered and sent on the local
 * plane — this string never leaves loopback.
 */
export function composeQuestion(
  text: string,
  refs: CanvasRef[],
  upstreams: Upstream[] = [],
  scope?: CanvasRef,
): string {
  const parts: string[] = [];

  if (scope) {
    parts.push(
      `Answer only from this source: ${scope.label}${scope.path ? ` (${scope.path})` : ""}. ` +
        `If it does not cover the question, say so plainly rather than reaching elsewhere.`,
    );
  }

  if (refs.length > 0) {
    const lines = refs.map(
      (ref) => `- ${REF_LABEL[ref.kind]}: ${ref.label}${ref.path ? ` (${ref.path})` : ""}`,
    );
    parts.push(`References for this question:\n${lines.join("\n")}`);
  }

  for (const upstream of upstreams) {
    const body = upstreamBody(upstream);
    if (!body) continue;
    const label = `Block ${String(upstream.index + 1).padStart(2, "0")}`;
    parts.push(`${label} produced:\n"""\n${body}\n"""`);
  }

  parts.push(text.trim());
  return parts.filter(Boolean).join("\n\n");
}

/** The inputs a run consumed, recorded by content hash for later comparison. */
export function inputsOf(upstreams: Upstream[]): Provenance["inputs"] {
  return upstreams.map((upstream) => ({
    blockId: upstream.block.id,
    runId: upstream.run?.id ?? "",
    outputHash: hash(upstreamBody(upstream)),
  }));
}

/** Everything that determines a result, folded into one comparable string. */
export function inputDigest(block: CanvasBlock, prompt: string, upstreams: Upstream[]): string {
  const parameters =
    block.kind === "prompt"
      ? `${block.model}|k=${block.k}|fan=${block.fanOut ? 1 : 0}`
      : block.kind === "job"
        ? `job=${block.jobKey}`
        : block.kind;
  const inputs = inputsOf(upstreams)
    .map((input) => `${input.blockId}:${input.outputHash}`)
    .join(",");
  return hash(`${parameters}\u0000${prompt}\u0000${inputs}`);
}

export type Staleness =
  | { state: "never" }
  | { state: "fresh" }
  | { state: "unknown" }
  | { state: "stale"; changed: string[] };

/**
 * Compare the pinned run's digest against what the block would send now.
 * `unknown` covers runs migrated from the schema that kept no digest.
 */
export function staleness(block: CanvasBlock, doc: CanvasDoc): Staleness {
  const run = pinnedRun(block);
  if (!run) return { state: "never" };
  if (!run.provenance.inputDigest) return { state: "unknown" };

  const upstreams = upstreamsOf(block, doc);
  const prompt = composeQuestion(block.text, block.refs, upstreams);
  if (inputDigest(block, prompt, upstreams) === run.provenance.inputDigest) return { state: "fresh" };

  const before = new Map(run.provenance.inputs.map((input) => [input.blockId, input.outputHash]));
  const changed: string[] = [];
  for (const upstream of upstreamsOf(block, doc)) {
    const now = hash(upstreamBody(upstream));
    if (before.get(upstream.block.id) !== now) {
      changed.push(`block ${String(upstream.index + 1).padStart(2, "0")}`);
    }
  }
  if (run.provenance.promptSent != null && run.provenance.promptSent !== prompt) {
    changed.unshift("this block's own text");
  }
  return { state: "stale", changed };
}

export function outputHashOf(output: RunOutput): string {
  if (output.type === "answer") return hash(output.answer);
  if (output.type === "console") return hash(`${output.code}\u0000${output.out}`);
  if (output.type === "handoff") return hash(output.text);
  return "";
}

/** Newest first, capped — but a pinned run is never evicted by age. */
export function appendRun(runs: Run[], run: Run, pinnedId: string | null): Run[] {
  const next = [run, ...runs.filter((existing) => existing.id !== run.id)];
  if (next.length <= RUN_KEEP) return next;
  const kept = next.slice(0, RUN_KEEP);
  const pinned = pinnedId ? next.find((entry) => entry.id === pinnedId) : undefined;
  if (pinned && !kept.some((entry) => entry.id === pinned.id)) kept[kept.length - 1] = pinned;
  return kept;
}

export function replaceRun(runs: Run[], id: string, patch: Partial<Run>): Run[] {
  return runs.map((run) => (run.id === id ? { ...run, ...patch } : run));
}

/** Corpus and file references are the fan-out targets; nothing else is. */
export function fanOutTargets(block: CanvasBlock): CanvasRef[] {
  return block.refs.filter((ref) => ref.kind === "source" || ref.kind === "file");
}

/**
 * A word-level diff of two runs, rendered as three ordered segments. Enough to
 * see what actually moved between two answers without a diff library.
 */
export type DiffPart = { text: string; state: "same" | "removed" | "added" };

export function diffWords(before: string, after: string): DiffPart[] {
  const a = before.split(/(\s+)/);
  const b = after.split(/(\s+)/);

  let head = 0;
  while (head < a.length && head < b.length && a[head] === b[head]) head += 1;

  let tail = 0;
  while (
    tail < a.length - head &&
    tail < b.length - head &&
    a[a.length - 1 - tail] === b[b.length - 1 - tail]
  ) {
    tail += 1;
  }

  const parts: DiffPart[] = [];
  const prefix = a.slice(0, head).join("");
  const removed = a.slice(head, a.length - tail).join("");
  const added = b.slice(head, b.length - tail).join("");
  const suffix = a.slice(a.length - tail).join("");

  if (prefix) parts.push({ text: prefix, state: "same" });
  if (removed) parts.push({ text: removed, state: "removed" });
  if (added) parts.push({ text: added, state: "added" });
  if (suffix) parts.push({ text: suffix, state: "same" });
  return parts.length ? parts : [{ text: after, state: "same" }];
}
