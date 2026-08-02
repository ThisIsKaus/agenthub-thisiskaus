import { createFileRoute } from "@tanstack/react-router";
import { Page } from "@/components/Page";
import { useCallback, useEffect, useState } from "react";
import { Panel } from "@/components/AppShell";
import { Empty, Figure, Skeleton } from "@/components/data";
import { LocalOnly } from "@/components/LocalOnly";
import { useLocal } from "@/lib/local-bridge";

export const Route = createFileRoute("/_authenticated/memory")({
  validateSearch: (search: Record<string, unknown>) => ({
    q: typeof search.q === "string" && search.q ? search.q : undefined,
  }),

  head: () => ({
    meta: [
      { title: "Memory — AgentHub" },
      { name: "description", content: "Search the machine's recorded interactions and recent history." },
      { property: "og:title", content: "Memory — AgentHub" },
      {
        property: "og:description",
        content: "Search the machine's recorded interactions and recent history.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: () => (
    <Page title="Memory" subtitle="Everything asked and answered on the machine, searchable." footer="Memory · timeline read over loopback, never published">
      <LocalOnly>
        <MemoryPage />
      </LocalOnly>
    </Page>
  ),
});

type MemoryEvent = {
  ts?: string;
  kind?: string;
  model?: string;
  question?: string;
  answer?: string;
  sources?: (string | { file?: string; path?: string })[];
};
type MemoryData = {
  stats?: { interactions?: number; events?: number; days?: number; since?: string };
  events?: MemoryEvent[];
};

function stamp(value: string | undefined) {
  if (!value) return "—";
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

function sourceLabel(source: string | { file?: string; path?: string }) {
  return typeof source === "string" ? source : (source.file ?? source.path ?? "");
}

function MemoryPage() {
  const local = useLocal();
  const { q: seed } = Route.useSearch();
  const [query, setQuery] = useState(seed ?? "");
  const [data, setData] = useState<MemoryData | null>(null);
  const [loading, setLoading] = useState(true);
  const [mode, setMode] = useState<"recent" | "search">(seed ? "search" : "recent");

  const load = useCallback(
    async (q?: string) => {
      setLoading(true);
      try {
        setData(await local.get<MemoryData>("/api/memory", { q: q || undefined, n: 40 }));
      } catch {
        setData(null);
      } finally {
        setLoading(false);
      }
    },
    [local],
  );

  useEffect(() => {
    void load(seed);
  }, [load, seed]);


  const events = data?.events ?? [];
  const interactions = data?.stats?.interactions ?? data?.stats?.events;
  const days = data?.stats?.days;

  return (
    <div className="space-y-4">
      <form
        onSubmit={(event) => {
          event.preventDefault();
          setMode("search");
          void load(query);
        }}
        className="flex flex-wrap gap-2"
      >
        <input
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder="Search what was asked and answered…"
          className="min-w-0 flex-1 border border-rule bg-panel2 px-3 py-2 text-[14px] text-paper outline-none placeholder:text-faint focus:border-copper"
        />
        <button
          type="submit"
          className="border border-copper px-3 py-2 font-mono text-[10px] uppercase tracking-[0.12em] text-copper"
        >
          Search
        </button>
        <button
          type="button"
          onClick={() => {
            setQuery("");
            setMode("recent");
            void load();
          }}
          className="border border-rule px-3 py-2 font-mono text-[10px] uppercase tracking-[0.12em] text-muted-foreground hover:border-copper hover:text-copper"
        >
          Recent
        </button>
      </form>

      <div className="grid grid-cols-2 gap-4">
        <Figure
          label="Interactions recorded"
          value={loading ? "—" : (interactions?.toLocaleString() ?? "—")}
        />
        <Figure label="Days of history" value={loading ? "—" : (days?.toLocaleString() ?? "—")} />
      </div>

      <Panel title={mode === "search" ? "Matches" : "Recent"}>
        {loading ? (
          <div className="space-y-3">
            {Array.from({ length: 4 }).map((_, index) => (
              <Skeleton key={index} className="h-12 w-full" />
            ))}
          </div>
        ) : events.length === 0 ? (
          <Empty>{mode === "search" ? "Nothing matched." : "No interactions recorded."}</Empty>
        ) : (
          <ol className="space-y-4">
            {events.map((event, index) => (
              <li key={`${event.ts ?? index}-${index}`} className="border-b border-rule pb-4 last:border-b-0 last:pb-0">
                <div className="font-mono text-[10px] uppercase tracking-[0.14em] text-faint">
                  {stamp(event.ts)}
                  {event.kind ? ` · ${event.kind}` : ""}
                  {event.model ? ` · ${event.model}` : ""}
                </div>
                {event.question && (
                  <p className="mt-1.5 text-[14px] leading-relaxed text-paper">{event.question}</p>
                )}
                {event.answer && (
                  <p className="mt-1.5 whitespace-pre-wrap text-[13px] leading-[1.75] text-muted-foreground">
                    {event.answer}
                  </p>
                )}
                {event.sources && event.sources.length > 0 && (
                  <p className="mt-1.5 break-all font-mono text-[10px] text-faint">
                    {event.sources.map(sourceLabel).filter(Boolean).join(" · ")}
                  </p>
                )}
              </li>
            ))}
          </ol>
        )}
      </Panel>
    </div>
  );
}
