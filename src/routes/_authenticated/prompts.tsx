import { createFileRoute } from "@tanstack/react-router";
import { useCallback, useEffect, useRef, useState } from "react";
import { Panel } from "@/components/AppShell";
import { Empty, Skeleton } from "@/components/data";
import { LocalOnly } from "@/components/LocalOnly";
import { isRefusal, useLocal } from "@/lib/local-bridge";

export const Route = createFileRoute("/_authenticated/prompts")({
  head: () => ({
    meta: [
      { title: "Prompts — AgentHub Remote" },
      { name: "description", content: "Read and edit the machine's system prompts." },
      { property: "og:title", content: "Prompts — AgentHub Remote" },
      { property: "og:description", content: "Read and edit the machine's system prompts." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: () => (
    <LocalOnly>
      <PromptsPage />
    </LocalOnly>
  ),
});

type PromptEntry = { name?: string; path: string; content?: string };
type PromptsData = { prompts?: (PromptEntry | string)[] } | (PromptEntry | string)[];
type Job = { out?: string; running?: boolean };

function entryOf(item: PromptEntry | string): PromptEntry {
  return typeof item === "string" ? { name: item.split("/").pop() ?? item, path: item } : item;
}

function PromptsPage() {
  const local = useLocal();
  const [list, setList] = useState<PromptEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [active, setActive] = useState<PromptEntry | null>(null);
  const [draft, setDraft] = useState("");
  const [note, setNote] = useState<string | null>(null);
  const [triageUnverified, setTriageUnverified] = useState(false);
  const [scoring, setScoring] = useState(false);
  const [scoreOut, setScoreOut] = useState<string | null>(null);
  const poll = useRef<number | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const data = await local.get<PromptsData>("/api/prompts");
      const raw = Array.isArray(data) ? data : (data.prompts ?? []);
      setList(raw.map(entryOf));
    } catch {
      setList([]);
    } finally {
      setLoading(false);
    }
  }, [local]);

  useEffect(() => {
    void load();
    return () => {
      if (poll.current) window.clearInterval(poll.current);
    };
  }, [load]);

  async function open(entry: PromptEntry) {
    setNote(null);
    if (entry.content != null) {
      setActive(entry);
      setDraft(entry.content);
      return;
    }
    try {
      const file = await local.get<{ raw: string }>("/api/file", { path: entry.path });
      setActive(entry);
      setDraft(file.raw ?? "");
    } catch (error) {
      setNote(isRefusal(error) ? error.message || "denied at the approval dialog" : "could not open that prompt");
    }
  }

  async function save() {
    if (!active) return;
    setNote("saving on the machine…");
    try {
      await local.post("/api/prompts/save", { path: active.path, content: draft });
      setNote("saved");
      if (/triage/i.test(active.path) || /triage/i.test(active.name ?? "")) {
        setTriageUnverified(true);
      }
      await load();
    } catch (error) {
      setNote(
        isRefusal(error) ? error.message || "denied at the approval dialog" : "the machine did not save that prompt",
      );
    }
  }

  async function scoreTriage() {
    setScoring(true);
    setScoreOut("");
    try {
      const started = await local.post<{ job: string }>("/api/run", { key: "eval" });
      poll.current = window.setInterval(async () => {
        try {
          const job = await local.get<Job>("/api/job", { id: started.job });
          setScoreOut(job.out ?? "");
          if (!job.running) {
            if (poll.current) window.clearInterval(poll.current);
            poll.current = null;
            setScoring(false);
            setTriageUnverified(false);
          }
        } catch {
          if (poll.current) window.clearInterval(poll.current);
          poll.current = null;
          setScoring(false);
        }
      }, 900);
    } catch (error) {
      setScoring(false);
      setNote(
        isRefusal(error) ? error.message || "denied at the approval dialog" : "the machine did not start the score",
      );
    }
  }

  return (
    <div className="space-y-4">
      {triageUnverified && (
        <div className="flex flex-wrap items-center gap-3 border border-copper bg-panel px-3 py-2">
          <p className="flex-1 text-[13px] leading-relaxed text-copper">
            A prompt change is unverified until you re-score. Run Score triage.
          </p>
          <button
            type="button"
            disabled={scoring}
            onClick={() => void scoreTriage()}
            className="border border-copper px-3 py-1.5 font-mono text-[10px] uppercase tracking-[0.12em] text-copper disabled:opacity-50"
          >
            {scoring ? "Scoring…" : "Score triage"}
          </button>
        </div>
      )}

      <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(0,2fr)]">
        <Panel title="Prompts">
          {loading ? (
            <div className="space-y-2">
              {Array.from({ length: 5 }).map((_, index) => (
                <Skeleton key={index} className="h-4 w-full" />
              ))}
            </div>
          ) : list.length === 0 ? (
            <Empty>No prompts found.</Empty>
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
                    <span className="font-mono text-[10px] text-faint">{entry.path}</span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </Panel>

        <Panel title={active?.name ?? active?.path ?? "Editor"}>
          {!active ? (
            <Empty>Choose a prompt.</Empty>
          ) : (
            <>
              <textarea
                value={draft}
                onChange={(event) => setDraft(event.target.value)}
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
            </>
          )}
        </Panel>
      </div>

      {scoreOut !== null && (
        <pre className="max-h-[40vh] overflow-y-auto whitespace-pre-wrap break-words border border-rule bg-panel2 p-3 font-mono text-[11px] leading-relaxed text-muted-foreground">
          {scoreOut || "waiting for output…"}
        </pre>
      )}
    </div>
  );
}
