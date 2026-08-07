import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useCallback, useEffect, useMemo, useState } from "react";
import { Panel } from "@/components/AppShell";
import { Section } from "@/components/Section";
import { Page } from "@/components/Page";

import { Empty, Skeleton } from "@/components/data";
import { InstallPrompt } from "@/components/InstallPrompt";
import { isRefusal, useLocal } from "@/lib/local-bridge";
import { emptyBlock, emptyDoc } from "@/lib/canvas-types";
import { writeCanvas } from "@/lib/canvas-store";

export const Route = createFileRoute("/_authenticated/inbox")({
  head: () => ({
    meta: [
      { title: "Inbox — AgentHub" },
      {
        name: "description",
        content:
          "Triage what arrived overnight: each line taken to one exit — dismissed, filed as context, drafted or opened in Canvas.",
      },
      { property: "og:title", content: "Inbox — AgentHub" },
      {
        property: "og:description",
        content:
          "Triage what arrived overnight: each line taken to one exit — dismissed, filed as context, drafted or opened in Canvas.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: () => (
    <Page title="Inbox" footer="Inbox · the overnight read, triaged on the machine">
      <InboxPage />
    </Page>
  ),
});

type Decision = { action?: string; note?: string; at?: string } | string | null | undefined;

type DigestItem = {
  flag?: string;
  src?: string;
  cls?: string;
  ent?: string;
  sen?: string;
  one?: string;
  why?: string;
  reason?: string;
  decision?: Decision;
};
type DigestData = { date?: string; items?: DigestItem[]; dates?: string[] };

const CLASSES = ["note", "task", "decision", "reference", "finance", "client", "product"];
const ENTITIES = ["personal", "Agenticality", "NXI", "Envelope Collective", "client"];
const SENSITIVITIES = ["S0", "S1p", "S1c", "S2", "S3"];
const INJECTIONS = ["none", "suspected", "confirmed"];

/** The four lanes the actions derive from. Anything else is signal. */
type Lane = InboxLane;


function laneOf(item: DigestItem): Lane {
  if (item.flag) return "flagged";
  const cls = (item.cls ?? "").toLowerCase();
  if (cls === "task") return "task";
  if (cls === "noise" || cls === "newsletter" || cls === "promo") return "noise";
  return "signal";
}

const DONE_LABEL: Record<string, string> = {
  context: "filed as context",
  dismiss: "dismissed",
  canvas: "opened in Canvas",
  draft: "reply drafted",
  reclassified: "reclassified",
  evidence: "evidence read",
};

function decisionAction(decision: Decision): string | null {
  if (!decision) return null;
  if (typeof decision === "string") return decision || null;
  return decision.action || null;
}

function decisionAt(decision: Decision): string | null {
  if (!decision || typeof decision === "string") return null;
  return decision.at ?? null;
}

function shortTime(at: string | null) {
  if (!at) return null;
  const parsed = new Date(at);
  if (Number.isNaN(parsed.getTime())) return at;
  return parsed.toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" });
}

/** Capture lives in the omnibox on Overview. One input for one action. */
function InboxPage() {
  return (
    <div className="space-y-4">
      <InstallPrompt />
      <Section title="Digest">
        <TriageLane />
      </Section>
    </div>
  );
}

function TriageLane() {
  const local = useLocal();
  const navigate = useNavigate();
  const [date, setDate] = useState<string | undefined>(undefined);
  const [data, setData] = useState<DigestData | null>(null);
  const [loading, setLoading] = useState(true);
  const [local_decisions, setLocalDecisions] = useState<Record<number, { action: string; at: string } | null>>({});
  const [openCorrect, setOpenCorrect] = useState<number | null>(null);
  const [openEvidence, setOpenEvidence] = useState<number | null>(null);
  const [showDecided, setShowDecided] = useState(false);
  const [showEverything, setShowEverything] = useState(false);
  const [history, setHistory] = useState<Record<string, string[]>>({});
  const [note, setNote] = useState<string | null>(null);

  const load = useCallback(
    async (target?: string) => {
      setLoading(true);
      try {
        setData(await local.get<DigestData>("/api/digest", { date: target }));
        setLocalDecisions({});
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

  const items = useMemo(() => data?.items ?? [], [data]);
  const day = data?.date;
  const dates = useMemo(() => data?.dates ?? [], [data]);

  /** Recurrence needs the neighbouring days — subjects only, read on the machine. */
  useEffect(() => {
    if (!local.available || !day) return;
    const window = [day, ...dates.filter((d) => d !== day)].slice(0, 7);
    let cancelled = false;
    void (async () => {
      const collected: Record<string, string[]> = {};
      await Promise.all(
        window.map(async (target) => {
          try {
            const payload =
              target === day
                ? data
                : await local.get<DigestData>("/api/digest", { date: target });
            collected[target] = (payload?.items ?? []).map((item) => item.one ?? "");
          } catch {
            /* a missing day simply does not count towards recurrence */
          }
        }),
      );
      if (!cancelled) setHistory(collected);
    })();
    return () => {
      cancelled = true;
    };
  }, [data, dates, day, local]);

  const rows = useMemo(
    () =>
      items.map((item, index) => {
        const override = local_decisions[index];
        const action =
          override === null ? null : (override?.action ?? decisionAction(item.decision));
        return {
          item,
          index,
          lane: laneOf(item),
          action,
          at: override?.at ?? decisionAt(item.decision),
        };
      }),
    [items, local_decisions],
  );

  const groups = useMemo(() => sortGroups(groupRows(rows)), [rows]);
  const recurrence = useMemo(() => recurrenceMap(history), [history]);
  const historyWindow = Math.max(Object.keys(history).length, 1);

  const needing = useMemo(
    () => groups.filter((g) => (g.lane === "flagged" || g.lane === "task") && g.undecided.length > 0),
    [groups],
  );
  const informational = useMemo(
    () => groups.filter((g) => g.lane === "signal" || g.lane === "noise"),
    [groups],
  );
  const decidedRows = useMemo(() => rows.filter((row) => row.action), [rows]);
  const needingCount = needing.reduce((total, g) => total + g.undecided.length, 0);
  const flaggedCount = needing
    .filter((g) => g.lane === "flagged")
    .reduce((total, g) => total + g.undecided.length, 0);
  const informationalCount = informational.reduce((total, g) => total + g.count, 0);

  const record = useCallback(
    async (index: number, action: string, actionNote = "") => {
      setNote("recording on the machine…");
      try {
        await local.post("/api/digest/decide", {
          date: day ?? "",
          item: String(index),
          action,
          note: actionNote,
        });
        setLocalDecisions((current) => ({
          ...current,
          [index]: action === "undo" ? null : { action, at: new Date().toISOString() },
        }));
        setNote(null);
        return true;
      } catch (error) {
        setNote(
          isRefusal(error)
            ? error.message || "denied at the approval dialog"
            : "the machine did not record that decision",
        );
        return false;
      }
    },
    [day, local],
  );

  /** One decision covers every arrival of the same subject. */
  const recordGroup = useCallback(
    async (indices: number[], action: string) => {
      for (const index of indices) {
        const ok = await record(index, action);
        if (!ok) return false;
      }
      return true;
    },
    [record],
  );

  if (!local.available) {
    return (
      <Panel title="Overnight · stream">
        <Empty>Available on the machine. This section reads material that never leaves it.</Empty>
      </Panel>
    );
  }

  async function toContext(index: number, item: DigestItem) {
    setNote("filing on the machine…");
    try {
      await local.post("/api/capture", { text: item.one ?? "" });
    } catch (error) {
      setNote(isRefusal(error) ? "denied at the approval dialog" : "the machine did not file that");
      return;
    }
    await record(index, "context");
  }

  async function toDraft(index: number, item: DigestItem) {
    setNote("drafting on the machine…");
    try {
      await local.post("/api/draft", {
        title: (item.one ?? "").slice(0, 80),
        body: item.one ?? "",
      });
    } catch (error) {
      setNote(
        isRefusal(error) ? "denied at the approval dialog" : "the machine did not draft that reply",
      );
      return;
    }
    await record(index, "draft");
  }

  /** Saved on the machine first, then opened — a canvas that is never saved is a dead control. */
  async function toCanvas(index: number, item: DigestItem) {
    const text = item.one ?? "";
    setNote("opening a canvas on the machine…");
    const fresh = emptyDoc(text.slice(0, 60) || "Untitled canvas");
    fresh.blocks = [{ ...emptyBlock("note"), text }, ...fresh.blocks];
    try {
      await writeCanvas(local, fresh);
    } catch (error) {
      setNote(
        isRefusal(error) ? "denied at the approval dialog" : "the machine did not save that canvas",
      );
      return;
    }
    await record(index, "canvas");
    void navigate({ to: "/canvas", search: { id: fresh.id, seed: undefined } });
  }

  const arrived = items.length;

  function renderGroup(group: (typeof groups)[number], expanded: boolean) {
    const { head, count, lane } = group;
    const item = head.item;
    const index = head.index;
    const indices = group.undecided.map((row) => row.index);
    const recurs = recurrenceNote(
      recurrence.get(`${subjectKey(item.one)}`),
      historyWindow,
    );
    return (
      <li key={group.key} className="border-t border-rule py-3 first:border-t-0">
        <div className="flex flex-wrap items-baseline gap-2">
          <span
            className={`border px-1.5 py-0.5 font-mono text-[10px] uppercase tracking-[0.12em] ${
              lane === "flagged"
                ? "border-watch text-watch"
                : lane === "task"
                  ? "border-copper/60 text-copper"
                  : "border-rule text-muted-foreground"
            }`}
          >
            {lane === "flagged" ? "FLAG" : lane}
          </span>
          <span className="min-w-0 flex-1 text-[14px] leading-relaxed text-paper">
            {item.one}
            {count > 1 && (
              <span className="ml-2 font-mono text-[11px] tabular-nums text-faint">×{count}</span>
            )}
          </span>
        </div>
        <p className="mt-1 break-all font-mono text-[10px] text-faint">
          {[item.src, item.ent, item.sen].filter(Boolean).join(" · ")}
        </p>
        {recurs && (
          <p className="mt-0.5 font-mono text-[10px] text-faint">
            {recurs} — better filtered at source than dismissed daily
          </p>
        )}

        <div className="mt-2 flex flex-wrap gap-2">
          {lane === "noise" && indices.length > 0 && (
            <ExitButton
              label={count > 1 ? `Dismiss all ${count}` : "Dismiss"}
              onClick={() => void recordGroup(indices, "dismiss")}
            />
          )}
          {(lane === "signal" || lane === "task") && indices.length > 0 && (
            <ExitButton label="File as context" onClick={() => void toContext(index, item)} />
          )}
          {lane === "task" && indices.length > 0 && (
            <>
              <ExitButton label="Draft reply" onClick={() => void toDraft(index, item)} />
              <ExitButton label="Open in Canvas" onClick={() => void toCanvas(index, item)} />
            </>
          )}
          {lane === "flagged" && (
            <ExitButton
              label={openEvidence === index ? "Hide evidence" : "Read the evidence"}
              onClick={() => setOpenEvidence(openEvidence === index ? null : index)}
            />
          )}
          <button
            type="button"
            onClick={() => setOpenCorrect(openCorrect === index ? null : index)}
            className="font-mono text-[10px] uppercase tracking-[0.12em] text-faint hover:text-copper"
          >
            Wrong class?
          </button>
        </div>

        {lane === "flagged" && openEvidence === index && expanded && (
          <div className="mt-2 border border-watch/40 bg-panel2 p-2">
            <p className="font-mono text-[10px] uppercase tracking-[0.12em] text-watch">
              flagged {typeof item.flag === "string" ? `· ${item.flag}` : ""}
            </p>
            <p className="mt-1 max-w-[72ch] text-[12px] leading-relaxed text-paper">
              {item.why ?? item.reason ?? item.one}
            </p>
            <button
              type="button"
              onClick={() => void record(index, "evidence")}
              className="mt-2 border border-rule px-2 py-0.5 font-mono text-[10px] uppercase tracking-[0.12em] text-muted-foreground hover:border-copper hover:text-copper"
            >
              Mark read
            </button>
          </div>
        )}

        {openCorrect === index && (
          <CorrectRow
            item={item}
            onDone={async () => {
              setOpenCorrect(null);
              await record(index, "reclassified");
              setNote("correction recorded as a golden eval item");
            }}
            onNote={setNote}
          />
        )}
      </li>
    );
  }

  return (
    <section className="space-y-3">
      <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-2 border border-rule bg-panel px-4 py-2.5">
        <div className="font-mono text-[10px] uppercase tracking-[0.16em] text-copper">
          Overnight · {day ?? "—"}
        </div>
        <span className="font-mono text-[10px] tabular-nums text-faint">
          {needingCount} need you · {decidedRows.length} decided
        </span>
      </div>

      {dates.length > 1 && (
        <div className="flex flex-wrap gap-2">
          {dates.map((option) => (
            <button
              key={option}
              type="button"
              onClick={() => setDate(option)}
              className={`border px-2 py-1 font-mono text-[10px] ${
                (date ?? day) === option
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
        ) : arrived === 0 ? (
          <Empty>Nothing was read overnight.</Empty>
        ) : (
          <div className="space-y-3">
            <p className="max-w-[72ch] text-[14px] leading-relaxed text-paper">
              {dayHeadline(needingCount, flaggedCount)}
            </p>
            <p className="font-mono text-[10px] tabular-nums text-faint">
              {daySubline(arrived, informationalCount, decidedRows.length)}
            </p>

            {needing.length > 0 && <ul>{needing.map((group) => renderGroup(group, true))}</ul>}

            {informational.length > 0 && (
              <div>
                <button
                  type="button"
                  onClick={() => setShowEverything((current) => !current)}
                  className="font-mono text-[10px] uppercase tracking-[0.12em] text-faint hover:text-copper"
                >
                  {showEverything ? "Hide everything" : `Show everything (${informationalCount})`}
                </button>
                {showEverything && (
                  <ul className="mt-2 border-t border-rule pt-2">
                    {informational.map((group) => renderGroup(group, true))}
                  </ul>
                )}
              </div>
            )}

            {decidedRows.length > 0 && (
              <div>
                <button
                  type="button"
                  onClick={() => setShowDecided((current) => !current)}
                  className="font-mono text-[10px] uppercase tracking-[0.12em] text-faint hover:text-copper"
                >
                  {showDecided ? "Hide decided" : `Show decided (${decidedRows.length})`}
                </button>
                {showDecided && (
                  <ul className="mt-2 border-t border-rule pt-2">
                    {decidedRows.map(({ item, index, action, at }) => (
                      <li
                        key={index}
                        className="flex flex-wrap items-baseline gap-x-3 gap-y-1 border-t border-rule py-2 first:border-t-0"
                      >
                        <span className="min-w-0 flex-1 truncate text-[13px] text-muted-foreground">
                          {item.one}
                        </span>
                        <span className="font-mono text-[10px] uppercase tracking-[0.12em] text-copper">
                          → {DONE_LABEL[action ?? ""] ?? action}
                        </span>
                        {shortTime(at) && (
                          <span className="font-mono text-[10px] tabular-nums text-faint">
                            {shortTime(at)}
                          </span>
                        )}
                        <button
                          type="button"
                          onClick={() => void record(index, "undo")}
                          className="font-mono text-[10px] uppercase tracking-[0.12em] text-faint hover:text-copper"
                        >
                          Undo
                        </button>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            )}
          </div>
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
  onDone: () => void | Promise<void>;
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
      await onDone();
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
