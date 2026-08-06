/**
 * Omnibox — one field, four outcomes, interpretation shown before anything happens.
 *
 * The classifier only changes how fast an action is reached; it never widens what
 * the system may do. A build still runs through the machine's own approval dialog
 * for protected paths, exactly as it does when started from the Build view.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useNavigate } from "@tanstack/react-router";
import { useQueryClient } from "@tanstack/react-query";
import { isRefusal, useLocal } from "@/lib/local-bridge";
import { AskSurface } from "@/components/AskSurface";
import { useJobDrawer } from "@/lib/job-drawer";
import { insertCaptureJob, queueCapture, type PendingCapture } from "@/lib/capture-queue";

export type Intent = "capture" | "ask" | "build" | "search";

const INTENTS: Intent[] = ["capture", "ask", "build", "search"];

/**
 * Build is opt-in and never auto-selected. Capture and build are not separable
 * from the text — "the cost page should show a weekly average" is both a thought
 * to record and a change to make, and only the operator knows which. Build is the
 * only intent that writes, so auto-selecting it started work nobody asked for.
 */
const CLASSIFIED: Intent[] = ["capture", "ask", "search"];

const EXAMPLES: Record<Intent, string[]> = {
  capture: [
    "capture · Neelam wants the envelope report weekly, not monthly",
    "capture · the router should log alias misses",
    "capture · idea: a skill that summarises client calls",
  ],
  ask: [
    "ask · what did the digest flag yesterday",
    "ask · which projects are past their WIP limit",
    "ask · what does the backup job actually copy",
  ],
  build: [
    "build · add a stale badge to the corpus table",
    "build · make the nightly digest include eval drift",
    "build · tighten the approval dialog copy",
  ],
  search: [
    "search · everything I asked about tax last month",
    "search · where the intake prompt was corrected",
    "search · previous answers about the cascade",
  ],
};

/** Three examples, one intent each, chosen fresh on every page load. */
function pickExamples() {
  const intents = [...INTENTS].sort(() => Math.random() - 0.5).slice(0, 3);
  return intents.map((intent) => {
    const pool = EXAMPLES[intent];
    return pool[Math.floor(Math.random() * pool.length)];
  });
}

type Status = { tone: "muted" | "copper" | "risk"; text: string } | null;

