import { createFileRoute } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { LocalOnly } from "@/components/LocalOnly";
import { PageIntro } from "@/components/data";
import { CanvasBlockCard } from "@/components/canvas/CanvasBlockCard";
import { useReferenceCatalogue } from "@/lib/canvas-refs";
import { useLocal } from "@/lib/local-bridge";
import {
  canvasDir,
  deleteCanvas,
  listCanvases,
  readCanvas,
  writeCanvas,
  type LibraryEntry,
} from "@/lib/canvas-store";
import {
  emptyBlock,
  emptyDoc,
  type BlockKind,
  type CanvasBlock,
  type CanvasDoc,
} from "@/lib/canvas-types";

export const Route = createFileRoute("/_authenticated/canvas")({
  head: () => ({
    meta: [
      { title: "Canvas — AgentHub" },
      {
        name: "description",
        content:
          "A block document that asks the corpus, runs machine jobs and hands work over, with live references to files, skills, projects and tools.",
      },
      { property: "og:title", content: "Canvas — AgentHub" },
      {
        property: "og:description",
        content:
          "A block document that asks the corpus, runs machine jobs and hands work over, with live references to files, skills, projects and tools.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: () => (
    <LocalOnly>
      <CanvasPage />
    </LocalOnly>
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

function CanvasPage() {
  const local = useLocal();
  const queryClient = useQueryClient();
  const { roots } = useReferenceCatalogue();
  const dir = useMemo(() => canvasDir(roots), [roots]);

  const [doc, setDoc] = useState<CanvasDoc | null>(null);
  const [saving, setSaving] = useState<string | null>(null);
  const [libraryOpen, setLibraryOpen] = useState(false);
  const dirty = useRef(false);
  const timer = useRef<number | null>(null);

  const library = useQuery({
    queryKey: ["canvas", "library", dir],
    enabled: Boolean(dir) && local.available,
    queryFn: () => listCanvases(local, dir as string),
  });

  useEffect(() => {
    if (!doc) setDoc(emptyDoc());
  }, [doc]);

  const save = useCallback(
    async (next: CanvasDoc) => {
      if (!dir) return;
      setSaving("saving to the machine…");
      try {
        const path = await writeCanvas(local, dir, next);
        dirty.current = false;
        setDoc((current) => (current && current.id === next.id ? { ...current, path } : current));
        setSaving(`saved ${new Date().toISOString().slice(11, 16)}`);
        void queryClient.invalidateQueries({ queryKey: ["canvas", "library", dir] });
      } catch {
        setSaving("the machine did not save this canvas");
      }
    },
    [dir, local, queryClient],
  );

  // Autosave is debounced; the document lives on the machine and nowhere else.
  useEffect(() => {
    if (!doc || !dirty.current || !dir) return;
    if (timer.current) window.clearTimeout(timer.current);
    timer.current = window.setTimeout(() => void save(doc), 1200);
    return () => {
      if (timer.current) window.clearTimeout(timer.current);
    };
  }, [doc, dir, save]);

  function patchDoc(patch: Partial<CanvasDoc>) {
    dirty.current = true;
    setDoc((current) => (current ? { ...current, ...patch } : current));
  }

  function patchBlock(id: string, patch: Partial<CanvasBlock>) {
    dirty.current = true;
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
    dirty.current = true;
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
    dirty.current = true;
    setDoc((current) =>
      current ? { ...current, blocks: [...current.blocks, emptyBlock(kind)] } : current,
    );
  }

  function moveBlock(index: number, direction: -1 | 1) {
    const target = index + direction;
    setDoc((current) => {
      if (!current || target < 0 || target >= current.blocks.length) return current;
      dirty.current = true;
      const blocks = [...current.blocks];
      const [held] = blocks.splice(index, 1);
      blocks.splice(target, 0, held);
      return { ...current, blocks };
    });
  }

  function removeBlock(id: string) {
    dirty.current = true;
    setDoc((current) => {
      if (!current) return current;
      const blocks = current.blocks.filter((block) => block.id !== id);
      return { ...current, blocks: blocks.length ? blocks : [emptyBlock("prompt")] };
    });
  }

  function duplicateBlock(id: string) {
    dirty.current = true;
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

  async function openCanvas(entry: LibraryEntry) {
    setSaving(null);
    try {
      const loaded = await readCanvas(local, entry.path);
      if (loaded) {
        dirty.current = false;
        setDoc(loaded);
        setLibraryOpen(false);
      } else {
        setSaving("that file is not a canvas");
      }
    } catch {
      setSaving("the machine did not open that canvas");
    }
  }

  async function removeCanvas(entry: LibraryEntry) {
    setSaving("awaiting approval on the machine…");
    try {
      await deleteCanvas(local, entry.path);
      setSaving("removed");
      if (doc?.path === entry.path) {
        dirty.current = false;
        setDoc(emptyDoc());
      }
      void queryClient.invalidateQueries({ queryKey: ["canvas", "library", dir] });
    } catch {
      setSaving("denied at the approval dialog");
    }
  }

  if (!doc) return null;

  return (
    <div className="space-y-4" data-testid="canvas-page">
      <PageIntro title="Canvas">
        The place to think a piece of work through: ask the corpus, run a machine job, keep notes,
        and reference files, skills, projects and tools by name — all in one document saved on the
        machine. A hand-over block is the single way anything leaves it, and only when you press it.
      </PageIntro>
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
            onClick={() => void save(doc)}
            className="border border-rule px-3 py-1 font-mono text-[10px] uppercase tracking-[0.14em] text-muted-foreground hover:border-copper hover:text-copper"
          >
            Save
          </button>
          <button
            type="button"
            onClick={() => {
              dirty.current = false;
              setDoc(emptyDoc());
              setSaving(null);
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
          <span className="truncate">{doc.path ?? (dir ? `${dir}/…` : "not yet written")}</span>
          <span className="tabular-nums">edited {stamp(doc.updated)}</span>
          {saving && <span className="text-copper">{saving}</span>}
        </div>

        {libraryOpen && (
          <div className="border-t border-rule" data-testid="canvas-library">
            {library.isLoading && (
              <p className="px-4 py-3 font-mono text-[11px] text-faint">reading the machine…</p>
            )}
            {!library.isLoading && (library.data ?? []).length === 0 && (
              <p className="px-4 py-3 font-mono text-[11px] text-faint">
                no canvases yet — the first save writes one
              </p>
            )}
            {(library.data ?? []).map((entry) => (
              <div
                key={entry.path}
                className="flex items-baseline justify-between gap-3 border-t border-rule px-4 py-2 first:border-t-0"
              >
                <button
                  type="button"
                  onClick={() => void openCanvas(entry)}
                  className="min-w-0 flex-1 truncate text-left font-mono text-[12px] text-paper hover:text-copper"
                >
                  {entry.title}
                </button>
                <span className="shrink-0 font-mono text-[10px] tabular-nums text-faint">
                  {entry.modified ?? "—"}
                </span>
                <button
                  type="button"
                  onClick={() => void removeCanvas(entry)}
                  className="shrink-0 font-mono text-[10px] uppercase tracking-[0.14em] text-faint hover:text-risk"
                >
                  remove
                </button>
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
      </div>

      <p className="font-mono text-[10px] leading-relaxed text-faint">
        Canvases are written to the machine as files and never leave it. A hand-over block is the
        one exception: it passes text out, and only when you press it.

      </p>
    </div>
  );
}
