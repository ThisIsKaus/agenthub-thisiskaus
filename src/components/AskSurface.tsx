/**
 * The one Ask surface. It lives beneath the omnibox on Overview and nowhere
 * else: lane selection, source count, grouped sources as soon as they return,
 * the answer streaming beneath with an elapsed counter, and save to drafts.
 *
 * Every call is a local-plane read over loopback. Nothing here is published.
 */
import { useCallback, useEffect, useRef, useState } from "react";
import { isRefusal, useLocal, LOCAL_BASE } from "@/lib/local-bridge";
import { askProgressive, type AskSource } from "@/lib/ask-stream";

const LANES = [
  { id: "local-brain", label: "Local brain 35B", cost: "$0" },
  { id: "local-coder", label: "Local coder 27B", cost: "$0" },
  { id: "cloud-work", label: "Cloud work Sonnet", cost: "metered" },
  { id: "cloud-deep", label: "Cloud deep Opus", cost: "metered" },
] as const;

const SOURCE_COUNTS = [5, 8, 12] as const;

const REFUSAL = /not in corpus|no relevant|not covered|cannot answer from the corpus/i;

type GroupedSource = { name: string; best: number | undefined; passages: number };

/** One row per file: its best (lowest) distance, and how many chunks matched. */
function groupSources(sources: AskSource[]): GroupedSource[] {
  const byName = new Map<string, GroupedSource>();
  for (const source of sources) {
    const name = source.file ?? source.path ?? "—";
    const existing = byName.get(name);
    if (!existing) {
      byName.set(name, { name, best: source.distance, passages: 1 });
      continue;
    }
    existing.passages += 1;
    if (source.distance != null && (existing.best == null || source.distance < existing.best)) {
      existing.best = source.distance;
    }
  }
  return [...byName.values()].sort((a, b) => (a.best ?? Infinity) - (b.best ?? Infinity));
}

function distanceTone(distance: number | undefined) {
  if (distance == null) return { className: "text-faint", title: undefined as string | undefined };
  if (distance < 0.5) return { className: "text-ok", title: undefined };
  if (distance <= 0.7) return { className: "text-muted-foreground", title: undefined };
  return { className: "text-watch", title: "weak match — the corpus may not cover this" };
}

