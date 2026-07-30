import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useRef, useState } from "react";
import { Panel } from "@/components/AppShell";
import { LocalOnly } from "@/components/LocalOnly";
import { isRefusal, useLocal } from "@/lib/local-bridge";

export const Route = createFileRoute("/_authenticated/ask")({
  head: () => ({
    meta: [
      { title: "Ask — AgentHub" },
      {
        name: "description",
        content:
          "Put a question to the local brain against the indexed corpus, with sources and their distances.",
      },
      { property: "og:title", content: "Ask — AgentHub" },
      {
        property: "og:description",
        content:
          "Put a question to the local brain against the indexed corpus, with sources and their distances.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: () => (
    <LocalOnly>
      <AskPage />
    </LocalOnly>
  ),
});

const LANES = [
  { id: "local-brain", label: "Local brain 35B", cost: "$0" },
  { id: "local-coder", label: "Local coder 27B", cost: "$0" },
  { id: "cloud-work", label: "Cloud work Sonnet", cost: "metered" },
  { id: "cloud-deep", label: "Cloud deep Opus", cost: "metered" },
] as const;

const SOURCE_COUNTS = [5, 8, 12] as const;

type Source = { file?: string; path?: string; distance?: number };
type AskResult = { answer?: string; model?: string; sources?: Source[] };

const REFUSAL = /not in corpus|no relevant|not covered|cannot answer from the corpus/i;

function distanceTone(distance: number | undefined) {
  if (distance == null) return { className: "text-faint", title: undefined as string | undefined };
  if (distance < 0.5) return { className: "text-ok", title: undefined };
  if (distance <= 0.7) return { className: "text-muted-foreground", title: undefined };
  return {
    className: "text-watch",
    title: "weak match — the corpus may not contain this",
  };
}

function AskPage() {
  const local = useLocal();
  const [question, setQuestion] = useState("");
  const [model, setModel] = useState<string>(LANES[0].id);
  const [k, setK] = useState<number>(8);
  const [result, setResult] = useState<AskResult | null>(null);
  const [status, setStatus] = useState<string | null>(null);
  const [asking, setAsking] = useState(false);
  const [saved, setSaved] = useState<string | null>(null);
  const box = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    box.current?.focus();
  }, []);

  async function ask() {
    const q = question.trim();
    if (!q || asking) return;
    setAsking(true);
    setSaved(null);
    setStatus("thinking on the machine…");
    setResult(null);
    try {
      const data = await local.post<AskResult>("/api/ask", { q, model, k });
      setResult(data);
      setStatus(null);
    } catch (error) {
      setResult(null);
      setStatus(
        isRefusal(error)
          ? error.message || "denied at the approval dialog"
          : "the machine did not answer that question",
      );
    } finally {
      setAsking(false);
    }
  }

  async function saveDraft() {
    if (!result?.answer) return;
    setSaved("awaiting approval on the machine…");
    try {
      const data = await local.post<{ path?: string; name?: string }>("/api/draft", {
        title: question.trim().slice(0, 80) || "Untitled",
        body: result.answer,
      });
      setSaved(`saved as ${data.name ?? data.path ?? "a draft"}`);
    } catch (error) {
      setSaved(
        isRefusal(error)
          ? error.message || "denied at the approval dialog"
          : "the machine did not save that draft",
      );
    }
  }

  const refused = result?.answer ? REFUSAL.test(result.answer) : false;

  return (
    <div className="space-y-4">
      <Panel title="Ask">
        <textarea
          ref={box}
          value={question}
          onChange={(event) => setQuestion(event.target.value)}
          onKeyDown={(event) => {
            if ((event.metaKey || event.ctrlKey) && event.key === "Enter") void ask();
          }}
          rows={6}
          placeholder="A question for the corpus…"
          className="w-full resize-none border border-rule bg-panel2 px-3 py-3 text-[15px] leading-[1.75] text-paper outline-none placeholder:text-faint focus:border-copper"
        />

        <fieldset className="mt-3">
          <legend className="font-mono text-[10px] uppercase tracking-[0.16em] text-faint">
            Lane
          </legend>
          <div className="mt-2 grid grid-cols-1 gap-px sm:grid-cols-2">
            {LANES.map((lane) => {
              const active = lane.id === model;
              return (
                <button
                  key={lane.id}
                  type="button"
                  onClick={() => setModel(lane.id)}
                  className={`flex items-baseline justify-between gap-3 border px-3 py-2 text-left text-[13px] ${
                    active ? "border-copper text-paper" : "border-rule text-muted-foreground"
                  }`}
                >
                  <span>{lane.label}</span>
                  <span
                    className={`font-mono text-[10px] ${
                      lane.cost === "$0" ? "text-ok" : "text-copper"
                    }`}
                  >
                    {lane.cost}
                  </span>
                </button>
              );
            })}
          </div>
        </fieldset>

        <div className="mt-3 flex flex-wrap items-center gap-2">
          <span className="font-mono text-[10px] uppercase tracking-[0.16em] text-faint">
            Sources
          </span>
          {SOURCE_COUNTS.map((count) => (
            <button
              key={count}
              type="button"
              onClick={() => setK(count)}
              className={`border px-2 py-1 font-mono text-[11px] tabular-nums ${
                count === k ? "border-copper text-copper" : "border-rule text-muted-foreground"
              }`}
            >
              {count}
            </button>
          ))}
          <button
            type="button"
            onClick={() => void ask()}
            disabled={asking || question.trim().length === 0}
            className="ml-auto border border-copper px-4 py-2 font-mono text-[11px] uppercase tracking-[0.14em] text-copper disabled:opacity-40"
          >
            Ask
          </button>
        </div>

        {status && <p className="mt-2 font-mono text-[10px] text-faint">{status}</p>}
      </Panel>

      {result && (
        <Panel title="Answer">
          {refused ? (
            <>
              <p className="whitespace-pre-wrap text-[14px] leading-[1.85] text-muted-foreground">
                {result.answer}
              </p>
              <p className="mt-3 font-mono text-[10px] leading-relaxed text-faint">
                The corpus does not cover this. That refusal is correct behaviour.
              </p>
            </>
          ) : (
            <p className="whitespace-pre-wrap text-[15px] leading-[1.85] text-paper">
              {result.answer}
            </p>
          )}

          <div className="mt-4 flex flex-wrap items-center gap-3 border-t border-rule pt-3">
            <span className="font-mono text-[10px] text-faint">{result.model ?? "—"}</span>
            <button
              type="button"
              onClick={() => void saveDraft()}
              className="ml-auto border border-rule px-3 py-1 font-mono text-[10px] uppercase tracking-[0.14em] text-muted-foreground hover:border-copper hover:text-copper"
            >
              Save to drafts
            </button>
          </div>
          {saved && <p className="mt-2 font-mono text-[10px] text-faint">{saved}</p>}
        </Panel>
      )}

      {result?.sources && result.sources.length > 0 && (
        <Panel title="Sources">
          <ul>
            {result.sources.map((source, index) => {
              const tone = distanceTone(source.distance);
              return (
                <li
                  key={`${source.path ?? source.file ?? "source"}-${index}`}
                  className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1 border-t border-rule py-2 first:border-t-0"
                >
                  <span className="break-all font-mono text-[12px] text-paper">
                    {source.file ?? source.path ?? "—"}
                  </span>
                  <span
                    className={`font-mono text-[10px] tabular-nums ${tone.className}`}
                    title={tone.title}
                  >
                    {source.distance != null ? source.distance.toFixed(3) : "—"}
                  </span>
                </li>
              );
            })}
          </ul>
        </Panel>
      )}
    </div>
  );
}
