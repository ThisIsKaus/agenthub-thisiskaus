import { createFileRoute } from "@tanstack/react-router";
import { useCallback, useEffect, useState } from "react";
import { Panel } from "@/components/AppShell";
import { Empty, Skeleton, formatStamp } from "@/components/data";
import { LocalOnly } from "@/components/LocalOnly";
import { isRefusal, useLocal } from "@/lib/local-bridge";

export const Route = createFileRoute("/_authenticated/skills")({
  head: () => ({
    meta: [
      { title: "Skills — AgentHub" },
      {
        name: "description",
        content: "Focused skill files the build cascade loads only when a task needs them.",
      },
      { property: "og:title", content: "Skills — AgentHub" },
      {
        property: "og:description",
        content: "Focused skill files the build cascade loads only when a task needs them.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: () => (
    <LocalOnly>
      <SkillsPage />
    </LocalOnly>
  ),
});

type SkillEntry = { name?: string; path: string; size?: number; modified?: string };
type SkillsData = { skills?: (SkillEntry | string)[] } | (SkillEntry | string)[];

function entryOf(item: SkillEntry | string): SkillEntry {
  return typeof item === "string" ? { name: item.split("/").pop() ?? item, path: item } : item;
}

function formatSize(size: number | undefined) {
  if (size === undefined || size === null) return "—";
  if (size < 1024) return `${size} B`;
  return `${(size / 1024).toFixed(1)} kB`;
}

const GUIDANCE =
  "The build cascade loads only the skills a task needs. A monolithic instruction file decays as the codebase evolves and crowds out the task itself — keep each skill focused.";

function SkillsPage() {
  const local = useLocal();
  const [list, setList] = useState<SkillEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [active, setActive] = useState<SkillEntry | null>(null);
  const [draft, setDraft] = useState("");
  const [note, setNote] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const [newName, setNewName] = useState("");
  const [creating, setCreating] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const data = await local.get<SkillsData>("/api/skills");
      const raw = Array.isArray(data) ? data : (data.skills ?? []);
      setList(raw.map(entryOf));
    } catch {
      setList([]);
    } finally {
      setLoading(false);
    }
  }, [local]);

  useEffect(() => {
    void load();
  }, [load]);

  async function open(entry: SkillEntry) {
    setNote(null);
    setSaved(false);
    try {
      const file = await local.get<{ raw: string }>("/api/file", { path: entry.path });
      setActive(entry);
      setDraft(file.raw ?? "");
    } catch (error) {
      setNote(
        isRefusal(error)
          ? error.message || "denied at the approval dialog"
          : "could not open that skill",
      );
    }
  }

  async function save() {
    if (!active) return;
    setSaved(false);
    setNote("saving on the machine…");
    try {
      await local.post("/api/skills/save", { path: active.path, content: draft });
      setNote(null);
      setSaved(true);
      await load();
    } catch (error) {
      setNote(
        isRefusal(error)
          ? error.message || "denied at the approval dialog"
          : "the machine did not save that skill",
      );
    }
  }

  function startNew() {
    const name = newName.trim();
    if (!name) return;
    const fileName = /\.md$/i.test(name) ? name : `${name}.md`;
    setActive({ name: fileName, path: `machine/skills/${fileName}` });
    setDraft(`# ${fileName.replace(/\.md$/i, "")}\n\n`);
    setNewName("");
    setCreating(false);
    setSaved(false);
    setNote("new skill — Save writes it to the machine");
  }

  return (
    <div className="space-y-4">
      <p className="max-w-[72ch] text-[13px] leading-relaxed text-muted-foreground">{GUIDANCE}</p>

      <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(0,2fr)]">
        <Panel title="Skills">
          <div className="mb-3">
            {creating ? (
              <div className="flex flex-wrap items-center gap-2">
                <input
                  autoFocus
                  value={newName}
                  onChange={(event) => setNewName(event.target.value)}
                  onKeyDown={(event) => {
                    if (event.key === "Enter") startNew();
                    if (event.key === "Escape") setCreating(false);
                  }}
                  placeholder="retrieval-rules.md"
                  className="min-w-0 flex-1 border border-rule bg-panel2 px-2 py-1.5 font-mono text-[12px] text-paper outline-none placeholder:text-faint focus:border-copper"
                />
                <button
                  type="button"
                  onClick={startNew}
                  disabled={!newName.trim()}
                  className="border border-copper px-3 py-1.5 font-mono text-[10px] uppercase tracking-[0.12em] text-copper disabled:opacity-40"
                >
                  Create
                </button>
              </div>
            ) : (
              <button
                type="button"
                onClick={() => setCreating(true)}
                className="border border-rule px-3 py-1.5 font-mono text-[10px] uppercase tracking-[0.12em] text-muted-foreground hover:text-paper"
              >
                New skill
              </button>
            )}
          </div>

          {loading ? (
            <div className="space-y-2">
              {Array.from({ length: 5 }).map((_, index) => (
                <Skeleton key={index} className="h-4 w-full" />
              ))}
            </div>
          ) : list.length === 0 ? (
            <Empty>No skills found.</Empty>
          ) : (
            <ul className="max-h-[62vh] overflow-y-auto">
              {list.map((entry) => (
                <li key={entry.path}>
                  <button
                    type="button"
                    onClick={() => void open(entry)}
                    className={`w-full border-b border-rule py-2 text-left text-[13px] last:border-b-0 ${
                      active?.path === entry.path ? "text-copper" : "text-paper hover:text-copper"
                    }`}
                  >
                    <span className="block break-all">{entry.name ?? entry.path}</span>
                    <span className="font-mono text-[10px] text-faint">
                      {formatSize(entry.size)} · {formatStamp(entry.modified)}
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </Panel>

        <Panel title={active?.name ?? active?.path ?? "Editor"}>
          {!active ? (
            <Empty>Choose a skill.</Empty>
          ) : (
            <>
              <p className="mb-2 font-mono text-[10px] break-all text-faint">{active.path}</p>
              <textarea
                value={draft}
                onChange={(event) => {
                  setDraft(event.target.value);
                  setSaved(false);
                }}
                rows={22}
                spellCheck={false}
                className="w-full resize-none border border-rule bg-panel2 px-3 py-3 font-mono text-[12px] leading-relaxed text-paper outline-none focus:border-copper"
              />
              <div className="mt-2 flex items-center gap-3">
                <button
                  type="button"
                  onClick={() => void save()}
                  className="border border-copper px-3 py-1.5 font-mono text-[10px] uppercase tracking-[0.12em] text-copper"
                >
                  Save
                </button>
                {note && <span className="font-mono text-[10px] text-faint">{note}</span>}
              </div>
              {saved && (
                <p className="mt-3 text-[13px] leading-relaxed text-copper">
                  Skills change how the system builds. Run a small build to confirm the change lands
                  as you intend.
                </p>
              )}
            </>
          )}
        </Panel>
      </div>
    </div>
  );
}
