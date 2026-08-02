import { createFileRoute } from "@tanstack/react-router";
import { Page } from "@/components/Page";
import { useCallback, useEffect, useState } from "react";
import { Panel } from "@/components/AppShell";
import { Empty, Skeleton } from "@/components/data";
import { LocalOnly } from "@/components/LocalOnly";
import { isRefusal, useLocal } from "@/lib/local-bridge";
import { toNum } from "@/lib/format";

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
    <Page title="Files" subtitle="Browse the allowlisted roots on the machine. Executable files are read-only by design." footer="Files · read over loopback, never copied to the cloud">
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
};
type Dir = { name?: string; path: string };
type Tree = { root?: string; parent?: string | null; dirs?: (Dir | string)[]; files?: FileEntry[] };
type FileContent = { path: string; name: string; raw: string; html?: string; editable?: boolean };
type Roots = { roots?: (string | { name?: string; path: string })[] } | (string | { name?: string; path: string })[];

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
  return typeof entry === "string" ? { name: entry.split("/").pop() ?? entry, path: entry } : entry;
}

function FilesPage() {
  const local = useLocal();
  const [roots, setRoots] = useState<{ name: string; path: string }[]>([]);
  const [path, setPath] = useState<string | null>(null);
  const [tree, setTree] = useState<Tree | null>(null);
  const [file, setFile] = useState<FileContent | null>(null);
  const [draft, setDraft] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const [dragging, setDragging] = useState(false);
  const [loadingTree, setLoadingTree] = useState(true);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const data = await local.get<Roots>("/api/roots");
        const list = Array.isArray(data) ? data : (data.roots ?? []);
        const mapped = list.map((entry) =>
          typeof entry === "string"
            ? { name: entry.split("/").filter(Boolean).pop() ?? entry, path: entry }
            : { name: entry.name ?? entry.path, path: entry.path },
        );
        if (!cancelled) {
          setRoots(mapped);
          setPath((current) => current ?? mapped[0]?.path ?? null);
        }
      } catch {
        if (!cancelled) setRoots([]);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [local]);

  const loadTree = useCallback(
    async (target: string | null) => {
      setLoadingTree(true);
      try {
        const data = await local.get<Tree>("/api/tree", { path: target ?? undefined });
        setTree(data);
      } catch (error) {
        setTree(null);
        setNote(isRefusal(error) ? error.message || "denied at the approval dialog" : null);
      } finally {
        setLoadingTree(false);
      }
    },
    [local],
  );

  useEffect(() => {
    void loadTree(path);
  }, [path, loadTree]);

  async function open(entry: FileEntry) {
    setDraft(null);
    setNote(null);
    try {
      const data = await local.get<FileContent>("/api/file", { path: entry.path });
      setFile(data);
    } catch (error) {
      setFile(null);
      setNote(
        isRefusal(error) ? error.message || "denied at the approval dialog" : "could not open that file",
      );
    }
  }

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
        isRefusal(error) ? error.message || "denied at the approval dialog" : "the machine did not save that file",
      );
    }
  }

  async function remove(entry: FileEntry) {
    setNote("awaiting approval on the machine…");
    try {
      await local.post("/api/file/delete", { path: entry.path });
      setNote(`deleted ${entry.name}`);
      if (file?.path === entry.path) setFile(null);
      await loadTree(path);
    } catch (error) {
      setNote(
        isRefusal(error) ? error.message || "denied at the approval dialog" : "the machine did not delete that file",
      );
    }
  }

  async function create(kind: "file" | "folder") {
    const name = window.prompt(kind === "file" ? "New file name" : "New folder name");
    if (!name || !path) return;
    setNote("awaiting approval on the machine…");
    try {
      await local.post("/api/file/new", { path, name, kind });
      setNote(`created ${name}`);
      await loadTree(path);
    } catch (error) {
      setNote(
        isRefusal(error) ? error.message || "denied at the approval dialog" : "the machine did not create that",
      );
    }
  }

  async function upload(files: FileList) {
    if (!path) return;
    setNote("awaiting approval on the machine…");
    try {
      for (const item of Array.from(files)) {
        await local.post("/api/upload", { path, file: item });
      }
      setNote(`uploaded ${files.length} file${files.length === 1 ? "" : "s"}`);
      await loadTree(path);
    } catch (error) {
      setNote(
        isRefusal(error) ? error.message || "denied at the approval dialog" : "the machine did not accept that upload",
      );
    }
  }

  const parent = tree?.parent ?? null;

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap gap-2">
        {roots.map((root) => (
          <button
            key={root.path}
            type="button"
            onClick={() => {
              setFile(null);
              setPath(root.path);
            }}
            className={`border px-2 py-1 font-mono text-[11px] ${
              path === root.path || tree?.root === root.path
                ? "border-copper text-copper"
                : "border-rule text-muted-foreground"
            }`}
          >
            {root.name}
          </button>
        ))}
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <section
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
          className={`border bg-panel ${dragging ? "border-copper" : "border-rule"}`}
        >
          <div className="flex flex-wrap items-center gap-2 border-b border-rule px-3 py-2">
            <span className="break-all font-mono text-[10px] text-faint">{path ?? "—"}</span>
            <div className="ml-auto flex gap-2">
              <SmallButton onClick={() => void create("file")}>New file</SmallButton>
              <SmallButton onClick={() => void create("folder")}>New folder</SmallButton>
            </div>
          </div>

          <div className="max-h-[62vh] overflow-y-auto">
            {loadingTree ? (
              <div className="space-y-2 p-3">
                {Array.from({ length: 6 }).map((_, index) => (
                  <Skeleton key={index} className="h-4 w-full" />
                ))}
              </div>
            ) : (
              <ul>
                {parent && (
                  <li>
                    <button
                      type="button"
                      onClick={() => {
                        setFile(null);
                        setPath(parent);
                      }}
                      className="w-full border-b border-rule px-3 py-2 text-left font-mono text-[12px] text-muted-foreground hover:text-copper"
                    >
                      ‹ up
                    </button>
                  </li>
                )}
                {(tree?.dirs ?? []).map((entry) => {
                  const dir = dirOf(entry);
                  return (
                    <li key={dir.path}>
                      <button
                        type="button"
                        onClick={() => {
                          setFile(null);
                          setPath(dir.path);
                        }}
                        className="w-full border-b border-rule px-3 py-2 text-left text-[13px] text-paper hover:text-copper"
                      >
                        {dir.name ?? dir.path}
                        <span className="ml-2 font-mono text-[10px] text-faint">folder</span>
                      </button>
                    </li>
                  );
                })}
                {(tree?.files ?? []).map((entry) => (
                  <li
                    key={entry.path}
                    className="flex items-baseline gap-2 border-b border-rule px-3 py-2"
                  >
                    <button
                      type="button"
                      onClick={() => void open(entry)}
                      className="min-w-0 flex-1 text-left"
                    >
                      <span className="block break-all text-[13px] text-paper">{entry.name}</span>
                      <span className="font-mono text-[10px] text-faint">
                        {[stamp(entry.modified), bytes(entry.size), entry.editable === false ? "read-only" : null]
                          .filter(Boolean)
                          .join(" · ")}
                      </span>
                    </button>
                    <button
                      type="button"
                      onClick={() => void remove(entry)}
                      className="shrink-0 font-mono text-[10px] uppercase tracking-[0.12em] text-faint hover:text-risk"
                    >
                      Delete
                    </button>
                  </li>
                ))}
                {!tree?.dirs?.length && !tree?.files?.length && (
                  <li className="px-3 py-3">
                    <Empty>Nothing in this folder.</Empty>
                  </li>
                )}
              </ul>
            )}
          </div>
          <p className="border-t border-rule px-3 py-2 font-mono text-[10px] text-faint">
            Drop files here to add them to this folder.
          </p>
        </section>

        <Panel title={file?.name ?? "Viewer"}>
          {!file ? (
            <Empty>Choose a file.</Empty>
          ) : draft !== null ? (
            <>
              <textarea
                value={draft}
                onChange={(event) => setDraft(event.target.value)}
                rows={20}
                className="w-full resize-none border border-rule bg-panel2 px-3 py-3 font-mono text-[12px] leading-relaxed text-paper outline-none focus:border-copper"
              />
              <div className="mt-2 flex gap-2">
                <SmallButton onClick={() => void save()}>Save</SmallButton>
                <SmallButton onClick={() => setDraft(null)}>Cancel</SmallButton>
              </div>
            </>
          ) : (
            <>
              {file.html ? (
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
              <div className="mt-3 border-t border-rule pt-2">
                {file.editable === false ? (
                  <span className="font-mono text-[10px] text-faint">
                    read-only — executable files are not editable by design
                  </span>
                ) : (
                  <SmallButton onClick={() => setDraft(file.raw)}>Edit</SmallButton>
                )}
              </div>
            </>
          )}
        </Panel>
      </div>

      {note && <p className="font-mono text-[10px] text-faint">{note}</p>}
    </div>
  );
}

function SmallButton({ children, onClick }: { children: React.ReactNode; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="border border-rule px-2 py-1 font-mono text-[10px] uppercase tracking-[0.12em] text-muted-foreground hover:border-copper hover:text-copper"
    >
      {children}
    </button>
  );
}
