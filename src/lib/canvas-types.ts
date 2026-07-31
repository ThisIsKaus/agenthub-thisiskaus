/**
 * The canvas is a block document. Every block is a unit of work that carries
 * its own references, runs on the machine, and keeps a history of its runs.
 * Nothing here is ever sent to Supabase except an explicit hand-over block.
 *
 * Schema v2. The unit of history is the RUN, not the document: a block is a
 * stable question, a run is one answer to it. Runs are immutable once finished
 * and append-only, so "try this three ways and compare" needs no branching of
 * the file itself. Every run carries a provenance record — what was actually
 * sent, to which model, consuming which upstream outputs — and an input digest
 * so a result can be told apart from a result that is merely still on screen.
 */

export type RefKind = "file" | "skill" | "project" | "model" | "source" | "prompt" | "tool";

export type CanvasRef = {
  /** Stable within a document: `${kind}:${path ?? label}`. */
  id: string;
  kind: RefKind;
  label: string;
  path?: string;
  meta?: string;
};

export type BlockKind = "prompt" | "note" | "job" | "capture";

export type AskSource = { file?: string; path?: string; distance?: number };

export type RunStatus = "running" | "ok" | "failed" | "refused";

/** What a run produced. Discriminated so a job's console is never read as prose. */
export type RunOutput =
  | { type: "answer"; answer: string; sources: AskSource[] }
  | { type: "console"; out: string; code: number | null }
  | { type: "handoff"; text: string; via: "machine" | "queue" }
  | { type: "none" };

/**
 * The minimum record that makes a result trustworthy months later. Deliberately
 * excludes anything large: no weights, no corpus snapshot, no token logprobs.
 */
export type Provenance = {
  /** Lane the block asked for. */
  requested: string;
  /** Model the machine reports it actually used. */
  model: string;
  k?: number;
  /** Exactly the string that hit the API, after references were interpolated. */
  promptSent?: string;
  jobKey?: string;
  /** The machine's job id — lets a run be re-attached after a reload. */
  jobId?: string;
  /** Upstream block outputs this run consumed, by content hash. */
  inputs: { blockId: string; runId: string; outputHash: string }[];
  retrieval?: AskSource[];
  startedAt: string;
  ms: number;
  /** hash(prompt + model + params + upstream output hashes). Drives staleness. */
  inputDigest: string;
  outputHash: string;
};

export type Run = {
  id: string;
  blockId: string;
  status: RunStatus;
  /** Short human label: "ask", "critique · local-coder", "source 3/8", "merge". */
  label: string;
  /** Set on children of a fan-out or a critique; null for a plain run. */
  parentRunId: string | null;
  childRunIds: string[];
  /** Iteration counter within one block, for critique / retry chains. */
  attempt: number;
  output: RunOutput;
  provenance: Provenance;
  /** A refusal or failure explained in plain language. */
  note: string | null;
};

type Base = {
  id: string;
  kind: BlockKind;
  text: string;
  refs: CanvasRef[];
  collapsed?: boolean;
  /** Ids of blocks whose pinned output is fed into this one. */
  dependsOn: string[];
  /** Append-only, newest first, capped at RUN_KEEP. */
  runs: Run[];
  /** Which run this block currently "means". */
  pinnedRunId: string | null;
  /** Transient status line, not part of the record. */
  note: string | null;
};

export type PromptBlock = Base & {
  kind: "prompt";
  model: string;
  k: number;
  /** Fan out one child run per referenced corpus source, then merge. */
  fanOut: boolean;
};

export type NoteBlock = Base & { kind: "note" };

export type JobBlock = Base & { kind: "job"; jobKey: string };

export type CaptureBlock = Base & { kind: "capture" };

export type CanvasBlock = PromptBlock | NoteBlock | JobBlock | CaptureBlock;

/**
 * A named set of pins across blocks — "the cautious reading" vs "the fast one".
 * A branch is a selection, never a copy: no document merge is ever attempted,
 * because three-way merge of a tree-shaped document is not a solved problem.
 */
export type BranchSelection = {
  id: string;
  name: string;
  created: string;
  pins: Record<string, string>;
};

/**
 * Every canvas is also a project. A thought and a shipped thing are the same
 * document at different stages, so there is no second place to look.
 */
