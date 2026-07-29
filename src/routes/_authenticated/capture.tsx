import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useRef, useState } from "react";
import { InstallPrompt } from "@/components/InstallPrompt";
import { useOnline } from "@/hooks/use-online";
import {
  countPending,
  flushQueue,
  insertCaptureJob,
  queueCapture,
  type PendingCapture,
} from "@/lib/capture-queue";

export const Route = createFileRoute("/_authenticated/capture")({
  head: () => ({
    meta: [
      { title: "Capture — AgentHub Remote" },
      { name: "description", content: "Queue a thought for the machine to process locally." },
      { property: "og:title", content: "Capture — AgentHub Remote" },
      { property: "og:description", content: "Queue a thought for the machine to process locally." },
    ],
  }),
  component: CapturePage,
});

const TAGS = ["idea", "task", "client", "product", "admin"] as const;

function CapturePage() {
  const online = useOnline();
  const [text, setText] = useState("");
  const [tags, setTags] = useState<string[]>([]);
  const [pending, setPending] = useState(0);
  const [status, setStatus] = useState<{ tone: "ok" | "watch" | "risk"; text: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const field = useRef<HTMLTextAreaElement>(null);

  const refreshPending = () => countPending().then(setPending).catch(() => {});

  useEffect(() => {
    refreshPending();
    field.current?.focus();
  }, []);

  useEffect(() => {
    if (!online) return;
    flushQueue().then((sent) => {
      if (sent > 0) setStatus({ tone: "ok", text: `${sent} queued capture(s) sent` });
      refreshPending();
    });
  }, [online]);

  function toggleTag(tag: string) {
    setTags((current) =>
      current.includes(tag) ? current.filter((t) => t !== tag) : [...current, tag],
    );
  }

  async function onSubmit(event: React.FormEvent) {
    event.preventDefault();
    const value = text.trim();
    if (!value || busy) return;

    setBusy(true);
    const capture: PendingCapture = {
      id: crypto.randomUUID(),
      text: value.slice(0, 8000),
      tags,
      captured_at: new Date().toISOString(),
    };

    try {
      if (!navigator.onLine) throw new Error("offline");
      await insertCaptureJob(capture);
      setStatus({ tone: "ok", text: "Queued for the machine" });
    } catch {
      try {
        await queueCapture(capture);
        setStatus({ tone: "watch", text: "Saved on this device — sends when back online" });
      } catch {
        setStatus({ tone: "risk", text: "Could not save the capture" });
        setBusy(false);
        return;
      }
    }

    setText("");
    setTags([]);
    await refreshPending();
    setBusy(false);
    field.current?.focus();
  }

  return (
    <div>
      <InstallPrompt />

      <section className="border border-rule bg-panel p-5">
        <div className="flex items-baseline justify-between gap-4">
          <h2 className="font-serif text-3xl leading-none text-paper">Capture</h2>
          <span className="font-mono text-[11px] uppercase tracking-[0.14em] text-faint">
            {pending > 0 ? `${pending} waiting` : online ? "live" : "offline"}
          </span>
        </div>

        <form onSubmit={onSubmit} className="mt-6 space-y-4">
          <textarea
            ref={field}
            value={text}
            onChange={(e) => setText(e.target.value)}
            rows={7}
            maxLength={8000}
            placeholder="A thought…"
            className="w-full resize-y border border-rule bg-panel2 p-3 font-sans text-[15px] leading-relaxed text-paper placeholder:text-faint focus:border-copper focus:outline-none"
          />

          <div className="flex flex-wrap gap-2">
            {TAGS.map((tag) => {
              const active = tags.includes(tag);
              return (
                <button
                  key={tag}
                  type="button"
                  onClick={() => toggleTag(tag)}
                  aria-pressed={active}
                  className={`border px-2 py-1 font-mono text-[11px] uppercase tracking-[0.12em] transition-colors ${
                    active
                      ? "border-copper text-copper"
                      : "border-rule text-faint hover:text-paper"
                  }`}
                >
                  {tag}
                </button>
              );
            })}
          </div>

          <button
            type="submit"
            disabled={busy || text.trim().length === 0}
            className="h-12 w-full border border-copper font-mono text-[12px] uppercase tracking-[0.16em] text-copper transition-colors hover:bg-copper hover:text-ink disabled:opacity-40"
          >
            {busy ? "Saving" : online ? "Capture" : "Capture offline"}
          </button>
        </form>

        {status && (
          <p
            role="status"
            className={`mt-4 font-mono text-[12px] ${
              status.tone === "ok" ? "text-ok" : status.tone === "watch" ? "text-watch" : "text-risk"
            }`}
          >
            {status.text}
          </p>
        )}
      </section>

      <p className="mt-4 font-mono text-[11px] leading-relaxed text-faint">
        Captures are queued as jobs. The machine claims them on its next outbound poll,
        within 30 seconds. Nothing is read back here.
      </p>
    </div>
  );
}
