import { createFileRoute } from "@tanstack/react-router";
import { Page } from "@/components/Page";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { LocalOnly } from "@/components/LocalOnly";
import { CanvasBlockCard } from "@/components/canvas/CanvasBlockCard";
import { useReferenceCatalogue } from "@/lib/canvas-refs";
import { useLocal } from "@/lib/local-bridge";
import {
  handoverCanvas,
  listCanvases,
  readCanvas,
  setCanvasState,
  writeCanvas,
  type LibraryEntry,
} from "@/lib/canvas-store";
import {
  emptyBlock,
  emptyDoc,
  STAGES,
  type BlockKind,
  type CanvasBlock,
  type CanvasDoc,
  type CanvasRef,
  type Stage,
} from "@/lib/canvas-types";

export const Route = createFileRoute("/_authenticated/canvas")({
  validateSearch: (search: Record<string, unknown>) => ({
    seed: typeof search.seed === "string" ? search.seed : undefined,
  }),
  head: () => ({
    meta: [
      { title: "Canvas — AgentHub" },
      {
        name: "description",
        content:
          "The workbench where a captured thought becomes a finished artefact: ask the corpus, critique on a second lane, and hand the result over.",
      },
      { property: "og:title", content: "Canvas — AgentHub" },
      {
        property: "og:description",
        content:
          "The workbench where a captured thought becomes a finished artefact: ask the corpus, critique on a second lane, and hand the result over.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: () => (
    <Page
      title="Canvas"
      subtitle="The one place you author rather than read. Ask the corpus inline, critique on a second lane, and hand the finished draft over."
      footer="Canvas · documents live on the machine; every save keeps the previous version"
    >
      <LocalOnly>
        <CanvasPage />
      </LocalOnly>
    </Page>
  ),
});

const ADD: { kind: BlockKind; label: string }[] = [
  { kind: "prompt", label: "Ask" },
  { kind: "note", label: "Note" },
  { kind: "job", label: "Run" },
  { kind: "capture", label: "Hand over" },
];

function stamp(iso: string | undefined) {
  if (!iso) return "—";
  const date = new Date(iso);
  return Number.isNaN(date.getTime()) ? "—" : date.toISOString().slice(0, 16).replace("T", " ");
}

function HarnessBoard({ doc }: { doc: CanvasDoc }) {
  const refs = doc.blocks.reduce((sum, block) => sum + block.refs.length, 0);
  const runs = doc.blocks.reduce((sum, block) => sum + block.runs.length, 0);
  const linked = doc.blocks.filter((block) => block.dependsOn.length > 0).length;
  const stages = [
    { n: "01", label: "Compose", detail: `${doc.blocks.length} blocks` },
    { n: "02", label: "Ground", detail: `${refs} references` },
    { n: "03", label: "Orchestrate", detail: linked ? `${linked} linked` : "sequential · fan-out" },
    { n: "04", label: "Review", detail: "critique · compare" },
    { n: "05", label: "Prove", detail: `${runs} run records` },
  ];

  return (
    <section className="border border-rule bg-panel" data-testid="harness-board">
      <div className="flex flex-wrap items-baseline justify-between gap-2 border-b border-rule px-4 py-2.5">
        <p className="font-mono text-[10px] uppercase tracking-[0.16em] text-copper">
          Execution harness
        </p>
        <p className="font-mono text-[10px] text-faint">local · append-only runs · versioned saves</p>
      </div>
      <div className="grid grid-cols-1 sm:grid-cols-5">
        {stages.map((stage, index) => (
          <div
            key={stage.n}
            className="relative border-b border-rule px-4 py-3 last:border-b-0 sm:border-b-0 sm:border-r sm:last:border-r-0"
          >
            <div className="flex items-baseline gap-2">
              <span className="font-mono text-[9px] text-copper">{stage.n}</span>
              <span className="font-mono text-[10px] uppercase tracking-[0.12em] text-paper">
                {stage.label}
              </span>
            </div>
            <p className="mt-1 font-mono text-[9.5px] text-faint">{stage.detail}</p>
            {index < stages.length - 1 && (
              <span className="absolute right-[-5px] top-1/2 z-10 hidden -translate-y-1/2 bg-panel px-0.5 font-mono text-[10px] text-copper sm:block">
                →
              </span>
            )}
          </div>
        ))}
      </div>
    </section>
  );
}

const ENTITIES = ["personal", "Agenticality", "NXI", "Envelope Collective", "client"];
const SENSITIVITIES = ["S0", "S1p", "S1c", "S2", "S3"];

/** A canvas carries its own project record: state, who it is for, how far it may travel. */
function ProjectBar({
  doc,
  onChange,
  skills,
}: {
  doc: CanvasDoc;
  onChange: (patch: Partial<CanvasDoc>) => void;
  skills: string[];
}) {
  const [open, setOpen] = useState(false);
  return (
    <section className="border border-rule bg-panel" data-testid="project-bar">
      <div className="flex flex-wrap items-center gap-2 px-4 py-2.5">
        <span className="font-mono text-[9px] uppercase tracking-[0.16em] text-faint">for</span>
        <select
          value={doc.entity}
          onChange={(event) => onChange({ entity: event.target.value })}
          aria-label="Entity"
          className="border border-rule bg-panel2 px-2 py-1 font-mono text-[10px] text-paper outline-none focus:border-copper"
        >
          {(ENTITIES.includes(doc.entity) ? ENTITIES : [doc.entity, ...ENTITIES]).map((entity) => (
            <option key={entity} value={entity}>
              {entity}
            </option>
          ))}
        </select>
        <select
          value={doc.sensitivity}
          onChange={(event) => onChange({ sensitivity: event.target.value })}
          aria-label="Sensitivity"
          className="border border-rule bg-panel2 px-2 py-1 font-mono text-[10px] text-paper outline-none focus:border-copper"
        >
          {SENSITIVITIES.map((sensitivity) => (
            <option key={sensitivity} value={sensitivity}>
              {sensitivity}
            </option>
          ))}
        </select>
        <span className="ml-auto font-mono text-[9px] text-faint">
          {["S1c", "S2", "S3"].includes(doc.sensitivity)
            ? `${doc.sensitivity} — local lanes only; the cloud lane is unavailable to this document`
            : "cloud lane permitted for this document"}
        </span>
      </div>
      <div className="flex flex-wrap items-center gap-2 border-t border-rule px-4 py-2">
        <span className="font-mono text-[9px] uppercase tracking-[0.16em] text-faint">skills</span>
        {doc.skills.length === 0 && (
          <span className="font-mono text-[10px] text-faint">none loaded</span>
        )}
        {doc.skills.map((name) => (
          <button
            key={name}
            type="button"
            onClick={() => onChange({ skills: doc.skills.filter((item) => item !== name) })}
            title="Remove from this canvas"
            className="border border-copper px-2 py-1 font-mono text-[10px] text-copper"
          >
            {name} ×
          </button>
        ))}
        <button
          type="button"
          onClick={() => setOpen((value) => !value)}
          className="border border-rule px-2 py-1 font-mono text-[10px] text-muted-foreground hover:border-copper hover:text-copper"
        >
          + skill
        </button>
        <span className="ml-auto font-mono text-[9px] text-faint">loaded into every run</span>
      </div>
      {open && (
        <div className="flex flex-wrap gap-2 border-t border-rule px-4 py-2">
          {skills.length === 0 && (
            <span className="font-mono text-[10px] text-faint">no skill files on the machine</span>
          )}
          {skills
            .filter((name) => !doc.skills.includes(name))
            .map((name) => (
              <button
                key={name}
                type="button"
                onClick={() => {
                  onChange({ skills: [...doc.skills, name] });
                  setOpen(false);
                }}
                className="border border-rule px-2 py-1 font-mono text-[10px] text-muted-foreground hover:border-copper hover:text-copper"
              >
                {name}
              </button>
            ))}
        </div>
      )}
    </section>
  );
}

function CanvasPage() {
  const local = useLocal();
  const queryClient = useQueryClient();
  const { skills: skillRefs } = useReferenceCatalogue();
  const skillNames = useMemo(() => skillRefs.map((ref) => ref.label), [skillRefs]);
  const { seed } = Route.useSearch();

  const [doc, setDoc] = useState<CanvasDoc | null>(null);
  const [saving, setSaving] = useState<string | null>(null);
  const [dirty, setDirty] = useState(false);
  const [libraryOpen, setLibraryOpen] = useState(false);
  const [historyOpen, setHistoryOpen] = useState(false);
  const [filter, setFilter] = useState<string>("all");
  const [handover, setHandover] = useState<"idle" | "confirm" | "working">("idle");
  const [handoverPath, setHandoverPath] = useState<string | null>(null);
  const timer = useRef<number | null>(null);

  const library = useQuery({
    queryKey: ["canvas", "library"],
    enabled: local.available,
    queryFn: () => listCanvases(local),
  });

  useEffect(() => {
    if (doc) return;
    const fresh = emptyDoc();
    // An item sent from the inbox arrives as the first note, already written down.
    if (seed) {
      fresh.title = seed.slice(0, 60);
      fresh.blocks = [{ ...emptyBlock("note"), text: seed }, ...fresh.blocks];
    }
    setDoc(fresh);
  }, [doc, seed]);

  const save = useCallback(
    async (next: CanvasDoc) => {
      setSaving("saving to the machine…");
      try {
        const versions = await writeCanvas(local, next);
        setDirty(false);
        setDoc((current) => (current && current.id === next.id ? { ...current, versions } : current));
        setSaving(`saved ${new Date().toISOString().slice(11, 16)}`);
        void queryClient.invalidateQueries({ queryKey: ["canvas", "library"] });
      } catch {
        setSaving("the machine did not save this canvas");
      }
    },
    [local, queryClient],
  );

  // Autosave is debounced; the document lives on the machine and nowhere else.
  useEffect(() => {
    if (!doc || !dirty) return;
    if (timer.current) window.clearTimeout(timer.current);
    timer.current = window.setTimeout(() => void save(doc), 1200);
    return () => {
      if (timer.current) window.clearTimeout(timer.current);
    };
  }, [doc, dirty, save]);

  function patchDoc(patch: Partial<CanvasDoc>) {
    setDirty(true);
    setDoc((current) => (current ? { ...current, ...patch } : current));
  }

  function patchBlock(id: string, patch: Partial<CanvasBlock>) {
    setDirty(true);
    setDoc((current) =>
      current
        ? {
            ...current,
            blocks: current.blocks.map((block) =>
              block.id === id ? ({ ...block, ...patch } as CanvasBlock) : block,
            ),
          }
        : current,
    );
  }

  /** Functional block update — safe when several runs land at once. */
  function updateBlock(id: string, updater: (block: CanvasBlock) => CanvasBlock) {
    setDirty(true);
    setDoc((current) =>
      current
        ? {
            ...current,
            blocks: current.blocks.map((block) => (block.id === id ? updater(block) : block)),
          }
        : current,
    );
  }

  function addBlock(kind: BlockKind) {
    setDirty(true);
    setDoc((current) =>
      current ? { ...current, blocks: [...current.blocks, emptyBlock(kind)] } : current,
    );
  }

  /** Insert a produced block directly beneath the one that produced it. */
  function insertAfter(id: string, block: CanvasBlock) {
    setDirty(true);
    setDoc((current) => {
      if (!current) return current;
      const index = current.blocks.findIndex((entry) => entry.id === id);
      const blocks = [...current.blocks];
      blocks.splice(index < 0 ? blocks.length : index + 1, 0, block);
      return { ...current, blocks };
    });
  }

  /** Provenance: where this draft came from, recorded once per document. */
  function addSource(reference: CanvasRef) {
    const line = reference.path ?? reference.label;
    setDoc((current) => {
      if (!current || current.sources.includes(line)) return current;
      setDirty(true);
      return { ...current, sources: [...current.sources, line] };
    });
  }

  function removeSource(line: string) {
    setDirty(true);
    setDoc((current) =>
      current ? { ...current, sources: current.sources.filter((item) => item !== line) } : current,
    );
  }

  function moveBlock(index: number, direction: -1 | 1) {
    const target = index + direction;
    setDoc((current) => {
      if (!current || target < 0 || target >= current.blocks.length) return current;
      setDirty(true);
      const blocks = [...current.blocks];
      const [held] = blocks.splice(index, 1);
      blocks.splice(target, 0, held);
      return { ...current, blocks };
    });
  }

  function removeBlock(id: string) {
    setDirty(true);
    setDoc((current) => {
      if (!current) return current;
      const blocks = current.blocks.filter((block) => block.id !== id);
      return { ...current, blocks: blocks.length ? blocks : [emptyBlock("prompt")] };
    });
  }

  function duplicateBlock(id: string) {
    setDirty(true);
    setDoc((current) => {
      if (!current) return current;
      const index = current.blocks.findIndex((block) => block.id === id);
      if (index < 0) return current;
      const source = current.blocks[index];
      const copy = { ...emptyBlock(source.kind), ...source, id: emptyBlock(source.kind).id };
      const blocks = [...current.blocks];
      blocks.splice(index + 1, 0, copy as CanvasBlock);
      return { ...current, blocks };
    });
  }

  /** The six states both filter the library and set this document's own state. */
  async function chooseState(stage: Stage) {
    if (!doc) return;
    setFilter(stage);
    patchDoc({ stage });
    try {
      await setCanvasState(local, doc.id, stage);
      void queryClient.invalidateQueries({ queryKey: ["canvas", "library"] });
    } catch {
      setSaving("the machine did not record that state");
    }
  }

  async function openCanvas(entry: LibraryEntry) {
    setSaving(null);
    setHandoverPath(null);
    try {
      const loaded = await readCanvas(local, entry.id);
      if (loaded) {
        setDirty(false);
        setDoc(loaded);
        setLibraryOpen(false);
      } else {
        setSaving("the machine did not return that document");
      }
    } catch {
      setSaving("the machine did not open that canvas");
    }
  }

  async function confirmHandover() {
    if (!doc) return;
    setHandover("working");
    setHandoverPath(null);
    try {
      if (dirty) await save(doc);
      const path = await handoverCanvas(local, doc.id);
      setHandoverPath(path ?? "copied to the inbox");
      setHandover("idle");
    } catch {
      setHandover("idle");
      setSaving("the hand-over was refused on the machine");
    }
  }

  if (!doc) return null;

  const counts = library.data?.counts ?? {};
  const documents = library.data?.documents ?? [];
  const shown = filter === "all" ? documents : documents.filter((entry) => entry.state === filter);

  return (
    <div className="space-y-4" data-testid="canvas-page">
      <ProjectBar doc={doc} onChange={patchDoc} skills={skillNames} />
      <HarnessBoard doc={doc} />

      <section className="border border-rule bg-panel">
        <div className="flex flex-wrap items-baseline gap-x-4 gap-y-2 border-b border-rule px-4 py-3">
          <input
            value={doc.title}
            data-testid="canvas-title"
            onChange={(event) => patchDoc({ title: event.target.value })}
            aria-label="Canvas title"
            className="min-w-0 flex-1 bg-transparent font-serif text-2xl leading-tight text-paper outline-none placeholder:text-faint"
            placeholder="Untitled canvas"
          />
          <button
            type="button"
            data-testid="save-canvas"
            onClick={() => void save(doc)}
            title={dirty ? "There are unsaved changes" : "Everything is saved on the machine"}
            className={`border px-3 py-1 font-mono text-[10px] uppercase tracking-[0.14em] ${
              dirty
                ? "border-copper text-copper"
                : "border-rule text-muted-foreground hover:border-copper hover:text-copper"
            }`}
          >
            {dirty ? "Save · unsaved" : "Save · saved"}
          </button>
          <button
            type="button"
            onClick={() => {
              setDirty(false);
              setDoc(emptyDoc());
              setSaving(null);
              setHandoverPath(null);
            }}
            className="border border-rule px-3 py-1 font-mono text-[10px] uppercase tracking-[0.14em] text-muted-foreground hover:border-copper hover:text-copper"
          >
            New
          </button>
          <button
            type="button"
            onClick={() => setLibraryOpen((open) => !open)}
            data-testid="toggle-library"
            className="border border-rule px-3 py-1 font-mono text-[10px] uppercase tracking-[0.14em] text-muted-foreground hover:border-copper hover:text-copper"
          >
            Library
          </button>
        </div>

        <div className="flex flex-wrap items-center gap-x-4 gap-y-1 px-4 py-2 font-mono text-[10px] text-faint">
          <span>{doc.blocks.length} blocks</span>
          <span className="tabular-nums">edited {stamp(doc.updated)}</span>
          <button
            type="button"
            data-testid="toggle-history"
            onClick={() => setHistoryOpen((open) => !open)}
            className="uppercase tracking-[0.14em] text-faint hover:text-copper"
          >
            history · <span className="tabular-nums text-paper">{doc.versions}</span>{" "}
            {doc.versions === 1 ? "version" : "versions"}
          </button>
          <span className={dirty ? "text-copper" : "text-faint"} data-testid="dirty-state">
            {dirty ? "unsaved changes" : "all changes saved"}
          </span>
          {saving && <span className="text-copper">{saving}</span>}
        </div>

        {historyOpen && (
          <p className="border-t border-rule px-4 py-3 font-mono text-[10px] leading-relaxed text-faint">
            Every save snapshots the previous version on the machine — {doc.versions} kept for this
            document, first written {stamp(doc.created)}. There are no branches: a personal draft
            workspace does not need merge semantics, and a snapshot per save is the right weight.
          </p>
        )}

        <div className="flex flex-wrap items-center gap-2 border-t border-rule px-4 py-2" data-testid="lifecycle-bar">
          <span className="font-mono text-[9px] uppercase tracking-[0.16em] text-faint">state</span>
          <button
            type="button"
            onClick={() => setFilter("all")}
            className={`border px-2 py-1 font-mono text-[10px] ${
              filter === "all" ? "border-copper text-copper" : "border-rule text-muted-foreground"
            }`}
          >
            all <span className="tabular-nums">{documents.length}</span>
          </button>
          {STAGES.map((stage) => (
            <button
              key={stage}
              type="button"
              onClick={() => void chooseState(stage)}
              title={`Set this document to ${stage} and show only ${stage} documents`}
              className={`border px-2 py-1 font-mono text-[10px] ${
                doc.stage === stage || filter === stage
                  ? "border-copper text-copper"
                  : "border-rule text-muted-foreground hover:text-paper"
              }`}
            >
              {stage} <span className="tabular-nums">{counts[stage] ?? 0}</span>
            </button>
          ))}
          <span className="ml-auto font-mono text-[9px] text-faint">
            this document is {doc.stage}
          </span>
        </div>

        {libraryOpen && (
          <div className="border-t border-rule" data-testid="canvas-library">
            {library.isLoading && (
              <p className="px-4 py-3 font-mono text-[11px] text-faint">reading the machine…</p>
            )}
            {!library.isLoading && shown.length === 0 && (
              <p className="px-4 py-3 font-mono text-[11px] text-faint">
                {documents.length === 0
                  ? "no canvases yet — the first save writes one"
                  : `no documents at ${filter} — choose all to see the other ${documents.length}`}
              </p>
            )}
            {shown.map((entry) => (
              <div
                key={entry.id}
                className="flex items-baseline justify-between gap-3 border-t border-rule px-4 py-2 first:border-t-0"
              >
                <button
                  type="button"
                  onClick={() => void openCanvas(entry)}
                  className="min-w-0 flex-1 truncate text-left font-mono text-[12px] text-paper hover:text-copper"
                >
                  {entry.title}
                </button>
                <span className="shrink-0 font-mono text-[10px] text-faint">{entry.state}</span>
                <span className="shrink-0 font-mono text-[10px] tabular-nums text-faint">
                  {typeof entry.words === "number" ? `${entry.words} w` : "—"}
                </span>
                <span className="shrink-0 font-mono text-[10px] tabular-nums text-faint">
                  {stamp(entry.updated)}
                </span>
              </div>
            ))}
          </div>
        )}
      </section>

      <div className="space-y-3">
        {doc.blocks.map((block, index) => (
          <CanvasBlockCard
            key={block.id}
            block={block}
            index={index}
            total={doc.blocks.length}
            doc={doc}
            onChange={(patch) => patchBlock(block.id, patch)}
            onUpdate={(updater) => updateBlock(block.id, updater)}
            onRemove={() => removeBlock(block.id)}
            onMove={(direction) => moveBlock(index, direction)}
            onDuplicate={() => duplicateBlock(block.id)}
            onInsertAfter={(produced) => insertAfter(block.id, produced)}
            onAddSource={addSource}
          />
        ))}
      </div>

      <div className="flex flex-wrap items-center gap-2 border border-rule bg-panel px-4 py-3">
        <span className="font-mono text-[10px] uppercase tracking-[0.16em] text-faint">add</span>
        {ADD.map((entry) => (
          <button
            key={entry.kind}
            type="button"
            data-testid={`add-${entry.kind}`}
            onClick={() => addBlock(entry.kind)}
            className="border border-rule px-3 py-1 font-mono text-[11px] text-muted-foreground hover:border-copper hover:text-copper"
          >
            {entry.label}
          </button>
        ))}
        <div className="ml-auto flex flex-wrap items-center gap-2">
          {handover === "confirm" ? (
            <>
              <span className="font-mono text-[10px] text-paper">
                This copies the document to the inbox. It becomes searchable after the next ingest
                run.
              </span>
              <button
                type="button"
                data-testid="handover-confirm"
                onClick={() => void confirmHandover()}
                className="border border-copper px-3 py-1 font-mono text-[10px] uppercase tracking-[0.14em] text-copper"
              >
                Copy it
              </button>
              <button
                type="button"
                onClick={() => setHandover("idle")}
                className="font-mono text-[10px] uppercase tracking-[0.14em] text-faint hover:text-paper"
              >
                Cancel
              </button>
            </>
          ) : (
            <button
              type="button"
              data-testid="handover"
              onClick={() => setHandover("confirm")}
              disabled={handover === "working"}
              className="border border-rule px-3 py-1 font-mono text-[10px] uppercase tracking-[0.14em] text-muted-foreground hover:border-copper hover:text-copper disabled:opacity-40"
            >
              {handover === "working" ? "handing over…" : "Hand over to inbox"}
            </button>
          )}
        </div>
      </div>

      {handoverPath && (
        <p className="border border-rule bg-panel px-4 py-2 font-mono text-[10px] text-copper" data-testid="handover-path">
          copied to {handoverPath}
        </p>
      )}

      <section className="border border-rule bg-panel" data-testid="doc-sources">
        <div className="flex flex-wrap items-baseline justify-between gap-2 border-b border-rule px-4 py-2">
          <p className="font-mono text-[10px] uppercase tracking-[0.16em] text-copper">Built from</p>
          <p className="font-mono text-[9px] text-faint">
            provenance · recorded per document, saved with it
          </p>
        </div>
        {doc.sources.length === 0 ? (
          <p className="px-4 py-3 font-mono text-[10px] text-faint">
            nothing recorded — use “+ built from” on any block to name a source
          </p>
        ) : (
          <ul className="px-4 py-2">
            {doc.sources.map((line) => (
              <li key={line} className="flex items-baseline justify-between gap-3 py-[3px]">
                <span className="min-w-0 flex-1 truncate font-mono text-[10.5px] text-muted-foreground">
                  {line}
                </span>
                <button
                  type="button"
                  onClick={() => removeSource(line)}
                  className="shrink-0 font-mono text-[10px] text-faint hover:text-risk"
                >
                  remove
                </button>
              </li>
            ))}
          </ul>
        )}
      </section>

      <p className="font-mono text-[10px] leading-relaxed text-faint">
        Canvases are written to the machine and never leave it. Hand-over is the one exception: it
        passes text out, and only when you press it.
      </p>
    </div>
  );
}
