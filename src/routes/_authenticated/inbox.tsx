import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useCallback, useEffect, useState } from "react";
import { Disclosure } from "@/components/Disclosure";
import { Panel } from "@/components/AppShell";
import { Section } from "@/components/Section";
import { Page } from "@/components/Page";

import { Empty, Skeleton } from "@/components/data";
import { InstallPrompt } from "@/components/InstallPrompt";
import { isRefusal, useLocal } from "@/lib/local-bridge";

export const Route = createFileRoute("/_authenticated/inbox")({
  head: () => ({
    meta: [
      { title: "Inbox — AgentHub" },
      {
        name: "description",
        content:
          "Triage what arrived overnight: each line taken to one of three exits — dropped, filed as context, or written up as a skill or canvas.",
      },
      { property: "og:title", content: "Inbox — AgentHub" },
      {
        property: "og:description",
        content:
          "Triage what arrived overnight: each line taken to one of three exits — dropped, filed as context, or written up as a skill or canvas.",
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

type DigestItem = { flag?: string; src?: string; cls?: string; ent?: string; sen?: string; one?: string };
type DigestData = { date?: string; items?: DigestItem[]; dates?: string[] };

const CLASSES = ["note", "task", "decision", "reference", "finance", "client", "product"];
const ENTITIES = ["personal", "Agenticality", "NXI", "Envelope Collective", "client"];
const SENSITIVITIES = ["S0", "S1p", "S1c", "S2", "S3"];
const INJECTIONS = ["none", "suspected", "confirmed"];

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
        <div className="font-mono text-[10px] uppercase tracking-[0.16em] text-copper">
          Overnight · {data?.date ?? "—"}
        </div>
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
          <Disclosure
            defaultOpen
            summary={
              <span className="font-mono text-[11px] uppercase tracking-[0.12em] text-faint">
                {items.length} read · {items.filter((item) => item.flag).length} flagged ·{" "}
                {open} undecided
              </span>
            }
          >
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
                      → {exit}
                    </p>
                  ) : (
                    <div className="mt-2 flex flex-wrap gap-2">
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
          </Disclosure>

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
