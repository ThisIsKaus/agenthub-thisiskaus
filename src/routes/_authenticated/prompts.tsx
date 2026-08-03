import { createFileRoute } from "@tanstack/react-router";
import { Page } from "@/components/Page";
import { useCallback, useEffect, useState } from "react";
import { Panel } from "@/components/AppShell";
import { Empty, Skeleton } from "@/components/data";
import { LocalOnly } from "@/components/LocalOnly";
import { isRefusal, useLocal } from "@/lib/local-bridge";
import { useJobDrawer } from "@/lib/job-drawer";

export const Route = createFileRoute("/_authenticated/prompts")({
  head: () => ({
    meta: [
      { title: "Prompts — AgentHub" },
      { name: "description", content: "Read and edit the machine's system prompts." },
      { property: "og:title", content: "Prompts — AgentHub" },
      { property: "og:description", content: "Read and edit the machine's system prompts." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: () => (
    <Page title="Prompts" subtitle="The instruction files behind triage and the cascade. A change is unverified until it is re-scored." footer="Prompts · edited on the machine, versioned on save">
      <LocalOnly>
        <PromptsPage />
      </LocalOnly>
    </Page>
  ),
});

type PromptEntry = { name?: string; path: string; content?: string };
type PromptsData = { prompts?: (PromptEntry | string)[] } | (PromptEntry | string)[];
function entryOf(item: PromptEntry | string): PromptEntry {
  return typeof item === "string" ? { name: item.split("/").pop() ?? item, path: item } : item;
}

function PromptsPage() {
  const local = useLocal();
  const { runJob } = useJobDrawer();
  const [list, setList] = useState<PromptEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [active, setActive] = useState<PromptEntry | null>(null);
  const [draft, setDraft] = useState("");
  const [note, setNote] = useState<string | null>(null);
  const [triageUnverified, setTriageUnverified] = useState(false);
  const [scoring, setScoring] = useState(false);

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

  function scoreTriage() {
    setScoring(true);
    void runJob("eval", "score triage", (job) => {
      setScoring(false);
      if (job.code === 0) setTriageUnverified(false);
    });
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
                    <span className="block break-all text-[13px] text-paper">
                      {entry.name ?? entry.path.split("/").pop() ?? entry.path}
                    </span>
                    <span className="mt-0.5 block break-all font-mono text-[10px] text-faint">
                      {entry.path}
                    </span>
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

          </div>
  );
}
