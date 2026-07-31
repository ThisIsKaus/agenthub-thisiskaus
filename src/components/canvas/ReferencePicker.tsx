import { useEffect, useMemo, useRef, useState } from "react";
import { useReferenceCatalogue, useTree } from "@/lib/canvas-refs";
import { REF_LABEL, type CanvasRef, type RefKind } from "@/lib/canvas-types";

const TABS: { id: RefKind; label: string }[] = [
  { id: "file", label: "Files" },
  { id: "skill", label: "Skills" },
  { id: "project", label: "Projects" },
  { id: "source", label: "Corpus" },
  { id: "model", label: "Models" },
  { id: "prompt", label: "Prompts" },
  { id: "tool", label: "Tools" },
];

export function RefChip({
  reference,
  onRemove,
}: {
  reference: CanvasRef;
  onRemove?: () => void;
}) {
  return (
    <span
      className="inline-flex max-w-full items-center gap-1.5 border border-rule bg-panel2 px-2 py-[3px] font-mono text-[10.5px] text-muted-foreground"
      title={reference.path ?? reference.label}
      data-testid="ref-chip"
    >
      <span className="text-copper">{REF_LABEL[reference.kind]}</span>
      <span className="truncate text-paper">{reference.label}</span>
      {onRemove && (
        <button
          type="button"
          onClick={onRemove}
          aria-label={`Remove reference ${reference.label}`}
          className="text-faint transition-colors hover:text-risk"
        >
          ×
        </button>
      )}
    </span>
  );
}

function Row({
  reference,
  selected,
  onPick,
}: {
  reference: CanvasRef;
  selected: boolean;
  onPick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onPick}
      data-testid="ref-option"
      className={`flex w-full items-baseline justify-between gap-3 border-t border-rule px-3 py-2 text-left first:border-t-0 hover:bg-panel2 ${
        selected ? "text-copper" : "text-paper"
      }`}
    >
      <span className="min-w-0 flex-1 truncate font-mono text-[12px]">{reference.label}</span>
      {reference.meta && (
        <span className="shrink-0 font-mono text-[10px] text-faint">{reference.meta}</span>
      )}
    </button>
  );
}

function FileBrowser({
  query,
  selectedIds,
  onPick,
}: {
  query: string;
  selectedIds: Set<string>;
  onPick: (reference: CanvasRef) => void;
}) {
  const { roots } = useReferenceCatalogue();
  const [path, setPath] = useState<string | null>(null);
  const tree = useTree(path);

  const filter = query.trim().toLowerCase();
  const dirs = (tree.data?.dirs ?? []).filter((dir) => dir.name.toLowerCase().includes(filter));
  const files = (tree.data?.files ?? []).filter((file) => file.name.toLowerCase().includes(filter));

  if (path === null) {
    return (
      <div>
        {roots.length === 0 && (
          <p className="px-3 py-3 font-mono text-[11px] text-faint">no readable roots</p>
        )}
        {roots.map((root) => (
          <button
            key={root.path}
            type="button"
            onClick={() => setPath(root.path)}
            className="flex w-full items-baseline gap-2 border-t border-rule px-3 py-2 text-left first:border-t-0 hover:bg-panel2"
          >
            <span className="font-mono text-[12px] text-paper">{root.name}/</span>
          </button>
        ))}
      </div>
    );
  }

  return (
    <div>
      <div className="flex items-center gap-3 border-b border-rule px-3 py-2">
        <button
          type="button"
          onClick={() => setPath(tree.data?.parent ? tree.data.parent : null)}
          className="font-mono text-[10px] uppercase tracking-[0.14em] text-faint hover:text-copper"
        >
          ↑ up
        </button>
        <span className="truncate font-mono text-[10px] text-faint">{tree.data?.root ?? path}</span>
      </div>
      {tree.isLoading && <p className="px-3 py-3 font-mono text-[11px] text-faint">reading…</p>}
      {tree.isError && (
        <p className="px-3 py-3 font-mono text-[11px] text-faint">
          the machine did not list that folder
        </p>
      )}
      {dirs.map((dir) => (
        <button
          key={dir.path}
          type="button"
          disabled={dir.gated}
          onClick={() => setPath(dir.path)}
          className="flex w-full items-baseline justify-between gap-3 border-t border-rule px-3 py-2 text-left first:border-t-0 hover:bg-panel2 disabled:opacity-40"
        >
          <span className="truncate font-mono text-[12px] text-paper">{dir.name}/</span>
          {dir.gated && <span className="font-mono text-[10px] text-watch">gated</span>}
        </button>
      ))}
      {files.map((file) => {
        const reference: CanvasRef = {
          id: `file:${file.path}`,
          kind: "file",
          label: file.name,
          path: file.path,
          meta: file.modified,
        };
        return (
          <Row
            key={file.path}
            reference={reference}
            selected={selectedIds.has(reference.id)}
            onPick={() => onPick(reference)}
          />
        );
      })}
      {!tree.isLoading && dirs.length === 0 && files.length === 0 && (
        <p className="px-3 py-3 font-mono text-[11px] text-faint">nothing here</p>
      )}
    </div>
  );
}