export function Omnibox() {
  const local = useLocal();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const { trackJob } = useJobDrawer();

  const [text, setText] = useState("");
  const [intent, setIntent] = useState<Intent>("capture");
  const [overridden, setOverridden] = useState(false);
  const [classifying, setClassifying] = useState(false);
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState<Status>(null);
  const [answer, setAnswer] = useState<{ text: string; model?: string; sources?: AskSource[] } | null>(null);
  const examples = useMemo(pickExamples, []);
  const field = useRef<HTMLInputElement>(null);
  const seq = useRef(0);

  const value = text.trim();

  /** Classification is a local-plane read on the pinned 4B — free, sub-second. */
  useEffect(() => {
    if (!local.available || overridden) return;
    if (value.length < 3) {
      setIntent("capture");
      return;
    }
    const ticket = ++seq.current;
    const timer = window.setTimeout(async () => {
      setClassifying(true);
      try {
        const result = await local.post<{ intent?: string }>("/api/classify", { text: value });
        const next = String(result?.intent ?? "").toLowerCase();
        if (ticket === seq.current && (CLASSIFIED as string[]).includes(next)) {
          setIntent(next as Intent);
        }
      } catch {
        // A classifier miss leaves the last interpretation standing — never an error.
      } finally {
        if (ticket === seq.current) setClassifying(false);
      }
    }, 400);
    return () => window.clearTimeout(timer);
  }, [value, local, overridden]);

  const cycle = useCallback(() => {
    setOverridden(true);
    setIntent((current) => INTENTS[(INTENTS.indexOf(current) + 1) % INTENTS.length]);
  }, []);

  const commit = useCallback(
    async (forced?: Intent) => {
      const body = text.trim();
      if (!body || busy) return;
      const target = forced ?? (local.available ? intent : "capture");
      setBusy(true);
      setStatus(null);
      setAnswer(null);
      try {
        if (target === "capture") {
          const capture: PendingCapture = {
            id: crypto.randomUUID(),
            text: body,
            captured_at: new Date().toISOString(),
          };
          try {
            if (!navigator.onLine) throw new Error("offline");
            await insertCaptureJob(capture);
            await queryClient.invalidateQueries({ queryKey: ["captures"] });
            setStatus({ tone: "copper", text: "Captured — queued for the machine." });
          } catch {
            await queueCapture(capture);
            setStatus({ tone: "muted", text: "Held on this device; it goes up on reconnect." });
          }
          setText("");
          setOverridden(false);
        } else if (target === "ask") {
          // Sources return in under a second; the answer streams beneath them.
          const result = await askProgressive(
            LOCAL_BASE,
            local.post,
            { q: body, model: "", k: 6 },
            {
              sources: (sources) =>
                setAnswer((current) => ({ text: current?.text ?? "", sources })),
              delta: (partial) =>
                setAnswer((current) => ({ ...current, text: partial })),
            },
          );
          setAnswer({ text: result.answer || "—", model: result.model, sources: result.sources });
        } else if (target === "build") {
          const started = await local.post<{ job: string }>("/api/build", { intent: body });
          if (started?.job) {
            trackJob(started.job, "build", body.slice(0, 60));
            setStatus({ tone: "copper", text: "Build started — output below." });
            setText("");
            setOverridden(false);
          }
        } else {
          await navigate({ to: "/memory", search: { q: body } });
        }
      } catch (error) {
        setStatus(
          isRefusal(error)
            ? { tone: "muted", text: "Denied at the approval dialog on the machine." }
            : { tone: "risk", text: error instanceof Error ? error.message : "That did not go through." },
        );
      } finally {
        setBusy(false);
        field.current?.focus();
      }
    },
    [text, busy, intent, local, navigate, queryClient, trackJob],
  );

  const onKeyDown = (event: React.KeyboardEvent<HTMLInputElement>) => {
    const meta = event.metaKey || event.ctrlKey;
    if (meta && /^[1-4]$/.test(event.key)) {
      event.preventDefault();
      setOverridden(true);
      setIntent(INTENTS[Number(event.key) - 1]);
      return;
    }
    if (event.key === "Enter") {
      event.preventDefault();
      // Cmd+Enter forces ask — the reading path, which never writes.
      void commit(meta ? (local.available ? "ask" : "capture") : undefined);
    }
  };

  const chipLabel = !local.available
    ? "Available on the machine"
    : classifying
      ? "reading…"
      : intent;

  return (
    <section className="space-y-2">
      <div className="relative flex h-14 items-center border border-rule bg-panel focus-within:border-copper">
        <input
          ref={field}
          value={text}
          onChange={(event) => {
            setText(event.target.value);
            setOverridden(false);
          }}
          onKeyDown={onKeyDown}
          disabled={busy}
          placeholder="Capture a thought, ask a question, or describe a change"
          aria-label="Capture a thought, ask a question, or describe a change"
          className="h-full min-w-0 flex-1 bg-transparent px-4 font-serif text-[17px] text-paper outline-none placeholder:text-faint"
        />
        <button
          type="button"
          onClick={() => local.available && cycle()}
          disabled={!local.available}
          title={
            local.available
              ? "Click to cycle the interpretation · ⌘1 capture, ⌘2 ask, ⌘3 build, ⌘4 search"
              : "This reads on the machine. Enter still captures."
          }
          className={`mr-2 shrink-0 whitespace-nowrap border px-2.5 py-1.5 font-mono text-[10px] uppercase tracking-[0.12em] ${
            local.available
              ? "border-copper text-copper hover:bg-copper/10"
              : "cursor-default border-rule text-faint"
          }`}
        >
          {chipLabel}
        </button>
      </div>

      {local.available && intent === "capture" && (
        <p className="font-mono text-[11px] text-faint">
          Press ⌘3 to build this instead of recording it.
        </p>
      )}

      <div className="flex flex-wrap items-center gap-x-4 gap-y-1 font-mono text-[11px] text-faint">
        {examples.map((example) => (
          <span key={example}>{example}</span>
        ))}
      </div>


      {status && (
        <p
          className={`font-mono text-[11px] ${
            status.tone === "risk" ? "text-risk" : status.tone === "copper" ? "text-copper" : "text-faint"
          }`}
        >
          {status.text}
        </p>
      )}

      {answer && (
        <div className="border border-rule bg-panel p-4">
          {(answer.sources?.length ?? 0) > 0 && (
            <ul className="mb-3 space-y-1 border-b border-rule pb-3">
              {answer.sources?.map((source, index) => (
                <li key={index} className="flex items-baseline gap-2 font-mono text-[10px]">
                  <span className="min-w-0 flex-1 truncate text-muted-foreground">
                    {source.file ?? "source"}
                  </span>
                  <span
                    className={`tabular-nums ${
                      (source.distance ?? 1) < 0.5
                        ? "text-ok"
                        : (source.distance ?? 1) > 0.7
                          ? "text-watch"
                          : "text-faint"
                    }`}
                  >
                    {typeof source.distance === "number" ? source.distance.toFixed(3) : "—"}
                  </span>
                </li>
              ))}
            </ul>
          )}
          <p className="whitespace-pre-wrap text-[14px] leading-[1.7] text-paper">
            {answer.text || "writing…"}
          </p>
          {answer.model && (
            <p className="mt-2 font-mono text-[10px] uppercase tracking-[0.12em] text-faint">
              {answer.model}
            </p>
          )}
        </div>
      )}

    </section>
  );
}
