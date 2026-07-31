import { createFileRoute } from "@tanstack/react-router";
import { useCallback, useEffect, useState } from "react";
import { Panel } from "@/components/AppShell";
import { Empty, Skeleton } from "@/components/data";
import { LocalOnly } from "@/components/LocalOnly";
import { isRefusal, useLocal } from "@/lib/local-bridge";

export const Route = createFileRoute("/_authenticated/digest")({
  head: () => ({
    meta: [
      { title: "Digest — AgentHub" },
      {
        name: "description",
        content: "Triaged items with inline corrections that become golden eval items.",
      },
      { property: "og:title", content: "Digest — AgentHub" },
      {
        property: "og:description",
        content: "Triaged items with inline corrections that become golden eval items.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: () => (
    <LocalOnly>
      <DigestPage />
    </LocalOnly>
  ),
});

type DigestItem = {
  flag?: string | boolean;
  src?: string;
  cls?: string;
  ent?: string;
  sen?: string;
  one?: string;
};
type DigestData = { date?: string; items?: DigestItem[]; dates?: string[] };

const CLASSES = ["note", "task", "decision", "reference", "finance", "client", "product"];
const ENTITIES = ["personal", "Agenticality", "NXI", "Envelope Collective", "client"];
const SENSITIVITIES = ["S0", "S1p", "S1c", "S2", "S3"];
const INJECTIONS = ["none", "suspected", "confirmed"];

function DigestPage() {
  const local = useLocal();
  const [date, setDate] = useState<string | undefined>(undefined);
  const [data, setData] = useState<DigestData | null>(null);
  const [loading, setLoading] = useState(true);
  const [realCount, setRealCount] = useState<number | null>(null);
  const [openIndex, setOpenIndex] = useState<number | null>(null);
  const [added, setAdded] = useState<Record<number, string>>({});
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

  const loadCount = useCallback(async () => {
    try {
      const evals = await local.get<{ real_items?: number }>("/api/evals");
      setRealCount(evals.real_items ?? null);
    } catch {
      setRealCount(null);
    }
  }, [local]);

  useEffect(() => {
    void load(date);
  }, [date, load]);

  useEffect(() => {
    void loadCount();
  }, [loadCount]);

  const items = data?.items ?? [];

  return (
    <div className="space-y-4">
      <PageIntro title="Triage">
        Everything the machine read overnight — mail, files, notes — sorted into one line each,
        with its class, entity and sensitivity. Read it to see what needs you. Where the machine
        classified something wrongly, correct it: that correction becomes a golden eval item, so
        the same mistake is measured from then on. Detail stays on the machine.
      </PageIntro>
      <div className="border border-copper bg-panel px-3 py-2">

        <p className="text-[13px] leading-relaxed text-copper">
          Corrections here become golden items in the eval set. This is how the system learns.
        </p>
        <p className="mt-1 font-mono text-[10px] text-faint">
          {realCount == null ? "—" : realCount} real corrections recorded
        </p>
      </div>

      <div className="flex flex-wrap gap-2">
        {(data?.dates ?? []).map((option) => (
          <button
            key={option}
            type="button"
            onClick={() => setDate(option)}
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

      <Panel title={`Items · ${data?.date ?? "—"}`}>
        {loading ? (
          <div className="space-y-3">
            {Array.from({ length: 5 }).map((_, index) => (
              <Skeleton key={index} className="h-10 w-full" />
            ))}
          </div>
        ) : items.length === 0 ? (
          <Empty>Nothing triaged for this date.</Empty>
        ) : (
          <ul className="space-y-4">
            {items.map((item, index) => {
              const flagged = Boolean(item.flag) && item.flag !== "false";
              return (
                <li key={index} className="border-b border-rule pb-4 last:border-b-0 last:pb-0">
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
                  <div className="mt-2">
                    {added[index] ? (
                      <span className="font-mono text-[10px] uppercase tracking-[0.12em] text-copper">
                        added as {added[index]}
                      </span>
                    ) : (
                      <button
                        type="button"
                        onClick={() => setOpenIndex(openIndex === index ? null : index)}
                        className="font-mono text-[10px] uppercase tracking-[0.12em] text-muted-foreground hover:text-copper"
                      >
                        Correct
                      </button>
                    )}
                  </div>
                  {openIndex === index && !added[index] && (
                    <CorrectRow
                      item={item}
                      onDone={(id) => {
                        setAdded((current) => ({ ...current, [index]: id }));
                        setOpenIndex(null);
                        void loadCount();
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
    </div>
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
  onDone: (id: string) => void;
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
      const result = await local.post<{ id?: string; ref?: string }>("/api/eval/correct", {
        text: item.one ?? "",
        cls,
        entity,
        sensitivity,
        injection,
      });
      onNote(null);
      onDone(result.id ?? result.ref ?? "a golden item");
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