/**
 * The reference palette. It resolves live against the machine — a reference is
 * a pointer to something that exists, never a string the user typed from memory.
 */
export function ReferencePicker({
  open,
  selected,
  onPick,
  onClose,
  initialQuery = "",
}: {
  open: boolean;
  selected: CanvasRef[];
  onPick: (reference: CanvasRef) => void;
  onClose: () => void;
  initialQuery?: string;
}) {
  const catalogue = useReferenceCatalogue();
  const [tab, setTab] = useState<RefKind>("file");
  const [query, setQuery] = useState(initialQuery);
  const input = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (open) {
      setQuery(initialQuery);
      window.setTimeout(() => input.current?.focus(), 0);
    }
  }, [open, initialQuery]);

  const selectedIds = useMemo(() => new Set(selected.map((item) => item.id)), [selected]);

  const list = useMemo(() => {
    const byTab: Record<RefKind, CanvasRef[]> = {
      file: [],
      skill: catalogue.skills,
      project: catalogue.projects,
      source: catalogue.sources,
      model: catalogue.models,
      prompt: catalogue.prompts,
      tool: catalogue.tools,
    };
    const filter = query.trim().toLowerCase();
    return byTab[tab].filter(
      (item) =>
        !filter ||
        item.label.toLowerCase().includes(filter) ||
        (item.meta ?? "").toLowerCase().includes(filter),
    );
  }, [catalogue, tab, query]);

  if (!open) return null;

  return (
    <div
      className="mt-2 border border-copper bg-panel"
      data-testid="ref-picker"
      onKeyDown={(event) => {
        if (event.key === "Escape") {
          event.stopPropagation();
          onClose();
        }
      }}
    >
      <div className="flex items-center gap-2 border-b border-rule px-3 py-2">
        <input
          ref={input}
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder="Find a reference…"
          aria-label="Find a reference"
          className="w-full bg-transparent font-mono text-[12px] text-paper outline-none placeholder:text-faint"
        />
        <button
          type="button"
          onClick={onClose}
          className="font-mono text-[10px] uppercase tracking-[0.14em] text-faint hover:text-copper"
        >
          close
        </button>
      </div>

      <div className="flex gap-3 overflow-x-auto border-b border-rule px-3 py-2 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
        {TABS.map((entry) => (
          <button
            key={entry.id}
            type="button"
            onClick={() => setTab(entry.id)}
            data-testid={`ref-tab-${entry.id}`}
            className={`shrink-0 font-mono text-[10px] uppercase tracking-[0.14em] ${
              tab === entry.id ? "text-copper" : "text-faint hover:text-paper"
            }`}
          >
            {entry.label}
          </button>
        ))}
      </div>

      <div className="max-h-[280px] overflow-y-auto">
        {tab === "file" ? (
          <FileBrowser query={query} selectedIds={selectedIds} onPick={onPick} />
        ) : list.length === 0 ? (
          <p className="px-3 py-3 font-mono text-[11px] text-faint">
            {catalogue.loading ? "reading the machine…" : "nothing matches"}
          </p>
        ) : (
          list.map((reference) => (
            <Row
              key={reference.id}
              reference={reference}
              selected={selectedIds.has(reference.id)}
              onPick={() => onPick(reference)}
            />
          ))
        )}
      </div>
    </div>
  );
}
