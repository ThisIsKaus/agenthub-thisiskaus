/**
 * Command palette — ⌘K anywhere.
 *
 * Fuzzy match over every view, every job command, every skill, the last files
 * touched and the last sessions recorded. Consequence is visible before
 * selection: anything that raises the machine's native approval dialog carries a
 * copper dot. The palette only reaches actions that already exist; it never
 * widens what the system may do.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useNavigate } from "@tanstack/react-router";
import { useLocal } from "@/lib/local-bridge";
import { useJobDrawer } from "@/lib/job-drawer";
import { listSkills, type Skill } from "@/lib/skills-store";

type Kind = "view" | "command" | "skill" | "file" | "session";

type Item = {
  id: string;
  kind: Kind;
  label: string;
  hint?: string;
  /** Raises the native approval dialog on the machine. */
  approves?: boolean;
  run: () => void;
};

const KIND_ORDER: Kind[] = ["view", "command", "skill", "file", "session"];
const KIND_LABEL: Record<Kind, string> = {
  view: "views",
  command: "job commands",
  skill: "skills",
  file: "recent files",
  session: "recent sessions",
};

const VIEWS: { to: string; label: string; group: string }[] = [
  { to: "/overview", label: "Overview", group: "Overview" },
  { to: "/canvas", label: "Canvas", group: "Canvas" },
  { to: "/inbox", label: "Inbox", group: "Inbox" },
  { to: "/skills", label: "Skills", group: "Skills" },
  { to: "/files", label: "Files", group: "Corpus" },
  { to: "/knowledge", label: "Knowledge", group: "Corpus" },
  { to: "/memory", label: "Memory", group: "Corpus" },
  { to: "/models", label: "Models", group: "Engine" },
  { to: "/model-scanner", label: "Model scanner", group: "Engine" },
  { to: "/prompts", label: "Prompts", group: "Engine" },
  { to: "/evals", label: "Evals", group: "Improve" },
  { to: "/proposals", label: "Proposals", group: "Improve" },
  { to: "/build", label: "Build", group: "Improve" },
  { to: "/health", label: "Health", group: "Health" },
  { to: "/cost", label: "Cost", group: "Health" },
];

/**
 * The machine's job keys. T1 keys change state outside the process and raise
 * the approval dialog; T0 keys only read.
 */
const JOBS: { key: string; label: string; approves: boolean }[] = [
  { key: "verify", label: "Run self-test", approves: false },
  { key: "doctor", label: "Diagnose the stack", approves: false },
  { key: "eval", label: "Score triage", approves: false },
  { key: "report", label: "Write the report", approves: false },
  { key: "intake", label: "Take in new material", approves: true },
  { key: "ingest", label: "Ingest documents", approves: true },
  { key: "backup", label: "Back up now", approves: true },
  { key: "repair", label: "Repair to known-good", approves: true },
  { key: "summarise", label: "Summarise the corpus", approves: true },
];

/** Subsequence match with a bonus for consecutive and word-start hits. */
function score(query: string, text: string) {
  if (!query) return 0;
  const haystack = text.toLowerCase();
  let index = 0;
  let points = 0;
  let streak = 0;
  for (const char of query.toLowerCase()) {
    const found = haystack.indexOf(char, index);
    if (found === -1) return -1;
    streak = found === index ? streak + 2 : 0;
    points += 1 + streak + (found === 0 || haystack[found - 1] === " " || haystack[found - 1] === "/" ? 2 : 0);
    index = found + 1;
  }
  return points - haystack.length * 0.01;
}

