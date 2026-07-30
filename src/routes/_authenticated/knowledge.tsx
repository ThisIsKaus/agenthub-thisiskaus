import { createFileRoute } from "@tanstack/react-router";
import { useCallback, useEffect, useRef, useState } from "react";
import { Panel } from "@/components/AppShell";
import { Empty, Figure, Skeleton } from "@/components/data";
import { LocalOnly } from "@/components/LocalOnly";
import { isRefusal, useLocal } from "@/lib/local-bridge";

export const Route = createFileRoute("/_authenticated/knowledge")({
  head: () => ({
    meta: [
      { title: "Knowledge base — AgentHub Remote" },
      {
        name: "description",
        content: "Chunk and document counts per source for the machine's knowledge base.",
      },
      { property: "og:title", content: "Knowledge base — AgentHub Remote" },
      {
        property: "og:description",
        content: "Chunk and document counts per source for the machine's knowledge base.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: () => (
    <LocalOnly>
      <KnowledgePage />
    </LocalOnly>
  ),
});

type KbSource = { file: string; path: string; chunks: number };
type KbStats = { chunks: number; documents: number; sources?: KbSource[] };
type Job = { key?: string; out?: string; running?: boolean; code?: number };

function KnowledgePage() {
  const local = useLocal();
  const [stats, setStats] = useState<KbStats | null>(null);
  const [loading, setLoading] = useState(true);
  const [note, setNote] = useState<string | null>(null);
  const [output, setOutput] = useState<string | null>(null);
  const [running, setRunning] = useState(false);
  const poll = useRef<number | null>(null);

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
    return () => {
      if (poll.current) window.clearInterval(poll.current);
    };
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

  async function ingest() {
    setNote(null);
    setRunning(true);
    setOutput("");
    try {
      const started = await local.post<{ job: string; label?: string }>("/api/run", { key: "ingest" });
      poll.current = window.setInterval(async () => {
        try {
          const job = await local.get<Job>("/api/job", { id: started.job });
          setOutput(job.out ?? "");
          if (!job.running) {
            if (poll.current) window.clearInterval(poll.current);
            poll.current = null;
            setRunning(false);
            await load();
          }
        } catch {
          if (poll.current) window.clearInterval(poll.current);
          poll.current = null;
          setRunning(false);
        }
      }, 900);
    } catch (error) {
      setRunning(false);
      setNote(
        isRefusal(error) ? error.message || "denied at the approval dialog" : "the machine did not start the job",
      );
    }
  }

  const sources = [...(stats?.sources ?? [])].sort((a, b) => b.chunks - a.chunks);

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 gap-4">
        <Figure label="Chunks" value={loading ? "—" : (stats?.chunks?.toLocaleString() ?? "—")} />
        <Figure label="Documents" value={loading ? "—" : (stats?.documents?.toLocaleString() ?? "—")} />
      </div>

      <Panel title="Sources">
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
        {output !== null && (
          <pre className="mt-3 max-h-[40vh] overflow-y-auto whitespace-pre-wrap break-words border border-rule bg-panel2 p-3 font-mono text-[11px] leading-relaxed text-muted-foreground">
            {output || "waiting for output…"}
          </pre>
        )}
      </Panel>

      {note && <p className="font-mono text-[10px] text-faint">{note}</p>}
    </div>
  );
}