export const STAGES = ["idea", "shaping", "wip", "review", "shipped", "parked"] as const;
export type Stage = (typeof STAGES)[number];

export type CanvasDoc = {
  version: 2;
  id: string;
  title: string;
  created: string;
  updated: string;
  blocks: CanvasBlock[];
  branches: BranchSelection[];
  activeBranch: string | null;
  /** Where this piece of work has got to. A canvas at 'idea' is still a project. */
  stage: Stage;
  /** Who it is for: personal, a product, or a named client engagement. */
  entity: string;
  /** S0 · S1p · S1c · S2 · S3. Governs what may ever be handed over. */
  sensitivity: string;
  /** Skill files loaded into every run of this document. */
  skills: string[];
  /** Absolute path on the machine once the document has been written. */
  path?: string;
};


/** Runs kept per block. Older ones fall off; the pinned run never does. */
export const RUN_KEEP = 8;

export const LANES = [
  { id: "local-brain", label: "Local brain 35B", cost: "$0" },
  { id: "local-coder", label: "Local coder 27B", cost: "$0" },
  { id: "local-triage", label: "Local triage 4B", cost: "$0" },
  { id: "cloud-work", label: "Cloud work", cost: "metered" },
  { id: "cloud-deep", label: "Cloud deep", cost: "metered" },
] as const;

export const SOURCE_COUNTS = [5, 8, 12] as const;

export const JOB_KEYS: { key: string; label: string; tier: string }[] = [
  { key: "verify", label: "Self-test", tier: "T0" },
  { key: "doctor", label: "Health check", tier: "T0" },
  { key: "eval", label: "Score triage", tier: "T0" },
  { key: "report", label: "Rebuild report", tier: "T0" },
  { key: "diagnose", label: "Diagnose", tier: "T1" },
  { key: "intake", label: "Run intake", tier: "T1" },
  { key: "ingest", label: "Ingest documents", tier: "T1" },
  { key: "backup", label: "Back up now", tier: "T1" },
  { key: "summarise", label: "Write memory note", tier: "T1" },
  { key: "repair", label: "Repair to known-good", tier: "T1" },
];

export const REF_LABEL: Record<RefKind, string> = {
  file: "file",
  skill: "skill",
  project: "project",
  model: "model",
  source: "corpus",
  prompt: "prompt",
  tool: "tool",
};

let counter = 0;
/** Ids are generated on interaction, never at module scope. */
export function newId(prefix: string) {
  counter += 1;
  return `${prefix}-${Date.now().toString(36)}-${counter.toString(36)}`;
}

export function emptyBlock(kind: BlockKind): CanvasBlock {
  const base = {
    id: newId(kind),
    text: "",
    refs: [] as CanvasRef[],
    dependsOn: [] as string[],
    runs: [] as Run[],
    pinnedRunId: null,
    note: null,
  };
  if (kind === "prompt")
    return { ...base, kind: "prompt", model: LANES[0].id, k: 8, fanOut: false };
  if (kind === "job") return { ...base, kind: "job", jobKey: "verify" };
  if (kind === "capture") return { ...base, kind: "capture" };
  return { ...base, kind: "note" };
}

export function emptyDoc(title = "Untitled canvas"): CanvasDoc {
  const now = new Date().toISOString();
  return {
    version: 2,
    id: newId("doc"),
    title,
    created: now,
    updated: now,
    blocks: [emptyBlock("prompt")],
    branches: [],
    activeBranch: null,
    stage: "idea",
    entity: "personal",
    sensitivity: "S1p",
    skills: [],
  };

}

/** The run a block currently means, or null when it has never been run. */
export function pinnedRun(block: CanvasBlock): Run | null {
  if (!block.pinnedRunId) return block.runs[0] ?? null;
  return block.runs.find((run) => run.id === block.pinnedRunId) ?? block.runs[0] ?? null;
}

/** Plain text of a run's output, for feeding downstream and for hashing. */
export function runText(run: Run | null): string {
  if (!run) return "";
  const output = run.output;
  if (output.type === "answer") return output.answer;
  if (output.type === "console") return output.out;
  if (output.type === "handoff") return output.text;
  return "";
}

