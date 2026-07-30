import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useRef, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { InstallPrompt } from "@/components/InstallPrompt";
import { useOnline } from "@/hooks/use-online";
import {
  countPending,
  flushQueue,
  insertCaptureJob,
  listPending,
  queueCapture,
  type PendingCapture,
} from "@/lib/capture-queue";
import { capturesQueryOptions, clockTime, relativeTime, type CaptureRow } from "@/lib/captures";

export const Route = createFileRoute("/_authenticated/capture")({
  head: () => ({
    meta: [
      { title: "Capture — AgentHub" },
      {
        name: "description",
        content: "Record a thought from anywhere. It reaches the machine on its next poll.",
      },
      { property: "og:title", content: "Capture — AgentHub" },
      {
        property: "og:description",
        content: "Record a thought from anywhere. It reaches the machine on its next poll.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: CapturePage,
});

const STATE_STYLE: Record<CaptureRow["state"], string> = {
  held: "border-watch/60 text-watch",
  queued: "border-rule text-muted-foreground",
  delivered: "border-ok/60 text-ok",
  failed: "border-risk/60 text-risk",
};

function CapturePage() {
  const online = useOnline();
  const queryClient = useQueryClient();
  const field = useRef<HTMLTextAreaElement>(null);

  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const [held, setHeld] = useState<CaptureRow[]>([]);
  const [optimistic, setOptimistic] = useState<CaptureRow[]>([]);

  const { data: sent } = useQuery(capturesQueryOptions);

  async function refreshHeld() {
    try {
      const pending = await listPending();
      setHeld(
        pending
          .map((item) => ({
            id: item.id,
            text: item.text,
            captured_at: item.captured_at,
            state: "held" as const,
          }))
          .reverse(),
      );
    } catch {
      /* IndexedDB unavailable — the capture still reaches the queue when online */
    }
  }

  useEffect(() => {
    field.current?.focus();
    refreshHeld();
  }, []);

  // Reconnect: flush held captures with no user action.
  useEffect(() => {
    if (!online) return;
    let cancelled = false;
    flushQueue().then(async (flushed) => {
      if (cancelled) return;
      await refreshHeld();
      if (flushed > 0) queryClient.invalidateQueries({ queryKey: ["captures"] });
      await countPending().catch(() => 0);
    });
    return () => {
      cancelled = true;
    };
  }, [online, queryClient]);

  async function submit() {
    const value = text.trim();
    if (!value || busy) return;
    setBusy(true);

    const capture: PendingCapture = {
      id: crypto.randomUUID(),
      text: value,
      captured_at: new Date().toISOString(),
    };

    // Optimistic: the note is on screen before the network is consulted.
    setText("");
    setOptimistic((current) => [
      { id: capture.id, text: capture.text, captured_at: capture.captured_at, state: "queued" },
      ...current,
    ]);
    field.current?.focus();

    try {
      if (!navigator.onLine) throw new Error("offline");
      await insertCaptureJob(capture);
      await queryClient.invalidateQueries({ queryKey: ["captures"] });
      setOptimistic((current) => current.filter((item) => item.id !== capture.id));
    } catch {
      setOptimistic((current) => current.filter((item) => item.id !== capture.id));
      try {
        await queueCapture(capture);
        await refreshHeld();
      } catch {
        setOptimistic((current) => [
          { id: capture.id, text: capture.text, captured_at: capture.captured_at, state: "failed" },
          ...current,
        ]);
      }
    } finally {
      setBusy(false);
    }
  }

  function onKeyDown(event: React.KeyboardEvent<HTMLTextAreaElement>) {
    if ((event.metaKey || event.ctrlKey) && event.key === "Enter") {
      event.preventDefault();
      void submit();
    }
  }

  const feed = [...optimistic, ...held, ...(sent ?? [])].slice(0, 20);

  return (
    <div className="space-y-6">
      <InstallPrompt />

      <section className="border border-rule bg-panel p-5">
        <div className="flex items-baseline justify-between gap-4">
          <h2 className="font-serif text-3xl leading-none text-paper">Capture</h2>
          <span className="font-mono text-[10px] uppercase tracking-[0.14em] text-faint">
            {online ? "live" : "offline"}
          </span>
        </div>

        <form
          onSubmit={(event) => {
            event.preventDefault();
            void submit();
          }}
          className="mt-5 space-y-4"
        >
          <textarea
            ref={field}
            value={text}
            onChange={(event) => setText(event.target.value)}
            onKeyDown={onKeyDown}
            rows={8}
            autoFocus
            placeholder="A thought, a decision, a reminder…"
            className="w-full resize-y border border-rule bg-panel2 p-4 font-sans text-[16px] leading-[1.75] text-paper placeholder:text-faint focus:border-copper focus:outline-none"
          />

          <button
            type="submit"
            disabled={busy || text.trim().length === 0}
            className="h-12 w-full border border-copper font-mono text-[12px] uppercase tracking-[0.16em] text-copper transition-colors hover:bg-copper hover:text-ink disabled:cursor-not-allowed disabled:border-rule disabled:text-faint disabled:hover:bg-transparent disabled:hover:text-faint"
          >
            Send to AgentHub
          </button>

          <p className="font-mono text-[10px] text-faint">
            {online
              ? "⌘/Ctrl + Enter sends · claimed within 30s"
              : "Held on this device — sends itself when you reconnect"}
          </p>
        </form>
      </section>

      <section>
        <h3 className="font-mono text-[10px] uppercase tracking-[0.14em] text-faint">Recent</h3>
        {feed.length > 0 ? (
          <ul className="mt-3">
            {feed.map((item) => (
              <li key={item.id} className="border-t border-rule py-4 first:border-t-0">
                <p className="whitespace-pre-wrap break-words text-[15px] leading-relaxed text-paper">
                  {item.text}
                </p>
                <div className="mt-2.5 flex items-center gap-3">
                  <span className="font-mono text-[10px] tabular-nums text-faint">
                    {relativeTime(item.captured_at)} · {clockTime(item.captured_at)}
                  </span>
                  <span
                    className={`border px-2 py-0.5 font-mono text-[10px] uppercase tracking-[0.12em] ${STATE_STYLE[item.state]}`}
                  >
                    {item.state === "held" ? "held" : item.state}
                  </span>
                </div>
              </li>
            ))}
          </ul>
        ) : (
          <p className="mt-3 font-mono text-[11px] text-faint">Nothing captured yet.</p>
        )}
      </section>
    </div>
  );
}
