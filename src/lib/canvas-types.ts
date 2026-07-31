/**
 * The canvas is a block document. Every block is a unit of work that carries
 * its own references, runs on the machine, and keeps its own result.
 * Nothing here is ever sent to Supabase except an explicit capture block.
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

export type AskOutcome = {
  answer: string;
  model: string;
  sources: AskSource[];
  at: string;
  seconds: number;
  askedK: number;
};

type Base = {
  id: string;
  kind: BlockKind;
  text: string;
  refs: CanvasRef[];
  collapsed?: boolean;
};

export type PromptBlock = Base & {
  kind: "prompt";
  model: string;
  k: number;
  result: AskOutcome | null;
  note: string | null;
};

export type NoteBlock = Base & { kind: "note" };

export type JobBlock = Base & {
  kind: "job";
  jobKey: string;
  out: string;
  code: number | null;
  at: string | null;
  note: string | null;
};

export type CaptureBlock = Base & {
  kind: "capture";
  note: string | null;
  sentAt: string | null;
};

export type CanvasBlock = PromptBlock | NoteBlock | JobBlock | CaptureBlock;

export type CanvasDoc = {
  version: 1;
  id: string;
  title: string;
  created: string;
  updated: string;
  blocks: CanvasBlock[];
  /** Absolute path on the machine once the document has been written. */
  path?: string;
};

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
  const base = { id: newId(kind), text: "", refs: [] as CanvasRef[] };
  if (kind === "prompt")
    return { ...base, kind: "prompt", model: LANES[0].id, k: 8, result: null, note: null };
  if (kind === "job")
    return { ...base, kind: "job", jobKey: "verify", out: "", code: null, at: null, note: null };
  if (kind === "capture") return { ...base, kind: "capture", note: null, sentAt: null };
  return { ...base, kind: "note" };
}

export function emptyDoc(title = "Untitled canvas"): CanvasDoc {
  const now = new Date().toISOString();
  return {
    version: 1,
    id: newId("doc"),
    title,
    created: now,
    updated: now,
    blocks: [emptyBlock("prompt")],
  };
}

/** Defensive read: a document on disk may predate any field added since. */
export function normaliseDoc(raw: unknown, path?: string): CanvasDoc | null {
  if (!raw || typeof raw !== "object") return null;
  const value = raw as Partial<CanvasDoc>;
  if (!Array.isArray(value.blocks)) return null;
  const blocks = value.blocks
    .map((block) => normaliseBlock(block))
    .filter((block): block is CanvasBlock => block !== null);
  return {
    version: 1,
    id: typeof value.id === "string" ? value.id : newId("doc"),
    title: typeof value.title === "string" && value.title.trim() ? value.title : "Untitled canvas",
    created: typeof value.created === "string" ? value.created : new Date().toISOString(),
    updated: typeof value.updated === "string" ? value.updated : new Date().toISOString(),
    blocks: blocks.length ? blocks : [emptyBlock("prompt")],
    path,
  };
}

function normaliseBlock(raw: unknown): CanvasBlock | null {
  if (!raw || typeof raw !== "object") return null;
  const value = raw as Record<string, unknown>;
  const kind = value.kind;
  if (kind !== "prompt" && kind !== "note" && kind !== "job" && kind !== "capture") return null;
  const base = {
    id: typeof value.id === "string" ? value.id : newId(kind),
    text: typeof value.text === "string" ? value.text : "",
    refs: Array.isArray(value.refs) ? (value.refs as CanvasRef[]).filter(isRef) : [],
    collapsed: value.collapsed === true,
  };
  if (kind === "prompt") {
    return {
      ...base,
      kind,
      model: typeof value.model === "string" ? value.model : LANES[0].id,
      k: typeof value.k === "number" ? value.k : 8,
      result: (value.result as AskOutcome | null) ?? null,
      note: typeof value.note === "string" ? value.note : null,
    };
  }
  if (kind === "job") {
    return {
      ...base,
      kind,
      jobKey: typeof value.jobKey === "string" ? value.jobKey : "verify",
      out: typeof value.out === "string" ? value.out : "",
      code: typeof value.code === "number" ? value.code : null,
      at: typeof value.at === "string" ? value.at : null,
      note: typeof value.note === "string" ? value.note : null,
    };
  }
  if (kind === "capture") {
    return {
      ...base,
      kind,
      note: typeof value.note === "string" ? value.note : null,
      sentAt: typeof value.sentAt === "string" ? value.sentAt : null,
    };
  }
  return { ...base, kind: "note" };
}

function isRef(value: unknown): value is CanvasRef {
  if (!value || typeof value !== "object") return false;
  const ref = value as Record<string, unknown>;
  return typeof ref.id === "string" && typeof ref.label === "string" && typeof ref.kind === "string";
}

/**
 * References travel to the model as a short, explicit preamble. Paths are only
 * ever rendered and sent on the local plane — this string never leaves loopback.
 */
export function composeQuestion(text: string, refs: CanvasRef[]) {
  if (refs.length === 0) return text.trim();
  const lines = refs.map((ref) => `- ${REF_LABEL[ref.kind]}: ${ref.label}${ref.path ? ` (${ref.path})` : ""}`);
  return `References for this question:\n${lines.join("\n")}\n\n${text.trim()}`;
}