/** Defensive read: a document on disk may predate any field added since. */
export function normaliseDoc(raw: unknown, path?: string): CanvasDoc | null {
  if (!raw || typeof raw !== "object") return null;
  const value = raw as Partial<CanvasDoc> & Record<string, unknown>;
  if (!Array.isArray(value.blocks)) return null;
  const blocks = value.blocks
    .map((block) => normaliseBlock(block))
    .filter((block): block is CanvasBlock => block !== null);
  const ids = new Set(blocks.map((block) => block.id));
  // A dependency on a block that no longer exists is dropped, not preserved.
  for (const block of blocks) block.dependsOn = block.dependsOn.filter((id) => ids.has(id));
  return {
    version: 2,
    id: typeof value.id === "string" ? value.id : newId("doc"),
    title: typeof value.title === "string" && value.title.trim() ? value.title : "Untitled canvas",
    created: typeof value.created === "string" ? value.created : new Date().toISOString(),
    updated: typeof value.updated === "string" ? value.updated : new Date().toISOString(),
    blocks: blocks.length ? blocks : [emptyBlock("prompt")],
    branches: Array.isArray(value.branches) ? (value.branches as BranchSelection[]).filter(isBranch) : [],
    activeBranch: typeof value.activeBranch === "string" ? value.activeBranch : null,
    stage: (STAGES as readonly string[]).includes(value.stage as string)
      ? (value.stage as Stage)
      : "idea",
    entity: typeof value.entity === "string" && value.entity ? value.entity : "personal",
    sensitivity:
      typeof value.sensitivity === "string" && value.sensitivity ? value.sensitivity : "S1p",
    skills: Array.isArray(value.skills)
      ? (value.skills as unknown[]).filter((item): item is string => typeof item === "string")
      : [],
    path,
  };

}

function isBranch(value: unknown): value is BranchSelection {
  if (!value || typeof value !== "object") return false;
  const branch = value as Record<string, unknown>;
  return typeof branch.id === "string" && typeof branch.name === "string" && !!branch.pins;
}

function normaliseBlock(raw: unknown): CanvasBlock | null {
  if (!raw || typeof raw !== "object") return null;
  const value = raw as Record<string, unknown>;
  const kind = value.kind;
  if (kind !== "prompt" && kind !== "note" && kind !== "job" && kind !== "capture") return null;
  const id = typeof value.id === "string" ? value.id : newId(kind);
  const runs = Array.isArray(value.runs)
    ? (value.runs as unknown[]).map((run) => normaliseRun(run, id)).filter((run): run is Run => run !== null)
    : migrateV1Runs(value, kind, id);
  const base = {
    id,
    text: typeof value.text === "string" ? value.text : "",
    refs: Array.isArray(value.refs) ? (value.refs as CanvasRef[]).filter(isRef) : [],
    collapsed: value.collapsed === true,
    dependsOn: Array.isArray(value.dependsOn)
      ? (value.dependsOn as unknown[]).filter((item): item is string => typeof item === "string")
      : [],
    runs,
    pinnedRunId:
      typeof value.pinnedRunId === "string" ? value.pinnedRunId : (runs[0]?.id ?? null),
    note: typeof value.note === "string" ? value.note : null,
  };
  if (kind === "prompt") {
    return {
      ...base,
      kind,
      model: typeof value.model === "string" ? value.model : LANES[0].id,
      k: typeof value.k === "number" ? value.k : 8,
      fanOut: value.fanOut === true,
    };
  }
  if (kind === "job") {
    return { ...base, kind, jobKey: typeof value.jobKey === "string" ? value.jobKey : "verify" };
  }
  if (kind === "capture") return { ...base, kind };
  return { ...base, kind: "note" };
}

/**
 * v1 stored one result per block inline. Read it forward as a single historical
 * run so nothing written before this schema is lost — its digest is empty, so
 * it reads as stale until re-run, which is the honest answer.
 */
