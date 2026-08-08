/**
 * Canvas — content first.
 *
 * The page opens on a cursor. Everything else is inferred from what you write:
 * the lane, the number of sources, the skills that matched, and the document's
 * sensitivity class, which is derived from the sources actually cited and can
 * only ever be raised by hand. Ask is the unsaved case of this same surface —
 * one code path, one document type.
 */
import { createFileRoute } from "@tanstack/react-router";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Page } from "@/components/Page";
import { LocalOnly } from "@/components/LocalOnly";
import { Markdown } from "@/components/Markdown";
import { isRefusal, LOCAL_BASE, useLocal } from "@/lib/local-bridge";
import { askProgressive } from "@/lib/ask-stream";
import {
  handoverCanvas,
  listCanvases,
  readCanvas,
  writeCanvas,
  type LibraryEntry,
} from "@/lib/canvas-store";
import {
  emptyBlock,
  emptyDoc,
  LANES,
  SOURCE_COUNTS,
  STAGES,
  type AskSource,
  type CanvasDoc,
  type Stage,
} from "@/lib/canvas-types";
import { listSkills, type Skill } from "@/lib/skills-store";

export const Route = createFileRoute("/_authenticated/canvas")({
  validateSearch: (search: Record<string, unknown>) => ({
    /** A question routed here from the omnibox or /ask — answered on load. */
    q: typeof search.q === "string" ? search.q : undefined,
    seed: typeof search.seed === "string" ? search.seed : undefined,
    id: typeof search.id === "string" ? search.id : undefined,
  }),
  head: () => ({
    meta: [
      { title: "Canvas — AgentHub" },
      {
        name: "description",
        content:
          "One writing surface: ask the corpus, keep the answer as a document, and let the machine infer lane, sources and sensitivity.",
      },
      { property: "og:title", content: "Canvas — AgentHub" },
      {
        property: "og:description",
        content:
          "One writing surface: ask the corpus, keep the answer as a document, and let the machine infer lane, sources and sensitivity.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: () => (
    <Page
      title="Canvas"
      footer="Canvas · documents live on the machine; every save keeps the previous version"
    >
      <LocalOnly>
        <CanvasPage />
      </LocalOnly>
    </Page>
  ),
});

/* ── sensitivity ─────────────────────────────────────────────────────────── */

const CLASS_ORDER = ["S0", "S1p", "S1c", "S2", "S3"] as const;
const LOCAL_ONLY = ["S1c", "S2", "S3"];

/** The document's class is the highest among its cited sources. Never chosen. */
function derivedClass(sources: AskSource[]): { cls: string | null; because: string | null } {
  let best = -1;
  let because: string | null = null;
  for (const source of sources) {
    const index = CLASS_ORDER.indexOf(
      String(source.sensitivity ?? "") as (typeof CLASS_ORDER)[number],
    );
    if (index > best) {
      best = index;
      because = source.file ?? source.path ?? null;
    }
  }
  return best < 0 ? { cls: null, because: null } : { cls: CLASS_ORDER[best], because };
}

function higher(a: string | null, b: string | null): string | null {
  const ai = a ? CLASS_ORDER.indexOf(a as (typeof CLASS_ORDER)[number]) : -1;
  const bi = b ? CLASS_ORDER.indexOf(b as (typeof CLASS_ORDER)[number]) : -1;
  return ai >= bi ? a : b;
}

function stamp(iso: string | undefined) {
  if (!iso) return "—";
  const date = new Date(iso);
  return Number.isNaN(date.getTime()) ? "—" : date.toISOString().slice(0, 16).replace("T", " ");
}

/**
 * What kind of evidence a source is, read off its path. A skill and a bank
 * statement are not the same kind of evidence and should not read alike.
 */
const KIND_ORDER = ["Documents", "Skills", "Proposals", "Digest", "Sessions", "Canon"] as const;
type SourceKind = (typeof KIND_ORDER)[number];

function kindOf(path: string): SourceKind {
  const p = path.toLowerCase();
  if (p.includes("/skills/") || p.includes("skill.md")) return "Skills";
  if (p.includes("proposal")) return "Proposals";
  if (p.includes("digest")) return "Digest";
  if (p.includes("session")) return "Sessions";
  if (p.includes("/canon/") || p.includes("canon")) return "Canon";
  return "Documents";
}

type SourceRow = {
  name: string;
  path: string;
  best?: number;
  passages: number;
  cls?: string;
  foundBy?: string;
};

/** One row per cited file: its best distance, and how many passages matched. */
function groupSources(sources: AskSource[]): SourceRow[] {
  const byName = new Map<string, SourceRow>();
  for (const source of sources) {
    const name = source.file ?? source.path ?? "—";
    const row = byName.get(name);
    if (!row) {
      byName.set(name, {
        name,
        path: source.path ?? source.file ?? "",
        best: source.distance,
        passages: 1,
        cls: source.sensitivity,
        foundBy: source.found_by,
      });
      continue;
    }
    row.passages += 1;
    if (source.distance != null && (row.best == null || source.distance < row.best)) {
      row.best = source.distance;
    }
    if (!row.cls) row.cls = source.sensitivity;
    if (!row.foundBy) row.foundBy = source.found_by;
  }
  return [...byName.values()].sort((a, b) => (a.best ?? Infinity) - (b.best ?? Infinity));
}

/** Grouped by kind, kinds ordered, empty kinds dropped. */
function byKind(rows: SourceRow[]): { kind: SourceKind; rows: SourceRow[] }[] {
  const buckets = new Map<SourceKind, SourceRow[]>();
  for (const row of rows) {
    const kind = kindOf(row.path || row.name);
    const list = buckets.get(kind);
    if (list) list.push(row);
    else buckets.set(kind, [row]);
  }
  return KIND_ORDER.filter((kind) => buckets.has(kind)).map((kind) => ({
    kind,
    rows: buckets.get(kind)!,
  }));
}

function distanceTone(distance: number | undefined) {
  if (distance == null) return "text-faint";
  if (distance < 0.5) return "text-ok";
  if (distance <= 0.7) return "text-muted-foreground";
  return "text-watch";
}

/** Which skill matched, and on which trigger — shown after the fact, not before. */
function matchedSkills(skills: Skill[], text: string) {
  const haystack = text.toLowerCase();
  if (!haystack.trim()) return [];
  const out: { name: string; trigger: string }[] = [];
  for (const skill of skills) {
    if (skill.state !== "active" && skill.state !== "watch") continue;
    if (skill.scope !== "both" && skill.scope !== "canvas") continue;
    const trigger = skill.triggers.find((item) => item && haystack.includes(item.toLowerCase()));
    if (trigger) out.push({ name: skill.name, trigger });
  }
  return out;
}

function laneLabel(id: string) {
  return LANES.find((lane) => lane.id === id)?.label.toLowerCase() ?? id;
}

/* ── page ────────────────────────────────────────────────────────────────── */

function CanvasPage() {
  const local = useLocal();
  const queryClient = useQueryClient();
  const { q, seed, id: openId } = Route.useSearch();

  const [text, setText] = useState(seed ?? q ?? "");
  const [answer, setAnswer] = useState("");
  const [sources, setSources] = useState<AskSource[]>([]);
  const [asking, setAsking] = useState(false);
  const [elapsed, setElapsed] = useState(0);
  const [status, setStatus] = useState<string | null>(null);
  const [askedText, setAskedText] = useState("");
  const [answeredBy, setAnsweredBy] = useState<string | null>(null);

  const [model, setModel] = useState<string>(LANES[0].id);
  const [k, setK] = useState<number>(8);
  const [onePass, setOnePass] = useState(false);
  const [extraSkills, setExtraSkills] = useState<string[]>([]);
  const [raised, setRaised] = useState<string | null>(null);

  const [settings, setSettings] = useState(false);
  const [sourcesOpen, setSourcesOpen] = useState(false);
  const [libraryOpen, setLibraryOpen] = useState(false);
  const [naming, setNaming] = useState(false);
  const [title, setTitle] = useState("");
  const [docId, setDocId] = useState<string | null>(null);
  const [stage, setStage] = useState<Stage>("draft");
  const [saveNote, setSaveNote] = useState<string | null>(null);
  const [handoverNote, setHandoverNote] = useState<string | null>(null);

  const area = useRef<HTMLTextAreaElement | null>(null);
  const nameField = useRef<HTMLInputElement | null>(null);
  const running = useRef(false);

  const library = useQuery({
    queryKey: ["canvas", "library"],
    enabled: local.available,
    queryFn: () => listCanvases(local),
  });

  const skillFiles = useQuery({
    queryKey: ["skills", "catalogue"],
    enabled: local.available,
    queryFn: () => listSkills(local),
  });

  // The page opens on a cursor.
  useEffect(() => {
    area.current?.focus();
  }, []);

  useEffect(() => {
    if (asking) {
      const started = Date.now();
      setElapsed(0);
      const timer = setInterval(() => setElapsed(Math.floor((Date.now() - started) / 1000)), 1000);
      return () => clearInterval(timer);
    }
  }, [asking]);

  const derived = useMemo(() => derivedClass(sources), [sources]);
  const cls = higher(raised, derived.cls);
  const localOnly = cls ? LOCAL_ONLY.includes(cls) : false;

  const skillsLoaded = useMemo(() => {
    const matched = matchedSkills(skillFiles.data ?? [], askedText || text);
    const extra = extraSkills
      .filter((name) => !matched.some((item) => item.name === name))
      .map((name) => ({ name, trigger: "added by hand" }));
    return [...matched, ...extra];
  }, [skillFiles.data, askedText, text, extraSkills]);

  const ask = useCallback(
    async (lane: string, count: number) => {
      const question = text.trim();
      if (!question || running.current) return;
      running.current = true;
      setAsking(true);
      setStatus("retrieving from the corpus…");
      setAnswer("");
      setAnsweredBy(null);
      setSources([]);
      setAskedText(question);
      try {
        const result = await askProgressive(
          LOCAL_BASE,
          local.post,
          { q: question, model: lane, k: count },
          {
            sources: (found) => {
              setSources(found);
              setSourcesOpen(true);
              setStatus("thinking on the machine…");
            },
            delta: (partial) => setAnswer(partial),
          },
        );
        setAnswer(result.answer);
        setSources(result.sources);
        setAnsweredBy(result.model ?? lane);
        setStatus(null);
      } catch (error) {
        setStatus(
          isRefusal(error)
            ? error.message || "denied at the approval dialog"
            : "the machine did not answer that question",
        );
      } finally {
        running.current = false;
        setAsking(false);
      }
    },
    [local, text],
  );

  const buildDoc = useCallback((): CanvasDoc => {
    const doc = emptyDoc(title.trim() || text.trim().slice(0, 60) || "Untitled");
    if (docId) doc.id = docId;
    doc.stage = stage;
    doc.sensitivity = cls ?? "S1p";
    doc.skills = skillsLoaded.map((skill) => skill.name);
    doc.sources = groupSources(sources).map((source) => source.name);
    doc.blocks = [
      { ...emptyBlock("note"), text: askedText || text },
      ...(answer ? [{ ...emptyBlock("note"), text: answer }] : []),
    ];
    return doc;
  }, [answer, askedText, cls, docId, skillsLoaded, sources, stage, text, title]);

  const keep = useCallback(async () => {
    setSaveNote("saving to the machine…");
    try {
      const doc = buildDoc();
      const versions = await writeCanvas(local, doc);
      setDocId(doc.id);
      setTitle(doc.title);
      setSaveNote(
        `kept as “${doc.title}” · ${versions} ${versions === 1 ? "version" : "versions"}`,
      );
      void queryClient.invalidateQueries({ queryKey: ["canvas", "library"] });
    } catch (error) {
      setSaveNote(
        isRefusal(error)
          ? error.message || "denied at the approval dialog"
          : "the machine did not keep this document",
      );
    }
  }, [buildDoc, local, queryClient]);

  const onKeyDown = (event: React.KeyboardEvent<HTMLTextAreaElement>) => {
    const meta = event.metaKey || event.ctrlKey;
    if (meta && event.key.toLowerCase() === "s") {
      event.preventDefault();
      setNaming(true);
      window.setTimeout(() => nameField.current?.focus(), 0);
      return;
    }
    if (event.key === "Enter" && !event.shiftKey) {
      event.preventDefault();
      void ask(model, k).then(() => {
        if (meta) void keep();
      });
    }
  };

  // A question routed in from the omnibox or /ask is answered without a press.
  const auto = useRef(false);
  useEffect(() => {
    if (auto.current || !q?.trim() || !local.available) return;
    auto.current = true;
    void ask(model, k);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [q, local.available]);

  // A document the inbox already saved on the machine is opened, not re-created.
  const opened = useRef<string | null>(null);
  useEffect(() => {
    if (!openId || !local.available || opened.current === openId) return;
    opened.current = openId;
    void readCanvas(local, openId)
      .then((doc) => doc && load(doc))
      .catch(() => setSaveNote("the machine did not open that document"));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [openId, local.available]);

  function load(doc: CanvasDoc) {
    const [first, second] = doc.blocks;
    setDocId(doc.id);
    setTitle(doc.title);
    setStage(doc.stage);
    setText(first?.text ?? "");
    setAskedText(first?.text ?? "");
    setAnswer(second?.text ?? "");
    setSources([]);
    setRaised(doc.sensitivity && doc.sensitivity !== "S1p" ? doc.sensitivity : null);
    setLibraryOpen(false);
    setSaveNote(`opened “${doc.title}”`);
  }

  async function chooseStage(next: Stage) {
    setStage(next);
    if (!docId) return;
    try {
      await writeCanvas(local, { ...buildDoc(), stage: next });
      void queryClient.invalidateQueries({ queryKey: ["canvas", "library"] });
    } catch {
      setSaveNote("the machine did not record that state");
    }
  }

  async function handOver() {
    if (!docId) await keep();
    const id = docId ?? buildDoc().id;
    setHandoverNote("awaiting approval on the machine…");
    try {
      const path = await handoverCanvas(local, id);
      setHandoverNote(`copied to ${path ?? "the inbox"}`);
    } catch (error) {
      setHandoverNote(
        isRefusal(error)
          ? error.message || "denied at the approval dialog"
          : "the hand-over was refused on the machine",
      );
    }
  }

  const documents = library.data?.documents ?? [];
  const counts = library.data?.counts ?? {};
  const grouped = groupSources(sources);
  const lanes = localOnly ? LANES.filter((lane) => lane.id.startsWith("local-")) : LANES;

  return (
    <div className="space-y-3" data-testid="canvas-page">
      {naming && (
        <input
          ref={nameField}
          value={title}
          onChange={(event) => setTitle(event.target.value)}
          onBlur={() => setNaming(false)}
          onKeyDown={(event) => {
            if (event.key === "Enter") {
              event.preventDefault();
              setNaming(false);
              void keep();
            }
          }}
          aria-label="Name this document"
          placeholder="Name it"
          className="w-full border border-copper bg-panel px-4 py-2 font-serif text-[20px] text-paper outline-none placeholder:text-faint"
        />
      )}

      <textarea
        ref={area}
        value={text}
        onChange={(event) => setText(event.target.value)}
        onKeyDown={onKeyDown}
        rows={10}
        aria-label="Write or ask"
        className="w-full resize-y border border-rule bg-panel px-4 py-3 text-[16px] leading-[1.85] text-paper outline-none focus:border-copper placeholder:text-faint"
        placeholder=""
      />

      <p className="font-mono text-[11px] text-faint">⏎ ask · ⌘⏎ ask and keep · ⌘S name it</p>

      <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
        <button
          type="button"
          data-testid="inferred-line"
          onClick={() => setSettings((open) => !open)}
          title="Click to change the lane, the number of sources, or the skills"
          className="font-mono text-[11px] text-muted-foreground hover:text-copper"
        >
          {laneLabel(model)} · {k} sources · {skillsLoaded.length}{" "}
          {skillsLoaded.length === 1 ? "skill" : "skills"} loaded
        </button>
        {asking && (
          <span className="font-mono text-[11px] tabular-nums text-copper">
            {status ?? "thinking on the machine…"} {elapsed}s
          </span>
        )}
        {!asking && status && <span className="font-mono text-[11px] text-faint">{status}</span>}
      </div>

      {settings && (
        <section className="border border-rule bg-panel px-4 py-3" data-testid="canvas-settings">
          <div className="flex flex-wrap gap-2">
            {lanes.map((lane) => (
              <button
                key={lane.id}
                type="button"
                onClick={() => setModel(lane.id)}
                className={`border px-2 py-1 font-mono text-[10px] ${
                  lane.id === model
                    ? "border-copper text-copper"
                    : "border-rule text-muted-foreground"
                }`}
              >
                {lane.label}{" "}
                <span className={lane.cost === "$0" ? "text-ok" : "text-copper"}>{lane.cost}</span>
              </button>
            ))}
          </div>
          {localOnly && (
            <p className="mt-2 font-mono text-[10px] text-faint">
              cloud lanes are withheld: this document cites {cls} material
            </p>
          )}
          <div className="mt-3 flex flex-wrap items-center gap-2">
            <span className="font-mono text-[10px] uppercase tracking-[0.16em] text-faint">
              skills
            </span>
            {skillsLoaded.length === 0 && (
              <span className="font-mono text-[10px] text-faint">none matched yet</span>
            )}
            {(skillFiles.data ?? [])
              .filter((skill) => !skillsLoaded.some((loaded) => loaded.name === skill.name))
              .slice(0, 12)
              .map((skill) => (
                <button
                  key={skill.path}
                  type="button"
                  onClick={() => setExtraSkills((current) => [...current, skill.name])}
                  className="border border-rule px-2 py-1 font-mono text-[10px] text-muted-foreground hover:border-copper hover:text-copper"
                >
                  + {skill.name}
                </button>
              ))}
          </div>
        </section>
      )}

      {skillsLoaded.length > 0 && (
        <p className="font-mono text-[10px] leading-relaxed text-faint" data-testid="skills-loaded">
          {skillsLoaded.map((skill) => `${skill.name} · matched on “${skill.trigger}”`).join(" · ")}
        </p>
      )}

      {cls && (
        <p
          className="font-mono text-[11px] leading-relaxed text-paper"
          data-testid="sensitivity-line"
        >
          <span className={localOnly ? "text-watch" : "text-ok"}>{cls}</span>{" "}
          {localOnly ? "— local only" : "— cloud lane available"}
          {derived.because ? `, because you cited ${derived.because}` : ""}
          <button
            type="button"
            onClick={() => {
              const index = CLASS_ORDER.indexOf(cls as (typeof CLASS_ORDER)[number]);
              if (index < CLASS_ORDER.length - 1) setRaised(CLASS_ORDER[index + 1]);
            }}
            title="Raise the class by hand. Nothing lowers it."
            className="ml-2 font-mono text-[10px] uppercase tracking-[0.12em] text-faint hover:text-copper"
          >
            Raise
          </button>
        </p>
      )}

      {answer && (
        <section className="border border-rule bg-panel px-4 py-3" data-testid="answer">
          <Markdown text={answer} />
          <div className="mt-3 flex flex-wrap items-center gap-3 border-t border-rule pt-3">
            <span className="font-mono text-[10px] text-faint">
              {answeredBy ?? laneLabel(model)}
            </span>
            <button
              type="button"
              onClick={() => void keep()}
              className="border border-rule px-3 py-1 font-mono text-[10px] uppercase tracking-[0.14em] text-muted-foreground hover:border-copper hover:text-copper"
            >
              Keep as document
            </button>
            <button
              type="button"
              data-testid="handover"
              onClick={() => void handOver()}
              className="border border-rule px-3 py-1 font-mono text-[10px] uppercase tracking-[0.14em] text-muted-foreground hover:border-copper hover:text-copper"
            >
              Hand over to inbox
            </button>
          </div>
          {saveNote && <p className="mt-2 font-mono text-[10px] text-copper">{saveNote}</p>}
          {handoverNote && <p className="mt-1 font-mono text-[10px] text-faint">{handoverNote}</p>}
        </section>
      )}

      {answer && searched.length > 0 && (
        <p className="font-mono text-[10px] leading-relaxed text-faint" data-testid="searched-line">
          searched {searched.join(" · ")}
        </p>
      )}

      {grouped.length > 0 && (
        <section className="border border-rule bg-panel" data-testid="sources">
          <button
            type="button"
            onClick={() => setSourcesOpen((open) => !open)}
            className="flex w-full items-baseline justify-between gap-3 px-4 py-2 text-left font-mono text-[10px] uppercase tracking-[0.16em] text-copper"
          >
            <span>
              Sources · <span className="tabular-nums text-paper">{grouped.length}</span> of {k}{" "}
              requested
            </span>
            <span className="text-faint">{sourcesOpen ? "hide" : "show"}</span>
          </button>
          {sourcesOpen && (
            <div className="border-t border-rule px-4 py-2">
              {kinds.map((group, index) => {
                const open = kindOpen[group.kind] ?? index < 2;
                return (
                  <div key={group.kind} className="border-t border-rule py-2 first:border-t-0">
                    <button
                      type="button"
                      onClick={() =>
                        setKindOpen((current) => ({ ...current, [group.kind]: !open }))
                      }
                      className="flex w-full items-baseline justify-between gap-3 text-left"
                    >
                      <span className="font-mono text-[10px] uppercase tracking-[0.16em] text-muted-foreground">
                        {group.kind}{" "}
                        <span className="tabular-nums text-faint">{group.rows.length}</span>
                      </span>
                      <span className="font-mono text-[10px] text-faint">
                        {open ? "hide" : "show"}
                      </span>
                    </button>
                    {open && (
                      <ul className="mt-1">
                        {group.rows.map((source) => (
                          <li
                            key={source.name}
                            className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1 py-1"
                          >
                            <span className="min-w-0 break-all text-[13px] leading-relaxed text-paper">
                              {source.name}
                              {source.passages > 1 && (
                                <span className="ml-2 font-mono text-[10px] text-faint">
                                  {source.passages} passages
                                </span>
                              )}
                              {source.foundBy && (
                                <span className="ml-2 font-mono text-[10px] uppercase tracking-[0.12em] text-faint">
                                  {source.foundBy}
                                </span>
                              )}
                            </span>
                            <span className="font-mono text-[10px] text-faint">
                              {source.cls ?? "—"}
                            </span>
                            <span
                              className={`font-mono text-[10px] tabular-nums ${distanceTone(source.best)}`}
                            >
                              {source.best != null ? source.best.toFixed(3) : "—"}
                            </span>
                          </li>
                        ))}
                      </ul>
                    )}
                  </div>
                );
              })}
              <div className="mt-2 flex flex-wrap items-center gap-2 border-t border-rule pt-2">
                <span className="font-mono text-[10px] uppercase tracking-[0.16em] text-faint">
                  retrieve
                </span>
                {SOURCE_COUNTS.map((count) => (
                  <button
                    key={count}
                    type="button"
                    onClick={() => {
                      setK(count);
                      void ask(model, count);
                    }}
                    className={`border px-2 py-1 font-mono text-[10px] tabular-nums ${
                      count === k
                        ? "border-copper text-copper"
                        : "border-rule text-muted-foreground"
                    }`}
                  >
                    {count}
                  </button>
                ))}
                <button
                  type="button"
                  onClick={() => setOnePass((value) => !value)}
                  className={`border px-2 py-1 font-mono text-[10px] ${
                    onePass ? "border-copper text-copper" : "border-rule text-muted-foreground"
                  }`}
                >
                  one pass per source
                </button>
              </div>
            </div>
          )}
        </section>
      )}

      {docId && (
        <div className="flex flex-wrap items-center gap-2" data-testid="state-bar">
          <span className="font-mono text-[10px] uppercase tracking-[0.16em] text-faint">
            state
          </span>
          {STAGES.map((entry) => (
            <button
              key={entry}
              type="button"
              onClick={() => void chooseStage(entry)}
              className={`border px-2 py-1 font-mono text-[10px] ${
                stage === entry ? "border-copper text-copper" : "border-rule text-muted-foreground"
              }`}
            >
              {entry}
            </button>
          ))}
        </div>
      )}

      <div>
        <button
          type="button"
          data-testid="toggle-library"
          onClick={() => setLibraryOpen((open) => !open)}
          className="font-mono text-[11px] text-faint hover:text-copper"
        >
          Library · {documents.length} {documents.length === 1 ? "document" : "documents"}
        </button>
        {libraryOpen && (
          <section className="mt-2 border border-rule bg-panel" data-testid="canvas-library">
            <p className="border-b border-rule px-4 py-2 font-mono text-[10px] text-faint">
              {STAGES.map((entry) => `${entry} ${counts[entry] ?? 0}`).join(" · ")}
            </p>
            {library.isLoading && (
              <p className="px-4 py-3 font-mono text-[11px] text-faint">reading the machine…</p>
            )}
            {!library.isLoading && documents.length === 0 && (
              <p className="px-4 py-3 font-mono text-[11px] text-faint">
                nothing kept yet — ⌘⏎ keeps an answer as a document
              </p>
            )}
            {documents.map((entry: LibraryEntry) => (
              <div
                key={entry.id}
                className="flex items-baseline justify-between gap-3 border-t border-rule px-4 py-2"
              >
                <button
                  type="button"
                  onClick={() =>
                    void readCanvas(local, entry.id)
                      .then((doc) => doc && load(doc))
                      .catch(() => setSaveNote("the machine did not open that document"))
                  }
                  className="min-w-0 flex-1 truncate text-left font-mono text-[12px] text-paper hover:text-copper"
                >
                  {entry.title}
                </button>
                <span className="shrink-0 font-mono text-[10px] text-faint">{entry.state}</span>
                <span className="shrink-0 font-mono text-[10px] tabular-nums text-faint">
                  {stamp(entry.updated)}
                </span>
              </div>
            ))}
          </section>
        )}
      </div>
    </div>
  );
}