export function CommandPalette() {
  const local = useLocal();
  const navigate = useNavigate();
  const { runJob } = useJobDrawer();
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [cursor, setCursor] = useState(0);
  const [skills, setSkills] = useState<string[]>([]);
  const [files, setFiles] = useState<{ name: string; path: string }[]>([]);
  const [sessions, setSessions] = useState<string[]>([]);
  const field = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "k") {
        event.preventDefault();
        setOpen((value) => !value);
      }
      if (event.key === "Escape") setOpen(false);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  useEffect(() => {
    if (!open) return;
    setQuery("");
    setCursor(0);
    field.current?.focus();
    if (!local.available) return;
    let cancelled = false;
    void (async () => {
      const [skillList, tree, memory] = await Promise.allSettled([
        listSkills(local),
        local.get<{ files?: { name?: string; path?: string }[] }>("/api/tree"),
        local.get<{ events?: { question?: string }[] }>("/api/memory", { n: 20 }),
      ]);
      if (cancelled) return;
      if (skillList.status === "fulfilled") {
        setSkills(
          skillList.value
            .map((skill: Skill) => skill.name || skill.path)
            .filter(Boolean)

            .slice(0, 40),
        );
      }
      if (tree.status === "fulfilled") {
        setFiles(
          (tree.value.files ?? [])
            .map((file) => ({ name: file.name ?? "", path: file.path ?? "" }))
            .filter((file) => file.name)
            .slice(-20)
            .reverse(),
        );
      }
      if (memory.status === "fulfilled") {
        setSessions(
          (memory.value.events ?? [])
            .map((event) => (event.question ?? "").trim())
            .filter(Boolean)
            .slice(0, 20),
        );
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [open, local]);

  const close = useCallback(() => setOpen(false), []);

  const items = useMemo<Item[]>(() => {
    const list: Item[] = VIEWS.map((view) => ({
      id: `view:${view.to}`,
      kind: "view",
      label: view.label,
      hint: view.group,
      run: () => void navigate({ to: view.to }),
    }));

    for (const job of JOBS) {
      list.push({
        id: `job:${job.key}`,
        kind: "command",
        label: job.label,
        hint: job.key,
        approves: job.approves,
        run: () => void runJob(job.key, job.label),
      });
    }

    for (const skill of skills) {
      list.push({
        id: `skill:${skill}`,
        kind: "skill",
        label: skill,
        hint: "open in the skills editor",
        run: () => void navigate({ to: "/skills", search: { seed: skill } }),
      });
    }

    for (const file of files) {
      list.push({
        id: `file:${file.path}`,
        kind: "file",
        label: file.name,
        hint: "open in files",
        run: () => void navigate({ to: "/files" }),
      });
    }

    for (const session of sessions) {
      list.push({
        id: `session:${session}`,
        kind: "session",
        label: session.length > 80 ? `${session.slice(0, 80)}…` : session,
        hint: "find in memory",
        run: () => void navigate({ to: "/memory", search: { q: session } }),
      });
    }

    return list;
  }, [navigate, runJob, skills, files, sessions]);

  const matched = useMemo(() => {
    const scored = items
      .map((item) => ({ item, points: query ? score(query, `${item.label} ${item.hint ?? ""}`) : 0 }))
      .filter((entry) => entry.points >= 0);
    if (query) scored.sort((a, b) => b.points - a.points);
    return scored.map((entry) => entry.item).slice(0, 60);
  }, [items, query]);

  const grouped = useMemo(() => {
    return KIND_ORDER.map((kind) => ({
      kind,
      rows: matched.filter((item) => item.kind === kind),
    })).filter((group) => group.rows.length > 0);
  }, [matched]);

  const flat = useMemo(() => grouped.flatMap((group) => group.rows), [grouped]);

  useEffect(() => {
    if (cursor > flat.length - 1) setCursor(0);
  }, [flat.length, cursor]);

  useEffect(() => {
    listRef.current
      ?.querySelector<HTMLElement>(`[data-index="${cursor}"]`)
      ?.scrollIntoView({ block: "nearest" });
  }, [cursor]);

  if (!open) return null;

  function choose(item: Item | undefined) {
    if (!item) return;
    close();
    item.run();
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-start justify-center bg-background/80 p-4 pt-[10vh]"
      role="dialog"
      aria-modal="true"
      aria-label="Command palette"
      onClick={close}
    >
      <div
        className="flex max-h-[70vh] w-full max-w-[560px] flex-col border border-rule bg-panel"
        onClick={(event) => event.stopPropagation()}
      >
        <input
          ref={field}
          value={query}
          onChange={(event) => {
            setQuery(event.target.value);
            setCursor(0);
          }}
          onKeyDown={(event) => {
            if (event.key === "ArrowDown") {
              event.preventDefault();
              setCursor((value) => Math.min(value + 1, flat.length - 1));
            } else if (event.key === "ArrowUp") {
              event.preventDefault();
              setCursor((value) => Math.max(value - 1, 0));
            } else if (event.key === "Enter") {
              event.preventDefault();
              choose(flat[cursor]);
            } else if (event.key === "Escape") {
              close();
            }
          }}
          placeholder="Go to a view, run a command, open a skill…"
          aria-label="Search views, commands, skills, files and sessions"
          className="h-12 shrink-0 border-b border-rule bg-transparent px-4 text-[15px] text-paper outline-none placeholder:text-faint"
        />

        <div ref={listRef} className="min-h-0 flex-1 overflow-y-auto">
          {flat.length === 0 ? (
            <p className="px-4 py-6 font-mono text-[11px] text-faint">Nothing matches that.</p>
          ) : (
            grouped.map((group) => (
              <section key={group.kind}>
                <h2 className="px-4 pt-3 pb-1 font-mono text-[10px] uppercase tracking-[0.27em] text-faint">
                  {KIND_LABEL[group.kind]}
                </h2>
                {group.rows.map((item) => {
                  const index = flat.indexOf(item);
                  const active = index === cursor;
                  return (
                    <button
                      key={item.id}
                      data-index={index}
                      type="button"
                      onMouseEnter={() => setCursor(index)}
                      onClick={() => choose(item)}
                      title={
                        item.approves
                          ? "raises the approval dialog on the machine"
                          : undefined
                      }
                      className={`flex w-full items-center gap-2 px-4 py-2 text-left ${
                        active ? "bg-panel2" : ""
                      }`}
                    >
                      {item.approves && (
                        <span aria-hidden className="h-1.5 w-1.5 shrink-0 rounded-full bg-copper" />
                      )}
                      <span
                        className={`min-w-0 flex-1 truncate text-[13px] ${
                          active ? "text-paper" : "text-muted-foreground"
                        }`}
                      >
                        {item.label}
                      </span>
                      {item.hint && (
                        <span className="shrink-0 font-mono text-[10px] text-faint">{item.hint}</span>
                      )}
                    </button>
                  );
                })}
              </section>
            ))
          )}
        </div>

        <p className="shrink-0 border-t border-rule px-4 py-2 font-mono text-[10px] text-faint">
          ↑↓ move · enter select · esc close · copper dot raises the approval dialog on the machine
        </p>
      </div>
    </div>
  );
}

/** The hint in the header — a key, not a button. */
export function CommandHint() {
  return (
    <kbd className="hidden shrink-0 border border-rule bg-panel2 px-1.5 py-0.5 font-mono text-[10px] text-faint sm:inline-block">
      ⌘K
    </kbd>
  );
}