function migrateV1Runs(value: Record<string, unknown>, kind: BlockKind, blockId: string): Run[] {
  const at = typeof value.at === "string" ? value.at : null;
  const legacy = value.result as Record<string, unknown> | null | undefined;

  const shell = (output: RunOutput, startedAt: string, model: string, extra: Partial<Provenance>): Run => ({
    id: newId("run"),
    blockId,
    status: "ok",
    label: "before this document kept history",
    parentRunId: null,
    childRunIds: [],
    attempt: 1,
    output,
    provenance: {
      requested: model,
      model,
      inputs: [],
      startedAt,
      ms: 0,
      inputDigest: "",
      outputHash: "",
      ...extra,
    },
    note: null,
  });

  if (kind === "prompt" && legacy && typeof legacy.answer === "string") {
    const sources = Array.isArray(legacy.sources) ? (legacy.sources as AskSource[]) : [];
    const model = typeof legacy.model === "string" ? legacy.model : LANES[0].id;
    return [
      shell(
        { type: "answer", answer: legacy.answer, sources },
        typeof legacy.at === "string" ? legacy.at : new Date().toISOString(),
        model,
        {
          k: typeof legacy.askedK === "number" ? legacy.askedK : undefined,
          retrieval: sources,
          ms: typeof legacy.seconds === "number" ? legacy.seconds * 1000 : 0,
        },
      ),
    ];
  }

  if (kind === "job" && typeof value.out === "string" && value.out) {
    const jobKey = typeof value.jobKey === "string" ? value.jobKey : "verify";
    return [
      shell(
        { type: "console", out: value.out, code: typeof value.code === "number" ? value.code : null },
        at ?? new Date().toISOString(),
        jobKey,
        { jobKey },
      ),
    ];
  }

  if (kind === "capture" && typeof value.sentAt === "string") {
    return [
      shell(
        { type: "handoff", text: typeof value.text === "string" ? value.text : "", via: "machine" },
        value.sentAt,
        "handoff",
        {},
      ),
    ];
  }

  return [];
}

function normaliseRun(raw: unknown, blockId: string): Run | null {
  if (!raw || typeof raw !== "object") return null;
  const value = raw as Record<string, unknown>;
  if (typeof value.id !== "string") return null;
  const provenance = (value.provenance ?? {}) as Partial<Provenance>;
  const status = value.status;
  return {
    id: value.id,
    blockId: typeof value.blockId === "string" ? value.blockId : blockId,
    // A run that was in flight when the document was last written did not
    // survive the reload; it is recorded as failed rather than left spinning.
    status:
      status === "ok" || status === "failed" || status === "refused"
        ? status
        : ("failed" as RunStatus),
    label: typeof value.label === "string" ? value.label : "run",
    parentRunId: typeof value.parentRunId === "string" ? value.parentRunId : null,
    childRunIds: Array.isArray(value.childRunIds)
      ? (value.childRunIds as unknown[]).filter((item): item is string => typeof item === "string")
      : [],
    attempt: typeof value.attempt === "number" ? value.attempt : 1,
    output: (value.output as RunOutput) ?? { type: "none" },
    provenance: {
      requested: typeof provenance.requested === "string" ? provenance.requested : "—",
      model: typeof provenance.model === "string" ? provenance.model : "—",
      k: typeof provenance.k === "number" ? provenance.k : undefined,
      promptSent: typeof provenance.promptSent === "string" ? provenance.promptSent : undefined,
      jobKey: typeof provenance.jobKey === "string" ? provenance.jobKey : undefined,
      jobId: typeof provenance.jobId === "string" ? provenance.jobId : undefined,
      inputs: Array.isArray(provenance.inputs) ? provenance.inputs : [],
      retrieval: Array.isArray(provenance.retrieval) ? provenance.retrieval : undefined,
      startedAt:
        typeof provenance.startedAt === "string" ? provenance.startedAt : new Date().toISOString(),
      ms: typeof provenance.ms === "number" ? provenance.ms : 0,
      inputDigest: typeof provenance.inputDigest === "string" ? provenance.inputDigest : "",
      outputHash: typeof provenance.outputHash === "string" ? provenance.outputHash : "",
    },
    note: typeof value.note === "string" ? value.note : null,
  };
}

function isRef(value: unknown): value is CanvasRef {
  if (!value || typeof value !== "object") return false;
  const ref = value as Record<string, unknown>;
  return typeof ref.id === "string" && typeof ref.label === "string" && typeof ref.kind === "string";
}
