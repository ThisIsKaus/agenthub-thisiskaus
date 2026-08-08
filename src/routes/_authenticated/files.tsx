import { createFileRoute } from "@tanstack/react-router";
import { Page } from "@/components/Page";
import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import { Empty, Skeleton } from "@/components/data";
import { LocalOnly } from "@/components/LocalOnly";
import { isRefusal, useLocal } from "@/lib/local-bridge";
import { toNum } from "@/lib/format";
import { useIsMobile } from "@/hooks/use-mobile";

export const Route = createFileRoute("/_authenticated/files")({
  head: () => ({
    meta: [
      { title: "Files — AgentHub" },
      {
        name: "description",
        content: "Browse, read and edit the machine's working folders. Local plane only.",
      },
      { property: "og:title", content: "Files — AgentHub" },
      {
        property: "og:description",
        content: "Browse, read and edit the machine's working folders. Local plane only.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: () => (
    <Page title="Files" footer="Files · read over loopback, never copied to the cloud">
      <LocalOnly>
        <FilesPage />
      </LocalOnly>
    </Page>
  ),
});

type FileEntry = {
  name: string;
  path: string;
  size?: number;
  modified?: string;
  editable?: boolean;
  sensitivity?: string;
};
type Dir = { name?: string; path: string };
type Tree = { root?: string; parent?: string | null; dirs?: (Dir | string)[]; files?: FileEntry[] };
type FileContent = {
  path: string;
  name: string;
  raw: string;
  html?: string;
  editable?: boolean;
  size?: number;
  modified?: string;
  sensitivity?: string;
};
type Roots =
  | { roots?: (string | { name?: string; path: string })[] }
  | (string | { name?: string; path: string })[];

/** One node's loaded children, or why they could not be loaded. */
type NodeState =
  | { status: "loading" }
  | { status: "ready"; dirs: { name: string; path: string }[]; files: FileEntry[] }
  | { status: "error"; message: string; refused: boolean };

const EXECUTABLE = /\.(py|sh|plist)$/i;

function bytes(value: unknown) {
  const size = toNum(value);
  if (size == null) return "";
  if (size < 1024) return `${size} B`;
  if (size < 1024 * 1024) return `${(size / 1024).toFixed(1)} KB`;
  return `${(size / (1024 * 1024)).toFixed(1)} MB`;
}

function stamp(value: string | undefined) {
  if (!value) return "";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleString(undefined, {
    month: "short",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  });
}

function dirOf(entry: Dir | string) {
  return typeof entry === "string"
    ? { name: entry.split("/").filter(Boolean).pop() ?? entry, path: entry }
    : { name: entry.name ?? entry.path.split("/").filter(Boolean).pop() ?? entry.path, path: entry.path };
}

function byName(a: { name: string }, b: { name: string }) {
  return a.name.localeCompare(b.name, undefined, { numeric: true, sensitivity: "base" });
}

/** "OpenClaw / 03-Knowledge-Base" — the folder trail, root-relative where we can tell. */
function trailOf(path: string, roots: { name: string; path: string }[]) {
  const root = roots
    .filter((r) => path.startsWith(r.path))
    .sort((a, b) => b.path.length - a.path.length)[0];
  const rest = root ? path.slice(root.path.length) : path;
  const parts = rest.split("/").filter(Boolean);
  parts.pop();
  return [root?.name, ...parts].filter(Boolean).join(" / ");
}

function FilesPage() {
  const local = useLocal();
  const mobile = useIsMobile();
  const [roots, setRoots] = useState<{ name: string; path: string }[]>([]);
  const [rootsLoading, setRootsLoading] = useState(true);
  const [nodes, setNodes] = useState<Record<string, NodeState>>({});
  const [expanded, setExpanded] = useState<string[]>([]);
  const [selected, setSelected] = useState<string | null>(null);
  const [file, setFile] = useState<FileContent | null>(null);
  const [draft, setDraft] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const [dragging, setDragging] = useState(false);
  const [railOpen, setRailOpen] = useState(false);
  const viewerRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const data = await local.get<Roots>("/api/roots");
        const list = Array.isArray(data) ? data : (data.roots ?? []);
        const mapped = list.map((entry) => dirOf(entry as Dir | string));
        if (!cancelled) setRoots(mapped);
      } catch {
        if (!cancelled) setRoots([]);
      } finally {
        if (!cancelled) setRootsLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [local]);

  /** Loads exactly one level. Children of children are never prefetched. */
  const loadNode = useCallback(
    async (path: string) => {
      setNodes((current) => ({ ...current, [path]: { status: "loading" } }));
      try {
        const data = await local.get<Tree>("/api/tree", { path });
        setNodes((current) => ({
          ...current,
          [path]: {
            status: "ready",
            dirs: (data.dirs ?? []).map(dirOf).sort(byName),
            files: [...(data.files ?? [])].sort(byName),
          },
        }));
      } catch (error) {
        setNodes((current) => ({
          ...current,
          [path]: {
            status: "error",
            refused: isRefusal(error),
            message: isRefusal(error)
              ? "outside the allowlist"
              : error instanceof Error
                ? error.message || "could not read this folder"
                : "could not read this folder",
          },
        }));
      }
    },
    [local],
  );

  const toggleDir = useCallback(
    (path: string) => {
      setExpanded((current) => {
        if (current.includes(path)) return current.filter((entry) => entry !== path);
        return [...current, path];
      });
      setNodes((current) => {
        const existing = current[path];
        if (!existing || existing.status === "error") void loadNode(path);
        return current;
      });
    },
    [loadNode],
  );

  const openFile = useCallback(
    async (entry: FileEntry) => {
      setSelected(entry.path);
      setDraft(null);
      setNote(null);
      if (mobile) setRailOpen(false);
      viewerRef.current?.scrollTo({ top: 0 });
      try {
        const data = await local.get<FileContent>("/api/file", { path: entry.path });
        setFile({ size: entry.size, modified: entry.modified, ...data });
        viewerRef.current?.scrollTo({ top: 0 });
      } catch (error) {
        setFile(null);
        setNote(
          isRefusal(error)
            ? "outside the allowlist"
            : "could not open that file",
        );
      }
    },
    [local, mobile],
  );

  const refresh = useCallback(
    async (path: string) => {
      if (nodes[path]) await loadNode(path);
    },
    [loadNode, nodes],
  );

  const activeFolder =
    selected?.slice(0, selected.lastIndexOf("/")) ?? expanded[expanded.length - 1] ?? roots[0]?.path ?? null;

  async function save() {
    if (!file || draft === null) return;
    setNote("saving on the machine…");
    try {
      await local.post("/api/file/save", { path: file.path, content: draft });
      setFile({ ...file, raw: draft, html: undefined });
      setDraft(null);
      setNote("saved");
    } catch (error) {
      setNote(
        isRefusal(error)
          ? "outside the allowlist"
          : "the machine did not save that file",
      );
    }
  }

  async function remove(path: string, name: string) {
    setNote("awaiting approval on the machine…");
    try {
      await local.post("/api/file/delete", { path });
      setNote(`deleted ${name}`);
      if (file?.path === path) {
        setFile(null);
        setSelected(null);
      }
      const parent = path.slice(0, path.lastIndexOf("/"));
      await refresh(parent);
    } catch (error) {
      setNote(
        isRefusal(error) ? "outside the allowlist" : "the machine did not delete that file",
      );
    }
  }

  async function create(kind: "file" | "folder") {
    const name = window.prompt(kind === "file" ? "New file name" : "New folder name");
    if (!name || !activeFolder) return;
    setNote("awaiting approval on the machine…");
    try {
      await local.post("/api/file/new", { path: activeFolder, name, kind });
      setNote(`created ${name}`);
      await refresh(activeFolder);
    } catch (error) {
      setNote(isRefusal(error) ? "outside the allowlist" : "the machine did not create that");
    }
  }

  async function upload(files: FileList) {
    if (!activeFolder) return;
    setNote("awaiting approval on the machine…");
    try {
      for (const item of Array.from(files)) {
        await local.post("/api/upload", { path: activeFolder, file: item });
      }
      setNote(`uploaded ${files.length} file${files.length === 1 ? "" : "s"}`);
      await refresh(activeFolder);
    } catch (error) {
      setNote(
        isRefusal(error) ? "outside the allowlist" : "the machine did not accept that upload",
      );
    }
  }

  const rail = (
    <div
      onDragOver={(event) => {
        event.preventDefault();
        setDragging(true);
      }}
      onDragLeave={() => setDragging(false)}
      onDrop={(event) => {
        event.preventDefault();
        setDragging(false);
        if (event.dataTransfer.files.length) void upload(event.dataTransfer.files);
      }}
      className={`flex h-full flex-col ${dragging ? "bg-panel2" : ""}`}
    >
      <div className="flex items-center gap-2 border-b border-rule px-3 py-2">
        <span className="mono-label text-faint">Tree</span>
        <div className="ml-auto flex gap-2">
          <SmallButton onClick={() => void create("file")}>New file</SmallButton>
          <SmallButton onClick={() => void create("folder")}>New folder</SmallButton>
        </div>
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto py-1" data-testid="files-rail-scroll">
        {rootsLoading ? (
          <div className="space-y-2 p-3">
            {Array.from({ length: 5 }).map((_, index) => (
              <Skeleton key={index} className="h-4 w-full" />
            ))}
          </div>
        ) : roots.length === 0 ? (
          <div className="p-3">
            <Empty>No roots exposed by the machine.</Empty>
          </div>
        ) : (
          <ul>
            {roots.map((root) => (
              <DirNode
                key={root.path}
                name={root.name}
                path={root.path}
                depth={0}
                nodes={nodes}
                expanded={expanded}
                selected={selected}
                onToggle={toggleDir}
                onOpenFile={openFile}
              />
            ))}
          </ul>
        )}
      </div>
      <p className="border-t border-rule px-3 py-2 font-mono text-[10px] text-faint">
        Drop files here to add them to the open folder.
      </p>
    </div>
  );

  const viewer = (
    <div ref={viewerRef} className="h-full min-w-0 overflow-y-auto px-5 py-4">
      {!file ? (
        <p className="text-[13px] text-muted-foreground">Select a file to read it.</p>
      ) : (
        <>
          <p className="font-mono text-[10px] text-faint">{trailOf(file.path, roots) || "—"}</p>
          <h2 className="mt-1 break-all font-serif text-[25px] leading-[1.15] text-paper">
            {file.name}
          </h2>
          <p className="mt-1 font-mono text-[10px] text-faint">
            {[bytes(file.size), stamp(file.modified), file.sensitivity]
              .filter(Boolean)
              .join(" · ") || "—"}
          </p>

          <div className="mt-4">
            {draft !== null ? (
              <>
                <textarea
                  value={draft}
                  onChange={(event) => setDraft(event.target.value)}
                  rows={22}
                  className="w-full resize-none border border-rule bg-panel2 px-3 py-3 font-mono text-[12px] leading-relaxed text-paper outline-none focus:border-copper"
                />
                <div className="mt-2 flex gap-2">
                  <SmallButton onClick={() => void save()}>Save</SmallButton>
                  <SmallButton onClick={() => setDraft(null)}>Cancel</SmallButton>
                </div>
              </>
            ) : file.html ? (
              <div
                className="prose-agenthub text-[14px] leading-[1.8] text-paper"
                // Rendered markup comes from the machine's own API over loopback.
                dangerouslySetInnerHTML={{ __html: file.html }}
              />
            ) : (
              <pre className="whitespace-pre-wrap break-words font-mono text-[12px] leading-relaxed text-paper">
                {file.raw}
              </pre>
            )}
          </div>

          {draft === null && (
            <div className="mt-4 flex gap-2 border-t border-rule pt-3">
              {file.editable === false || EXECUTABLE.test(file.name) ? (
                <span className="font-mono text-[10px] text-faint">
                  read-only — executable files are not editable by design
                </span>
              ) : (
                <SmallButton onClick={() => setDraft(file.raw)}>Edit</SmallButton>
              )}
              <SmallButton onClick={() => void remove(file.path, file.name)}>Delete</SmallButton>
            </div>
          )}
        </>
      )}
    </div>
  );

  if (mobile) {
    return (
      <div className="space-y-3">
        <div className="border border-rule bg-panel">
          <button
            type="button"
            aria-expanded={railOpen}
            onClick={() => setRailOpen((open) => !open)}
            className="flex w-full items-center gap-2 px-3 py-2.5 text-left"
          >
            <span
              aria-hidden
              className={`text-copper transition-transform duration-150 motion-reduce:transition-none ${railOpen ? "rotate-90" : ""}`}
            >
              ›
            </span>
            <span className="text-[13px] text-paper">Tree</span>
          </button>
          {railOpen ? <div className="max-h-[60vh] border-t border-rule">{rail}</div> : null}
        </div>
        <div className="border border-rule bg-panel">{viewer}</div>
        {note && <p className="font-mono text-[10px] text-faint">{note}</p>}
      </div>
    );
  }

  return (
    <div className="space-y-3">
      <div className="flex h-[70vh] border border-rule bg-panel">
        <div
          data-testid="files-rail"
          className="h-full w-[20%] min-w-[240px] shrink-0 border-r border-rule"
        >
          {rail}
        </div>
        <div className="min-w-0 flex-1">{viewer}</div>
      </div>
      {note && <p className="font-mono text-[10px] text-faint">{note}</p>}
    </div>
  );
}

function DirNode({
  name,
  path,
  depth,
  nodes,
  expanded,
  selected,
  onToggle,
  onOpenFile,
}: {
  name: string;
  path: string;
  depth: number;
  nodes: Record<string, NodeState>;
  expanded: string[];
  selected: string | null;
  onToggle: (path: string) => void;
  onOpenFile: (entry: FileEntry) => void;
}) {
  const open = expanded.includes(path);
  const state = nodes[path];
  const indent = 8 + depth * 16;

  return (
    <li>
      <button
        type="button"
        aria-expanded={open}
        title={name}
        onClick={() => onToggle(path)}
        className="flex w-full items-center gap-1.5 py-1 pr-2 text-left hover:text-copper"
        style={{ paddingLeft: indent }}
      >
        <span
          aria-hidden
          className={`shrink-0 text-copper transition-transform duration-150 motion-reduce:transition-none ${open ? "rotate-90" : ""}`}
        >
          ›
        </span>
        <span className="truncate text-[13px] text-paper">{name}</span>
      </button>

      {state?.status === "error" && (
        <p
          style={{ paddingLeft: indent + 18 }}
          className={`py-0.5 pr-2 font-mono text-[10px] ${state.refused ? "text-faint" : "text-risk"}`}
        >
          {state.message}
        </p>
      )}

      {open && (
        <>
          {state?.status === "loading" && (
            <p
              style={{ paddingLeft: indent + 18 }}
              className="py-0.5 font-mono text-[10px] text-faint"
            >
              reading…
            </p>
          )}
          {state?.status === "ready" && (
            <>
              {state.dirs.length === 0 && state.files.length === 0 ? (
                <p
                  style={{ paddingLeft: indent + 18 }}
                  className="py-0.5 font-mono text-[10px] text-faint"
                >
                  empty
                </p>
              ) : (
                <ul>
                  {state.dirs.map((dir) => (
                    <DirNode
                      key={dir.path}
                      name={dir.name}
                      path={dir.path}
                      depth={depth + 1}
                      nodes={nodes}
                      expanded={expanded}
                      selected={selected}
                      onToggle={onToggle}
                      onOpenFile={onOpenFile}
                    />
                  ))}
                  {state.files.map((entry) => {
                    const readOnly = entry.editable === false || EXECUTABLE.test(entry.name);
                    const active = selected === entry.path;
                    return (
                      <li key={entry.path}>
                        <button
                          type="button"
                          title={entry.name}
                          onClick={() => onOpenFile(entry)}
                          style={{ paddingLeft: indent + 18 - (active ? 2 : 0) }}
                          className={`flex w-full items-center py-1 pr-2 text-left ${
                            active ? "border-l-2 border-copper" : ""
                          }`}
                        >
                          <span
                            className={`truncate text-[13px] ${
                              active ? "text-copper" : readOnly ? "text-faint" : "text-paper"
                            }`}
                          >
                            {entry.name}
                          </span>
                        </button>
                      </li>
                    );
                  })}
                </ul>
              )}
            </>
          )}
        </>
      )}
    </li>
  );
}

function SmallButton({ children, onClick }: { children: ReactNode; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="border border-rule px-2 py-1 font-mono text-[10px] uppercase tracking-[0.27em] text-muted-foreground hover:border-copper hover:text-copper"
    >
      {children}
    </button>
  );
}
