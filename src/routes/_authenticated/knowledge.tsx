import { createFileRoute } from "@tanstack/react-router";
import { Page } from "@/components/Page";
import { useCallback, useEffect, useState } from "react";
import { Panel } from "@/components/AppShell";
import { Empty, Figure, Skeleton } from "@/components/data";
import { LocalOnly } from "@/components/LocalOnly";
import { isRefusal, useLocal } from "@/lib/local-bridge";
import { useJobDrawer } from "@/lib/job-drawer";
import { Disclosure } from "@/components/Disclosure";

export const Route = createFileRoute("/_authenticated/knowledge")({
  head: () => ({
    meta: [
      { title: "Knowledge base — AgentHub" },
      {
        name: "description",
        content: "Chunk and document counts per source for the machine's knowledge base.",
      },
      { property: "og:title", content: "Knowledge base — AgentHub" },
      {
        property: "og:description",
        content: "Chunk and document counts per source for the machine's knowledge base.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: () => (
    <Page title="Knowledge" subtitle="What the corpus holds and where each chunk came from." footer="Knowledge · corpus counts read live from the machine">
      <LocalOnly>
        <KnowledgePage />
      </LocalOnly>
    </Page>
  ),
});

type KbSource = { file: string; path: string; chunks: number };
type KbStats = { chunks: number; documents: number; sources?: KbSource[] };
function KnowledgePage() {
  const local = useLocal();
  const { runJob } = useJobDrawer();
  const [stats, setStats] = useState<KbStats | null>(null);
  const [loading, setLoading] = useState(true);
  const [note, setNote] = useState<string | null>(null);
  const [running, setRunning] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      setStats(await local.get<KbStats>("/api/kb"));
    } catch {
      setStats(null);
    } finally {
      setLoading(false);
    }
  }, [local]);

  useEffect(() => {
    void load();
  }, [load]);

  async function forget(source: KbSource) {
    setNote("awaiting approval on the machine…");
    try {
      await local.post("/api/kb/forget", { path: source.path });
      setNote(`forgotten — ${source.file}`);
      await load();
    } catch (error) {
      setNote(
        isRefusal(error)
          ? error.message || "denied at the approval dialog"
          : "the machine did not forget that source",
      );
    }
  }

  function ingest() {
    setNote(null);
    setRunning(true);
    void runJob("ingest", "ingest", () => {
      setRunning(false);
      void load();
    });
  }

  const sources = [...(stats?.sources ?? [])].sort((a, b) => b.chunks - a.chunks);

  const byExtension = (() => {
    const map = new Map<string, { ext: string; chunks: number; documents: number }>();
    for (const source of stats?.sources ?? []) {
      const name = source.file ?? "";
      const dot = name.lastIndexOf(".");
      const ext = dot > 0 ? name.slice(dot).toLowerCase() : "(none)";
      const row = map.get(ext) ?? { ext, chunks: 0, documents: 0 };
      row.chunks += Number(source.chunks) || 0;
      row.documents += 1;
      map.set(ext, row);
    }
    return [...map.values()]
      .map((row) => ({ ...row, ratio: row.documents ? row.chunks / row.documents : 0 }))
      .sort((a, b) => b.ratio - a.ratio);
  })();

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 gap-4">
        <Figure label="Chunks" value={loading ? "—" : (stats?.chunks?.toLocaleString() ?? "—")} />
        <Figure label="Documents" value={loading ? "—" : (stats?.documents?.toLocaleString() ?? "—")} />
      </div>

      <Panel title="Detail">
        <Disclosure
          summary={
            <span className="font-mono text-[11px] uppercase tracking-[0.12em] text-faint">
              Sources by chunk count · {sources.length} indexed
            </span>
          }
        >
        {loading ? (
          <div className="space-y-2">
            {Array.from({ length: 6 }).map((_, index) => (
              <Skeleton key={index} className="h-4 w-full" />
            ))}
          </div>
        ) : sources.length === 0 ? (
          <Empty>No sources indexed.</Empty>
        ) : (
          <ul>
            {sources.map((source) => (
              <li
                key={source.path}
                className="flex items-baseline gap-3 border-b border-rule py-2 last:border-b-0"
              >
                <span className="min-w-0 flex-1 break-all text-[13px] text-paper">{source.file}</span>
                <span className="shrink-0 font-mono text-[11px] text-muted-foreground">
                  {source.chunks.toLocaleString()}
                </span>
                <button
                  type="button"
                  onClick={() => void forget(source)}
                  className="shrink-0 font-mono text-[10px] uppercase tracking-[0.12em] text-faint hover:text-risk"
                >
                  Forget
                </button>
              </li>
            ))}
          </ul>
        )}
        </Disclosure>
      </Panel>

      <Panel title="Ingest">
        <button
          type="button"
          onClick={() => void ingest()}
          disabled={running}
          className="border border-copper px-3 py-1.5 font-mono text-[11px] uppercase tracking-[0.12em] text-copper disabled:opacity-50"
        >
          {running ? "Ingesting…" : "Ingest documents"}
        </button>
        <p className="mt-2 font-mono text-[10px] text-faint">
          Output streams in the Jobs drawer at the foot of the screen.
        </p>
      </Panel>

      {note && <p className="font-mono text-[10px] text-faint">{note}</p>}
    </div>
  );
}
