/**
 * Canvas persistence. The machine now owns canvas storage behind /api/canvas,
 * so this module no longer writes loose files: it saves a document by id and
 * the machine snapshots the previous version on every save. That snapshotting
 * is why the canvas has no branches — history without merge semantics.
 */

import { emptyDoc, normaliseDoc, type CanvasDoc } from "@/lib/canvas-types";

type Local = {
  get: <T>(path: string, query?: Record<string, string | number | undefined>) => Promise<T>;
  post: <T>(path: string, form: Record<string, string | number | Blob | undefined>) => Promise<T>;
};

export type LibraryEntry = {
  id: string;
  title: string;
  state: string;
  updated?: string;
  words?: number;
};

export type Library = {
  documents: LibraryEntry[];
  counts: Record<string, number>;
  states: string[];
};

function str(value: unknown, fallback = ""): string {
  return typeof value === "string" && value ? value : fallback;
}

export async function listCanvases(local: Local): Promise<Library> {
  const data = await local.get<{
    documents?: unknown[];
    counts?: Record<string, unknown>;
    states?: unknown[];
  }>("/api/canvas");

  const documents = (Array.isArray(data.documents) ? data.documents : [])
    .map((entry): LibraryEntry | null => {
      const row = (entry ?? {}) as Record<string, unknown>;
      const id = str(row.id);
      if (!id) return null;
      return {
        id,
        title: str(row.title, "Untitled canvas"),
        state: str(row.state, "idea"),
        updated: typeof row.updated === "string" ? row.updated : undefined,
        words: typeof row.words === "number" ? row.words : undefined,
      };
    })
    .filter((entry): entry is LibraryEntry => entry !== null)
    .sort((a, b) => (b.updated ?? "").localeCompare(a.updated ?? ""));


  const counts: Record<string, number> = {};
  for (const [key, value] of Object.entries(data.counts ?? {})) {
    const parsed = Number(value);
    if (Number.isFinite(parsed)) counts[key] = parsed;
  }

  const states = (Array.isArray(data.states) ? data.states : []).filter(
    (item): item is string => typeof item === "string",
  );

  return { documents, counts, states };
}

/**
 * A canvas is a block document; the machine stores it as one body string. A
 * body it cannot parse is not lost — it is read forward as a single note.
 */
export async function readCanvas(local: Local, id: string): Promise<CanvasDoc | null> {
  const data = await local.get<{
    id?: string;
    title?: string;
    state?: string;
    body?: string;
    sources?: unknown;
    created?: string;
    versions?: number;
  }>("/api/canvas/doc", { id });

  const versions = typeof data.versions === "number" ? data.versions : 0;
  const sources = Array.isArray(data.sources)
    ? (data.sources as unknown[]).filter((item): item is string => typeof item === "string")
    : [];

  let doc: CanvasDoc | null = null;
  try {
    doc = normaliseDoc(JSON.parse(data.body ?? ""));
  } catch {
    doc = null;
  }
  if (!doc) {
    doc = emptyDoc(str(data.title, "Untitled canvas"));
    doc.blocks[0] = { ...doc.blocks[0], kind: "note", text: str(data.body) } as CanvasDoc["blocks"][number];
  }

  return {
    ...doc,
    id: str(data.id, id),
    title: str(data.title, doc.title),
    stage: (str(data.state, doc.stage) as CanvasDoc["stage"]) ?? doc.stage,
    created: str(data.created, doc.created),
    sources: sources.length ? sources : doc.sources,
    versions,
  };
}

/** Save the whole document. Returns the version count the machine now holds. */
export async function writeCanvas(local: Local, doc: CanvasDoc): Promise<number> {
  const payload: CanvasDoc = { ...doc, updated: new Date().toISOString() };
  const response = await local.post<{ versions?: number }>("/api/canvas/save", {
    id: doc.id,
    title: doc.title,
    body: JSON.stringify(payload, null, 2),
    state: doc.stage,
    sources: JSON.stringify(doc.sources ?? []),
  });
  return typeof response?.versions === "number" ? response.versions : doc.versions;
}

export async function setCanvasState(local: Local, id: string, state: string) {
  await local.post("/api/canvas/state", { id, state });
}

/** Copy the document into the inbox. Returns the destination path it reports. */
export async function handoverCanvas(local: Local, id: string): Promise<string | null> {
  const response = await local.post<{ path?: string; destination?: string; dest?: string }>(
    "/api/canvas/handover",
    { id },
  );
  return response?.path ?? response?.destination ?? response?.dest ?? null;
}
