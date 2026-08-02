import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useCallback, useEffect, useRef, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Panel } from "@/components/AppShell";
import { Page } from "@/components/Page";

import { Empty, Skeleton } from "@/components/data";
import { InstallPrompt } from "@/components/InstallPrompt";
import { useOnline } from "@/hooks/use-online";
import { isRefusal, useLocal } from "@/lib/local-bridge";
import { capturesQueryOptions, clockTime, relativeTime, type CaptureRow } from "@/lib/captures";
import {
  countPending,
  flushQueue,
  insertCaptureJob,
  listPending,
  queueCapture,
  type PendingCapture,
} from "@/lib/capture-queue";


export const Route = createFileRoute("/_authenticated/inbox")({
  head: () => ({
    meta: [
      { title: "Inbox — AgentHub" },
      {
        name: "description",
        content:
          "One stream: everything captured and everything read overnight, each line taken to one of four exits — drop, context, skill or canvas.",
      },
      { property: "og:title", content: "Inbox — AgentHub" },
      {
        property: "og:description",
        content:
          "One stream: everything captured and everything read overnight, each line taken to one of four exits — drop, context, skill or canvas.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: () => (
    <Page title="Inbox" subtitle="One stream in, four exits out: dropped, filed as context, written up as a skill, or opened as a canvas." footer="Inbox · captures queue on the device and deliver when the machine polls">
      <InboxPage />
    </Page>
  ),
});

type DigestItem = { flag?: string; src?: string; cls?: string; ent?: string; sen?: string; one?: string };
type DigestData = { date?: string; items?: DigestItem[]; dates?: string[] };

const CLASSES = ["note", "task", "decision", "reference", "finance", "client", "product"];
const ENTITIES = ["personal", "Agenticality", "NXI", "Envelope Collective", "client"];
const SENSITIVITIES = ["S0", "S1p", "S1c", "S2", "S3"];
const INJECTIONS = ["none", "suspected", "confirmed"];

const STATE_STYLE: Record<CaptureRow["state"], string> = {
  held: "border-watch/60 text-watch",
  queued: "border-rule text-muted-foreground",
  delivered: "border-ok/60 text-ok",
  failed: "border-risk/60 text-risk",
};

function InboxPage() {
  return (
    <div className="space-y-4">
      <CaptureLane />
      <TriageLane />
    </div>
  );
}

/* ---------------------------------------------------------------- capture */

function CaptureLane() {
  const online = useOnline();
  const queryClient = useQueryClient();
  const field = useRef<HTMLTextAreaElement>(null);

  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const [held, setHeld] = useState<CaptureRow[]>([]);
  const [optimistic, setOptimistic] = useState<CaptureRow[]>([]);

  const { data: sent } = useQuery(capturesQueryOptions);

  const refreshHeld = useCallback(async () => {
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
  }, []);

  useEffect(() => {
    field.current?.focus();
    void refreshHeld();
  }, [refreshHeld]);

  useEffect(() => {
    if (!online) return;
    let cancelled = false;
    void flushQueue().then(async (flushed) => {
      if (cancelled) return;
      await refreshHeld();
      if (flushed > 0) queryClient.invalidateQueries({ queryKey: ["captures"] });
      await countPending().catch(() => 0);
    });
    return () => {
      cancelled = true;
    };
  }, [online, queryClient, refreshHeld]);

  async function submit() {
    const value = text.trim();
    if (!value || busy) return;
    setBusy(true);

    const capture: PendingCapture = {
      id: crypto.randomUUID(),
      text: value,
      captured_at: new Date().toISOString(),
    };

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

  const feed = [...optimistic, ...held, ...(sent ?? [])].slice(0, 20);

  return (
    <>
      <InstallPrompt />
      <section className="border border-rule bg-panel p-4">
        <div className="flex items-baseline justify-between gap-4">
          <h2 className="font-mono text-[10px] uppercase tracking-[0.16em] text-copper">
            Capture · in
          </h2>
          <span className="font-mono text-[10px] uppercase tracking-[0.14em] text-faint">
            {online ? "live" : "offline"}
          </span>
        </div>
        <form
          onSubmit={(event) => {
            event.preventDefault();
            void submit();
          }}
          className="mt-3 space-y-3"
        >
          <textarea
            ref={field}
            value={text}
            onChange={(event) => setText(event.target.value)}
            onKeyDown={(event) => {
              if ((event.metaKey || event.ctrlKey) && event.key === "Enter") {
                event.preventDefault();
                void submit();
              }
            }}
            rows={5}
            placeholder="A thought, a decision, a reminder…"
            className="w-full resize-y border border-rule bg-panel2 p-4 font-sans text-[16px] leading-[1.75] text-paper placeholder:text-faint focus:border-copper focus:outline-none"
          />
          <button
            type="submit"
            disabled={busy || text.trim().length === 0}
            className="h-11 w-full border border-copper font-mono text-[11px] uppercase tracking-[0.16em] text-copper transition-colors hover:bg-copper hover:text-ink disabled:cursor-not-allowed disabled:border-rule disabled:text-faint disabled:hover:bg-transparent disabled:hover:text-faint"
          >
            Send to AgentHub
          </button>
          <p className="font-mono text-[10px] text-faint">
            {online
              ? "⌘/Ctrl + Enter sends · claimed within 30s"
              : "Held on this device — sends itself when you reconnect"}
          </p>
        </form>

        {feed.length > 0 && (
          <ul className="mt-4 border-t border-rule pt-2">
            {feed.map((item) => (
              <li key={item.id} className="border-t border-rule py-3 first:border-t-0">
                <p className="whitespace-pre-wrap break-words text-[14px] leading-relaxed text-paper">
                  {item.text}
                </p>
                <div className="mt-2 flex items-center gap-3">
                  <span className="font-mono text-[10px] tabular-nums text-faint">
                    {relativeTime(item.captured_at)} · {clockTime(item.captured_at)}
                  </span>
                  <span
                    className={`border px-2 py-0.5 font-mono text-[10px] uppercase tracking-[0.12em] ${STATE_STYLE[item.state]}`}
                  >
                    {item.state}
                  </span>
                </div>
              </li>
            ))}
          </ul>
        )}
      </section>
    </>
  );
}

/* ----------------------------------------------------------------- triage */

type Exit = "dropped" | "context" | "skill" | "canvas";

function TriageLane() {
  const local = useLocal();
  const navigate = useNavigate();
  const [date, setDate] = useState<string | undefined>(undefined);
  const [data, setData] = useState<DigestData | null>(null);
  const [loading, setLoading] = useState(true);
  const [taken, setTaken] = useState<Record<number, Exit>>({});
  const [openIndex, setOpenIndex] = useState<number | null>(null);
  const [note, setNote] = useState<string | null>(null);

  const load = useCallback(
    async (target?: string) => {
      setLoading(true);
      try {
        setData(await local.get<DigestData>("/api/digest", { date: target }));
      } catch {
        setData(null);
      } finally {
        setLoading(false);
      }
    },
    [local],
  );

  useEffect(() => {
    if (local.available) void load(date);
    else setLoading(false);
  }, [date, load, local.available]);

  if (!local.available) {
    return (
      <Panel title="Overnight · stream">
        <Empty>Available on the machine. This section reads material that never leaves it.</Empty>
      </Panel>
    );
  }

  const items = data?.items ?? [];
  const open = items.filter((_, index) => !taken[index]).length;

  async function toContext(index: number, item: DigestItem) {
    setNote("filing on the machine…");
    try {
      await local.post("/api/capture", { text: item.one ?? "" });
      setTaken((current) => ({ ...current, [index]: "context" }));
      setNote(null);
    } catch (error) {
      setNote(isRefusal(error) ? "denied at the approval dialog" : "the machine did not file that");
    }
  }

  return (
    <section className="space-y-3">
      <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-2 border border-rule bg-panel px-4 py-2.5">
        <h2 className="font-mono text-[10px] uppercase tracking-[0.16em] text-copper">
          Overnight · {data?.date ?? "—"}
        </h2>
        <span className="font-mono text-[10px] text-faint">
          {open} undecided of {items.length}
        </span>
      </div>

      {(data?.dates ?? []).length > 1 && (
        <div className="flex flex-wrap gap-2">
          {(data?.dates ?? []).map((option) => (
            <button
              key={option}
              type="button"
              onClick={() => {
                setTaken({});
                setDate(option);
              }}
              className={`border px-2 py-1 font-mono text-[10px] ${
                (date ?? data?.date) === option
                  ? "border-copper text-copper"
                  : "border-rule text-muted-foreground hover:text-copper"
              }`}
            >
              {option}
            </button>
          ))}
        </div>
      )}

      <Panel title="Stream">
        {loading ? (
          <div className="space-y-3">
            {Array.from({ length: 5 }).map((_, index) => (
              <Skeleton key={index} className="h-10 w-full" />
            ))}
          </div>
        ) : items.length === 0 ? (
          <Empty>Nothing was read overnight.</Empty>
        ) : (
          <ul>
            {items.map((item, index) => {
              const flagged = Boolean(item.flag);
              const exit = taken[index];
              return (
                <li key={index} className="border-t border-rule py-3 first:border-t-0">
                  <div className="flex flex-wrap items-baseline gap-2">
                    <span
                      className={`border px-1.5 py-0.5 font-mono text-[10px] uppercase tracking-[0.12em] ${
                        flagged ? "border-watch text-watch" : "border-rule text-muted-foreground"
                      }`}
                    >
                      {flagged ? "FLAG" : (item.cls ?? "item")}
                    </span>
                    <span className="min-w-0 flex-1 text-[14px] leading-relaxed text-paper">
                      {item.one}
                    </span>
                  </div>
                  <p className="mt-1 break-all font-mono text-[10px] text-faint">
                    {[item.src, item.ent, item.sen].filter(Boolean).join(" · ")}
                  </p>

                  {exit ? (
                    <p className="mt-2 font-mono text-[10px] uppercase tracking-[0.12em] text-copper">
                      {exit === "dropped" ? "dropped" : `→ ${exit}`}
                    </p>
                  ) : (
                    <div className="mt-2 flex flex-wrap gap-2">
                      <ExitButton
                        label="Drop"
                        onClick={() => setTaken((current) => ({ ...current, [index]: "dropped" }))}
                      />
                      <ExitButton label="Context" onClick={() => void toContext(index, item)} />
                      <ExitButton
                        label="Skill"
                        onClick={() => {
                          setTaken((current) => ({ ...current, [index]: "skill" }));
                          void navigate({ to: "/skills", search: { seed: item.one ?? "" } });
                        }}
                      />
                      <ExitButton
                        label="Canvas"
                        onClick={() => {
                          setTaken((current) => ({ ...current, [index]: "canvas" }));
                          void navigate({ to: "/canvas", search: { seed: item.one ?? "" } });
                        }}
                      />
                      <button
                        type="button"
                        onClick={() => setOpenIndex(openIndex === index ? null : index)}
                        className="font-mono text-[10px] uppercase tracking-[0.12em] text-faint hover:text-copper"
                      >
                        Wrong class?
                      </button>
                    </div>
                  )}

                  {openIndex === index && !exit && (
                    <CorrectRow
                      item={item}
                      onDone={() => {
                        setOpenIndex(null);
                        setNote("correction recorded as a golden eval item");
                      }}
                      onNote={setNote}
                    />
                  )}
                </li>
              );
            })}
          </ul>
        )}
      </Panel>

      {note && <p className="font-mono text-[10px] text-faint">{note}</p>}
      <p className="font-mono text-[10px] leading-relaxed text-faint">
        Corrections become golden items in the eval set — the same mistake is measured from then
        on. Detail on this lane stays on the machine.
      </p>
    </section>
  );
}

function ExitButton({ label, onClick }: { label: string; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="border border-rule px-2.5 py-1 font-mono text-[10px] uppercase tracking-[0.12em] text-muted-foreground hover:border-copper hover:text-copper"
    >
      {label}
    </button>
  );
}

function Select({
  label,
  value,
  options,
  onChange,
}: {
  label: string;
  value: string;
  options: string[];
  onChange: (value: string) => void;
}) {
  return (
    <label className="block">
      <span className="block font-mono text-[10px] uppercase tracking-[0.14em] text-faint">
        {label}
      </span>
      <select
        value={value}
        onChange={(event) => onChange(event.target.value)}
        className="mt-1 w-full border border-rule bg-panel2 px-2 py-1.5 font-mono text-[11px] text-paper outline-none focus:border-copper"
      >
        {(options.includes(value) ? options : [value, ...options]).map((option) => (
          <option key={option} value={option}>
            {option}
          </option>
        ))}
      </select>
    </label>
  );
}

function CorrectRow({
  item,
  onDone,
  onNote,
}: {
  item: DigestItem;
  onDone: () => void;
  onNote: (note: string | null) => void;
}) {
  const local = useLocal();
  const [cls, setCls] = useState(item.cls ?? CLASSES[0]);
  const [entity, setEntity] = useState(item.ent ?? ENTITIES[0]);
  const [sensitivity, setSensitivity] = useState(item.sen ?? SENSITIVITIES[0]);
  const [injection, setInjection] = useState(INJECTIONS[0]);
  const [busy, setBusy] = useState(false);

  async function submit() {
    setBusy(true);
    onNote("recording on the machine…");
    try {
      await local.post("/api/eval/correct", {
        text: item.one ?? "",
        cls,
        entity,
        sensitivity,
        injection,
      });
      onDone();
    } catch (error) {
      onNote(
        isRefusal(error)
          ? error.message || "denied at the approval dialog"
          : "the machine did not record that correction",
      );
      setBusy(false);
    }
  }

  return (
    <div className="mt-3 border border-rule bg-panel2 p-3">
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Select label="Class" value={cls} options={CLASSES} onChange={setCls} />
        <Select label="Entity" value={entity} options={ENTITIES} onChange={setEntity} />
        <Select
          label="Sensitivity"
          value={sensitivity}
          options={SENSITIVITIES}
          onChange={setSensitivity}
        />
        <Select label="Injection" value={injection} options={INJECTIONS} onChange={setInjection} />
      </div>
      <button
        type="button"
        disabled={busy}
        onClick={() => void submit()}
        className="mt-3 border border-copper px-3 py-1.5 font-mono text-[10px] uppercase tracking-[0.12em] text-copper disabled:opacity-50"
      >
        {busy ? "Adding…" : "Add to eval set"}
      </button>
    </div>
  );
}