export function AskSurface({ question, onClose }: { question: string; onClose?: () => void }) {
  const local = useLocal();
  const [model, setModel] = useState<string>(LANES[0].id);
  const [k, setK] = useState<number>(8);
  const [answer, setAnswer] = useState("");
  const [answeredBy, setAnsweredBy] = useState<string | undefined>();
  const [sources, setSources] = useState<AskSource[]>([]);
  const [status, setStatus] = useState<string | null>(null);
  const [asking, setAsking] = useState(false);
  const [saved, setSaved] = useState<string | null>(null);
  const [elapsed, setElapsed] = useState(0);
  const [askedK, setAskedK] = useState<number>(8);
  const running = useRef(false);

  // A number is honest; a spinner alone is decoration.
  useEffect(() => {
    if (!asking) return;
    const started = Date.now();
    setElapsed(0);
    const timer = setInterval(() => setElapsed(Math.floor((Date.now() - started) / 1000)), 1000);
    return () => clearInterval(timer);
  }, [asking]);

  const ask = useCallback(
    async (lane: string, count: number) => {
      const q = question.trim();
      if (!q || running.current) return;
      running.current = true;
      setAsking(true);
      setSaved(null);
      setStatus("retrieving from the corpus…");
      setAnswer("");
      setAnsweredBy(undefined);
      setSources([]);
      setAskedK(count);
      try {
        // k is sent explicitly on every request — the machine does not assume a default.
        const result = await askProgressive(
          LOCAL_BASE,
          local.post,
          { q, model: lane, k: count },
          {
            sources: (found) => {
              setSources(found);
              setStatus("thinking on the machine…");
            },
            delta: (text) => setAnswer(text),
          },
        );
        setAnswer(result.answer);
        setAnsweredBy(result.model);
        setSources(result.sources);
        setStatus(null);
      } catch (error) {
        setAnswer("");
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
    [local, question],
  );

  // The question arrives already typed: answer it without a second press.
  useEffect(() => {
    void ask(model, k);
    // Re-running is deliberate on a new question only; lane and count re-ask by hand.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [question]);

  async function saveDraft() {
    if (!answer) return;
    setSaved("awaiting approval on the machine…");
    try {
      const data = await local.post<{ path?: string; name?: string }>("/api/draft", {
        title: question.trim().slice(0, 80) || "Untitled",
        body: answer,
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

  const refused = answer ? REFUSAL.test(answer) : false;

  return (
    <div className="border border-rule bg-panel" data-testid="ask-surface">
      <div className="flex flex-wrap items-center gap-2 border-b border-rule px-4 py-2.5">
        <span className="font-mono text-[10px] uppercase tracking-[0.16em] text-copper">Ask</span>
        <span className="min-w-0 flex-1 truncate font-mono text-[10px] text-faint">{question}</span>
        {onClose && (
          <button
            type="button"
            onClick={onClose}
            className="font-mono text-[10px] uppercase tracking-[0.12em] text-faint hover:text-copper"
          >
            Close · esc
          </button>
        )}
      </div>

      <div className="border-b border-rule px-4 py-3">
        <div className="grid grid-cols-1 gap-px sm:grid-cols-2">
          {LANES.map((lane) => {
            const active = lane.id === model;
            return (
              <button
                key={lane.id}
                type="button"
                onClick={() => {
                  setModel(lane.id);
                  void ask(lane.id, k);
                }}
                className={`flex items-baseline justify-between gap-3 border px-3 py-2 text-left text-[13px] ${
                  active ? "border-copper text-paper" : "border-rule text-muted-foreground"
                }`}
              >
                <span>{lane.label}</span>
                <span
                  className={`font-mono text-[10px] ${lane.cost === "$0" ? "text-ok" : "text-copper"}`}
                >
                  {lane.cost}
                </span>
              </button>
            );
          })}
        </div>

        <div className="mt-3 flex flex-wrap items-center gap-2">
          <span className="font-mono text-[10px] uppercase tracking-[0.16em] text-faint">
            Sources
          </span>
          {SOURCE_COUNTS.map((count) => (
            <button
              key={count}
              type="button"
              onClick={() => {
                setK(count);
                void ask(model, count);
              }}
              className={`border px-2 py-1 font-mono text-[11px] tabular-nums ${
                count === k ? "border-copper text-copper" : "border-rule text-muted-foreground"
              }`}
            >
              {count}
            </button>
          ))}
          <button
            type="button"
            onClick={() => void ask(model, k)}
            disabled={asking}
            className="ml-auto border border-copper px-3 py-1.5 font-mono text-[10px] uppercase tracking-[0.14em] text-copper disabled:opacity-40"
          >
            {asking ? "Asking…" : "Ask again"}
          </button>
        </div>

        {status && (
          <div className="mt-2 space-y-1">
            <p className="font-mono text-[10px] tabular-nums text-faint">
              {status}
              {asking && <span className="ml-2 text-muted-foreground">{elapsed}s</span>}
            </p>
            {asking && elapsed >= 20 && (
              <p className="font-mono text-[10px] text-faint">
                the 35B reasons before answering — this is normal
              </p>
            )}
          </div>
        )}
      </div>

      {sources.length > 0 && (
        <div className="border-b border-rule px-4 py-3">
          <p className="font-mono text-[10px] uppercase tracking-[0.16em] text-faint">Sources</p>
          <ul className="mt-2">
            {groupSources(sources).map((source) => {
              const tone = distanceTone(source.best);
              return (
                <li
                  key={source.name}
                  className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1 border-t border-rule py-2 first:border-t-0"
                >
                  <span className="break-all font-mono text-[12px] text-paper">
                    {source.name}
                    {source.passages > 1 && (
                      <span className="ml-2 text-faint">{source.passages} passages</span>
                    )}
                  </span>
                  <span
                    className={`font-mono text-[10px] tabular-nums ${tone.className}`}
                    title={tone.title}
                  >
                    {source.best != null ? source.best.toFixed(3) : "—"}
                  </span>
                </li>
              );
            })}
          </ul>
          <p className="mt-2 font-mono text-[10px] tabular-nums text-faint">
            found_by retrieval · {sources.length} of {askedK} requested
          </p>
        </div>
      )}

      {answer && (
        <div className="px-4 py-3">
          {refused ? (
            <>
              <p className="max-w-[72ch] whitespace-pre-wrap break-words text-[14px] leading-[1.85] text-muted-foreground">
                {answer}
              </p>
              <p className="mt-3 font-mono text-[10px] leading-relaxed text-faint">
                The corpus does not cover this. That refusal is correct behaviour.
              </p>
            </>
          ) : (
            <p className="max-w-[72ch] whitespace-pre-wrap break-words text-[15px] leading-[1.85] text-paper">
              {answer}
            </p>
          )}

          <div className="mt-4 flex flex-wrap items-center gap-3 border-t border-rule pt-3">
            <span className="font-mono text-[10px] text-faint">{answeredBy ?? model}</span>
            <button
              type="button"
              onClick={() => void saveDraft()}
              className="ml-auto border border-rule px-3 py-1 font-mono text-[10px] uppercase tracking-[0.14em] text-muted-foreground hover:border-copper hover:text-copper"
            >
              Save to drafts
            </button>
          </div>
          {saved && <p className="mt-2 font-mono text-[10px] text-faint">{saved}</p>}
        </div>
      )}
    </div>
  );
}
