import { createFileRoute } from "@tanstack/react-router";
import { Page } from "@/components/Page";
import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Panel } from "@/components/AppShell";
import { Empty, Skeleton } from "@/components/data";
import { SectionHeading } from "@/components/Section";
import { LocalOnly } from "@/components/LocalOnly";
import { isRefusal, useLocal } from "@/lib/local-bridge";
import { fixed } from "@/lib/format";
import { useJobDrawer } from "@/lib/job-drawer";
import {
  EMBEDDER_CHECK_INTERVAL_MS,
  modelId,
  normalizeIds,
  useEmbedderGuard,
} from "@/lib/embedder";
import type { Bench } from "@/lib/lane-capacity";

export const Route = createFileRoute("/_authenticated/models")({
  head: () => ({
    meta: [
      { title: "Models — AgentHub" },
      {
        name: "description",
        content:
          "Tiered residency, memory budget and failover ladder for the models on the machine.",
      },
      { property: "og:title", content: "Models — AgentHub" },
      {
        property: "og:description",
        content:
          "Tiered residency, memory budget and failover ladder for the models on the machine.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: () => (
    <Page title="Models" subtitle="Tiered residency and the memory budget." footer="Models · residency read live from the machine">
      <LocalOnly>
        <ModelsPage />
      </LocalOnly>
    </Page>
  ),
});

type MemoryEntry = { id?: string; gib?: unknown };
type MemoryBlock = {
  pressure?: "green" | "amber" | "red" | "unknown";
  budget?: {
    envelope_gib?: unknown;
    pinned_gib?: unknown;
    elastic_gib?: unknown;
    headroom_gib?: unknown;
    wired_limit_mb?: unknown;
    source?: unknown;
    compressed_gib?: unknown;
    free_gib?: unknown;
    wired_gib?: unknown;
    active_gib?: unknown;
  };
  pinned?: MemoryEntry[];
  elastic?: MemoryEntry[];
  unexpected?: MemoryEntry[];
  core_intact?: boolean;
  advice?: string;
};

type ModelsData = {
  resident?: unknown[];
  available?: unknown[];
  bench?: Bench[];
  aliases?: unknown[];
  memory?: MemoryBlock;
};

type FailoverRung = {
  rung?: unknown;
  name?: string;
  tested?: string | null;
  ok?: boolean | null;
  detail?: string;
};

const RUN_KEYS = [
  "verify",
  "doctor",
  "intake",
  "ingest",
  "eval",
  "backup",
  "report",
  "repair",
  "summarise",
  "diagnose",
] as const;

const RUNG_DEFAULT_KEY: Record<number, string> = {
  1: "verify",
  2: "repair",
  3: "doctor",
  4: "diagnose",
  5: "report",
};

function runKeyFor(rung: number, name: string) {
  const text = (name ?? "").toLowerCase();
  const direct = RUN_KEYS.find((key) => text.includes(key));
  return direct ?? RUNG_DEFAULT_KEY[rung] ?? "diagnose";
}

/** The five rungs exist on the machine whether or not the API names them. */
const LADDER: { rung: number; name: string }[] = [
  { rung: 1, name: "model unavailable" },
  { rung: 2, name: "serving layer down" },
  { rung: 3, name: "router down" },
  { rung: 4, name: "memory pressure critical" },
  { rung: 5, name: "all local down" },
];

type LadderRow = {
  rung: number;
  name: string;
  tested: string | null;
  ok: boolean | null;
  detail?: string;
};

/**
 * Accepts a list, a `{rungs: []}` envelope, or an object keyed by rung number,
 * and always returns five rows. A rung never tested says so rather than vanishing.
 */
function normaliseLadder(raw: unknown): LadderRow[] {
  let rows: FailoverRung[] = [];
  if (Array.isArray(raw)) rows = raw as FailoverRung[];
  else if (raw && typeof raw === "object") {
    const envelope = raw as { rungs?: unknown };
    if (Array.isArray(envelope.rungs)) rows = envelope.rungs as FailoverRung[];
    else {
      rows = Object.entries(raw as Record<string, FailoverRung>).map(([key, value]) => ({
        rung: value?.rung ?? Number(String(key).replace(/[^0-9]/g, "")),
        ...value,
      }));
    }
  }

  return LADDER.map((base) => {
    const match = rows.find((row) => n(row.rung, -1) === base.rung);
    return {
      rung: base.rung,
      name: match?.name?.trim() || base.name,
      tested: match?.tested ?? null,
      ok: match?.ok ?? null,
      detail: match?.detail,
    };
  });
}

const PRESSURE_DOT: Record<string, string> = {
  green: "bg-ok",
  amber: "bg-watch",
  red: "bg-risk",
  unknown: "bg-faint",
};

function n(value: unknown, fallback = 0): number {
  const parsed = typeof value === "number" ? value : Number(String(value ?? "").trim());
  return Number.isFinite(parsed) ? parsed : fallback;
}

function ModelsPage() {
  const local = useLocal();
  const { runJob } = useJobDrawer();
  const [busy, setBusy] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);

  const models = useQuery({
    queryKey: ["models"],
    enabled: local.available,
    staleTime: 15_000,
    refetchInterval: 30_000,
    queryFn: () => local.get<ModelsData>("/api/models"),
  });

  // Not every machine build exposes the ladder. A missing endpoint is an
  // absence, not a fault: ask once, keep quiet, and render the empty state.
  const failover = useQuery({
    queryKey: ["failover"],
    enabled: local.available,
    staleTime: 5 * 60_000,
    retry: false,
    queryFn: () => local.get<unknown>("/api/failover").catch(() => null),
  });


  const loading = models.isLoading;
  const failed = !loading && models.error !== null;

  const data = models.data ?? {};
  const bench = data.bench ?? [];
  const resident = normalizeIds(data.resident);
  // Some machine builds nest the block under `memory`, some flatten it onto the
  // response, and some put the figures directly on `memory` without a `budget`.
  const memory: MemoryBlock =
    data.memory ?? ((data as { budget?: unknown }).budget ? (data as MemoryBlock) : {});
  const budget = memory.budget ?? (memory as MemoryBlock["budget"]) ?? {};

  const envelope = n(budget.envelope_gib);
  const pinnedGib = n(budget.pinned_gib);
  const elasticGib = n(budget.elastic_gib);
  const headroomGib = n(budget.headroom_gib, Math.max(0, envelope - pinnedGib - elasticGib));
  const pinned = (memory.pinned ?? (budget as { pinned?: MemoryEntry[] }).pinned ?? []).filter(
    (entry) => modelId(entry) !== "",
  );
  const elastic = memory.elastic ?? [];
  const unexpected = (memory.unexpected ?? []).filter((entry) => modelId(entry) !== "");
  const pressure = memory.pressure ?? "unknown";


  const pct = (value: number) => (envelope > 0 ? Math.max(0, Math.min(100, (value / envelope) * 100)) : 0);
  const elasticLabel = elastic.map((entry) => modelId(entry)).filter(Boolean).join(" · ");

  const pinnedIds = useMemo(
    () => new Set(pinned.map((entry) => modelId(entry).toLowerCase()).filter(Boolean)),
    [pinned],
  );

  const elasticRows = useMemo(() => {
    const isPinned = (id: string) => {
      const value = id.toLowerCase();
      for (const other of pinnedIds) {
        if (other === value || other.includes(value) || value.includes(other)) return true;
      }
      return false;
    };
    return bench
      .filter((row) => row.id && !isPinned(row.id) && !/embed/i.test(row.id) && !/embed/i.test(row.role ?? ""))
      .slice(0, 3)
      .map((row) => {
        const value = (row.id ?? "").toLowerCase();
        const loaded =
          elastic.some((entry) => {
            const other = modelId(entry).toLowerCase();
            return other && (other === value || other.includes(value) || value.includes(other));
          }) ||
          resident.some((entry) => {
            const other = entry.toLowerCase();
            return other === value || other.includes(value) || value.includes(other);
          });
        return { ...row, loaded };
      });
  }, [bench, elastic, pinnedIds, resident]);

  async function act(action: string, model: string | undefined, label: string) {
    setBusy(label);
    setNote("awaiting the machine…");
    try {
      await local.post("/api/models/action", { action, model });
      setNote(`${label} — done`);
      await models.refetch();
    } catch (error) {
      setNote(
        isRefusal(error)
          ? error.message || "denied at the approval dialog"
          : "the machine did not carry that out",
      );
    } finally {
      setBusy(null);
    }
  }

  /** Duplicates are cleared by unloading each unexpected instance in turn. */
  async function clearDuplicates() {
    const label = "clear duplicates";
    setBusy(label);
    setNote("awaiting the machine…");
    try {
      for (const entry of unexpected) {
        await local.post("/api/models/action", { action: "unload", model: modelId(entry) });
      }
      setNote(`${label} — done`);
      await models.refetch();
    } catch (error) {
      setNote(
        isRefusal(error)
          ? error.message || "denied at the approval dialog"
          : "the machine did not carry that out",
      );
    } finally {
      setBusy(null);
    }
  }


  const disabled = busy !== null;

  return (
    <div className="space-y-4">
      {failed && (
        <div className="border border-copper bg-panel px-3 py-3">
          <p className="text-[13px] leading-relaxed text-copper">
            The machine is reachable but did not answer{" "}
            <span className="font-mono">/api/models</span>. Nothing below is current.
          </p>
          <button
            type="button"
            onClick={() => void models.refetch()}
            className="mt-2 border border-copper px-3 py-1 font-mono text-[10px] uppercase tracking-[0.12em] text-copper"
          >
            Try again
          </button>
        </div>
      )}

      {/* THE BUDGET BAR */}
      <section className="border border-rule bg-panel px-3 py-3">
        <SectionHeading>Memory budget</SectionHeading>

        <p className="mt-2 flex flex-wrap items-baseline gap-x-2 font-mono text-[11px] text-muted-foreground">
          <span
            aria-hidden
            className={`inline-block h-2 w-2 rounded-full ${PRESSURE_DOT[pressure] ?? "bg-faint"}`}
          />
          <span className="uppercase tracking-[0.14em] text-paper">{pressure}</span>
          <span className="tabular-nums">
            envelope {fixed(envelope, 1)} GiB · compressed {fixed(budget.compressed_gib, 1)} GiB ·
            free {fixed(budget.free_gib, 1)} GiB · wired limit{" "}
            {budget.wired_limit_mb != null && budget.wired_limit_mb !== ""
              ? `${fixed(budget.wired_limit_mb, 0)} MB`
              : String(budget.source ?? "system default")}
          </span>

        </p>

        {loading ? (
          <Skeleton className="mt-3 h-7 w-full" />
        ) : (
          <>
            <div className="mt-3 flex h-7 w-full">
              <div
                className="h-full bg-ok"
                style={{ width: `${pct(pinnedGib)}%` }}
                title="pinned · always resident"
              />
              <div
                className="h-full bg-copper"
                style={{ width: `${pct(elasticGib)}%` }}
                title="elastic"
              />
              <div
                className="h-full border border-rule"
                style={{ width: `${pct(headroomGib)}%` }}
                title="headroom"
              />
            </div>
            <div className="mt-1 flex w-full font-mono text-[11px] text-faint">
              <div className="overflow-hidden pr-2" style={{ width: `${pct(pinnedGib)}%` }}>
                <span className="whitespace-nowrap text-ok">
                  pinned · {fixed(pinnedGib, 1)} GiB · always resident
                </span>
              </div>
              <div className="overflow-hidden pr-2" style={{ width: `${pct(elasticGib)}%` }}>
                {elasticGib > 0 && (
                  <span className="whitespace-nowrap break-all text-copper">{elasticLabel}</span>
                )}
              </div>
              <div className="min-w-0 flex-1 overflow-hidden">
                <span className="whitespace-nowrap">
                  {elasticGib > 0
                    ? `${fixed(headroomGib, 1)} GiB free`
                    : "no large model loaded — loads on demand"}
                </span>
              </div>
            </div>
          </>
        )}

        <p className="mt-3 text-[11px] leading-relaxed text-faint">
          macOS compresses idle pages, so a machine can report memory free while every inference pays
          a decompression tax.
        </p>
        {memory.advice && (
          <p className="mt-1 text-[11px] leading-relaxed text-muted-foreground">{memory.advice}</p>
        )}
      </section>

      {/* DUPLICATE INSTANCES */}
      {unexpected.length > 0 && (
        <section className="border border-watch bg-panel px-3 py-3">
          <p className="text-[13px] leading-relaxed text-watch">
            {unexpected.length} duplicate model instances are resident. LM Studio spawned these rather
            than reusing one; they hold weights and inflate compressed memory.
          </p>
          <ul className="mt-2 space-y-1">
            {unexpected.map((entry, index) => (
              <li
                key={`${modelId(entry)}-${index}`}
                className="break-all font-mono text-[11px] text-muted-foreground"
              >
                {modelId(entry)}
                {entry.gib != null && (
                  <span className="ml-2 tabular-nums text-faint">{fixed(entry.gib, 1)} GiB</span>
                )}
              </li>
            ))}
          </ul>
          <button
            type="button"
            disabled={busy === "clear duplicates"}
            onClick={() => void clearDuplicates()}
            className="mt-2 border border-watch px-3 py-1 font-mono text-[10px] uppercase tracking-[0.12em] text-watch disabled:opacity-50"
          >
            {busy === "clear duplicates" ? "Clearing…" : "Clear duplicates"}
          </button>
        </section>
      )}

      {/* PINNED CORE */}
      <Panel title="Pinned core">
        {loading ? (
          <Skeleton className="h-12 w-full" />
        ) : pinned.length === 0 ? (
          <Empty>The machine names no pinned models.</Empty>
        ) : (
          <table className="w-full text-left">
            <thead>
              <tr className="border-b border-rule font-mono text-[10px] uppercase tracking-[0.14em] text-faint">
                <th className="py-1.5 font-normal">Model</th>
                <th className="py-1.5 text-right font-normal">Size</th>
                <th className="py-1.5 text-right font-normal">State</th>
              </tr>
            </thead>
            <tbody>
              {pinned.map((entry, index) => (
                <tr key={`${modelId(entry)}-${index}`} className="border-b border-rule last:border-b-0">
                  <td className="break-all py-2 pr-2 font-mono text-[11px] text-paper">
                    {modelId(entry)}
                  </td>
                  <td className="py-2 text-right font-mono text-[11px] tabular-nums text-muted-foreground">
                    {fixed(entry.gib, 1)} GiB
                  </td>
                  <td className="py-2 text-right font-mono text-[10px] uppercase tracking-[0.12em] text-ok">
                    pinned
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
        <p className="mt-2 text-[11px] leading-relaxed text-faint">
          The embedder and the triage model serve every scheduled job, so they are pinned and cannot
          be evicted. The knowledge base stops working without the embedder.
        </p>
        <RetrievalProof
          resident={data.resident}
          available={data.available}
          bench={bench}
          ready={!loading && !failed}
          refresh={models.refetch}
        />
      </Panel>

      {/* ELASTIC TIER */}
      <Panel title="Elastic tier">
        {loading ? (
          <Skeleton className="h-12 w-full" />
        ) : elasticRows.length === 0 ? (
          <Empty>The bench names no large models outside the pinned core.</Empty>
        ) : (
          <table className="w-full text-left">
            <thead>
              <tr className="border-b border-rule font-mono text-[10px] uppercase tracking-[0.14em] text-faint">
                <th className="py-1.5 font-normal">Model</th>
                <th className="py-1.5 font-normal">Role</th>
                <th className="py-1.5 text-right font-normal">Gen t/s</th>
                <th className="py-1.5 text-right font-normal">GiB</th>
                <th className="py-1.5 text-right font-normal">State</th>
                <th className="py-1.5 text-right font-normal" />
              </tr>
            </thead>
            <tbody>
              {elasticRows.map((row) => (
                <tr key={row.id} className="border-b border-rule last:border-b-0">
                  <td className="break-all py-2 pr-2 font-mono text-[11px] text-paper">{row.id}</td>
                  <td className="py-2 pr-2 text-[12px] text-muted-foreground">{row.role}</td>
                  <td className="py-2 text-right font-mono text-[11px] tabular-nums text-paper">
                    {fixed(row.tps, 1)}
                  </td>
                  <td className="py-2 text-right font-mono text-[11px] tabular-nums text-muted-foreground">
                    {fixed(row.gib, 1)}
                  </td>
                  <td
                    className={`py-2 text-right font-mono text-[10px] uppercase tracking-[0.12em] ${row.loaded ? "text-ok" : "text-faint"}`}
                  >
                    {row.loaded ? "loaded" : "not loaded"}
                  </td>
                  <td className="py-2 pl-2 text-right">
                    <button
                      type="button"
                      disabled={disabled}
                      title="Loading this evicts the currently loaded large model"
                      onClick={() => void act("load", row.id, `load ${row.id}`)}
                      className="border border-rule px-2 py-1 font-mono text-[10px] uppercase tracking-[0.12em] text-muted-foreground hover:border-copper hover:text-copper disabled:opacity-50"
                    >
                      {busy === `load ${row.id}` ? "Loading…" : "Load"}
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Panel>

      {/* FAILOVER LADDER */}
      <Panel title="Failover ladder">
        {failover.isLoading ? (
          <Skeleton className="h-12 w-full" />
        ) : (
          <table className="w-full text-left">
            <thead>
              <tr className="border-b border-rule font-mono text-[10px] uppercase tracking-[0.14em] text-faint">
                <th className="py-1.5 font-normal">Rung</th>
                <th className="py-1.5 font-normal">Name</th>
                <th className="py-1.5 text-right font-normal">Tested</th>
                <th className="py-1.5 text-right font-normal">Result</th>
                <th className="py-1.5 text-right font-normal" />
              </tr>
            </thead>
            <tbody>
              {normaliseLadder(failover.data).map((row) => {
                const rung = row.rung;
                const key = runKeyFor(rung, row.name ?? "");
                return (
                  <tr key={`${rung}-${row.name}`} className="border-b border-rule align-top last:border-b-0">
                    <td className="py-2 pr-2 font-mono text-[11px] tabular-nums text-faint">{rung}</td>
                    <td className="py-2 pr-2">
                      <span className="text-[13px] text-paper">{row.name ?? "—"}</span>
                      {row.detail && (
                        <span className="block text-[11px] text-faint">{row.detail}</span>
                      )}
                      {(rung === 2 || rung === 3) && (
                        <span className="block text-[11px] text-watch">
                          Disruptive — stops the serving layer or the router.
                        </span>
                      )}
                      {rung === 5 && (
                        <span className="block text-[11px] text-faint">
                          Cloud fallback never applies to material classed S1c, S2 or S3. Those tasks
                          fail closed.
                        </span>
                      )}
                    </td>
                    <td
                      className={`py-2 text-right font-mono text-[11px] ${row.tested ? "text-muted-foreground" : "text-watch"}`}
                    >
                      {row.tested ? String(row.tested).slice(0, 10) : "never"}
                    </td>
                    <td
                      className={`py-2 text-right font-mono text-[10px] uppercase tracking-[0.12em] ${
                        row.ok === true ? "text-ok" : row.ok === false ? "text-risk" : "text-faint"
                      }`}
                    >
                      {row.ok === true ? "pass" : row.ok === false ? "fail" : "—"}
                    </td>
                    <td className="py-2 pl-2 text-right">
                      <button
                        type="button"
                        onClick={() => void runJob(key, `failover ${rung} · ${key}`)}
                        className="border border-rule px-2 py-1 font-mono text-[10px] uppercase tracking-[0.12em] text-muted-foreground hover:border-copper hover:text-copper"
                      >
                        Test
                      </button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </Panel>

      {/* MEASURED PERFORMANCE */}
      <Panel title="Measured performance">
        {loading ? (
          <Skeleton className="h-4 w-full" />
        ) : bench.length === 0 ? (
          <Empty>No benchmark on record.</Empty>
        ) : (
          <table className="w-full text-left">
            <thead>
              <tr className="border-b border-rule font-mono text-[10px] uppercase tracking-[0.14em] text-faint">
                <th className="py-1.5 font-normal">Role</th>
                <th className="py-1.5 font-normal">Model</th>
                <th className="py-1.5 text-right font-normal">Gen t/s</th>
                <th className="py-1.5 text-right font-normal">TTFT</th>
                <th className="py-1.5 text-right font-normal">GiB</th>
              </tr>
            </thead>
            <tbody>
              {bench.map((row) => (
                <tr key={`${row.role}-${row.id}`} className="border-b border-rule last:border-b-0">
                  <td className="py-2 pr-2 text-[13px] text-paper">{row.role}</td>
                  <td className="break-all py-2 pr-2 font-mono text-[11px] text-muted-foreground">
                    {row.id}
                  </td>
                  <td className="py-2 text-right font-mono text-[12px] tabular-nums text-paper">
                    {fixed(row.tps, 1)}
                  </td>
                  <td className="py-2 text-right font-mono text-[12px] tabular-nums text-muted-foreground">
                    {fixed((row as Bench & { ttft?: unknown }).ttft, 2)}
                  </td>
                  <td className="py-2 text-right font-mono text-[12px] tabular-nums text-muted-foreground">
                    {fixed(row.gib, 1)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
        <p className="mt-2 text-[11px] leading-relaxed text-faint">
          Measured on this machine through the production endpoint. Published benchmarks are not
          evidence about your hardware.
        </p>
      </Panel>

      {/* ROUTER ALIASES */}
      <Panel title="Router aliases">
        {loading ? (
          <Skeleton className="h-5 w-1/2" />
        ) : (data.aliases ?? []).length === 0 ? (
          <Empty>No aliases reported.</Empty>
        ) : (
          <table className="w-full text-left">
            <thead>
              <tr className="border-b border-rule font-mono text-[10px] uppercase tracking-[0.14em] text-faint">
                <th className="py-1.5 font-normal">Alias</th>
                <th className="py-1.5 font-normal">Target</th>
                <th className="py-1.5 text-right font-normal">Lane</th>
              </tr>
            </thead>
            <tbody>
              {(data.aliases ?? []).map((entry, index) => {
                const record = (entry && typeof entry === "object" ? entry : {}) as Record<
                  string,
                  unknown
                >;
                const alias = modelId(entry) || String(record.alias ?? entry ?? "");
                const target = String(record.target ?? record.model ?? "—");
                const lane = String(record.lane ?? (/gpt|claude|cloud/i.test(alias) ? "metered" : "local"));
                return (
                  <tr key={`${alias}-${index}`} className="border-b border-rule last:border-b-0">
                    <td className="break-all py-2 pr-2 font-mono text-[11px] text-paper">{alias}</td>
                    <td className="break-all py-2 pr-2 font-mono text-[11px] text-muted-foreground">
                      {target}
                    </td>
                    <td className="py-2 text-right font-mono text-[10px] uppercase tracking-[0.12em] text-faint">
                      {lane}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </Panel>

      {note && <p className="font-mono text-[10px] text-faint">{note}</p>}
      <p className="font-mono text-[10px] text-faint">
        Models · residency read live from the machine · budget from LM Studio and macOS memory
        pressure
      </p>
    </div>
  );
}

/**
 * Residency is an inventory read; only a live round-trip proves embedding
 * answers. Verified on the six-hour cadence, and on demand here.
 */
function RetrievalProof({
  resident,
  available,
  bench,
  ready,
  refresh,
}: {
  resident: unknown;
  available: unknown;
  bench: Bench[];
  ready: boolean;
  refresh: () => Promise<unknown>;
}) {
  const { health, prove, proving } = useEmbedderGuard({
    sources: { resident, available, bench },
    ready,
    refresh,
  });

  const verdict =
    health.proved === true
      ? "retrieval answered with sources"
      : health.proved === false
        ? "retrieval returned nothing"
        : "unproved since this session began";

  return (
    <div className="mt-2 flex flex-wrap items-baseline gap-x-3 gap-y-1 border-t border-rule pt-2">
      <span
        className={`font-mono text-[10px] uppercase tracking-[0.12em] ${
          health.proved === true ? "text-ok" : health.proved === false ? "text-risk" : "text-watch"
        }`}
      >
        {verdict}
      </span>
      <span className="font-mono text-[10px] tabular-nums text-faint">
        verified{" "}
        {health.provedAt
          ? health.provedAt.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })
          : "—"}{" "}
        · every {Math.round(EMBEDDER_CHECK_INTERVAL_MS / 3_600_000)} h
      </span>
      <span className="flex-1" />
      <button
        type="button"
        disabled={proving}
        onClick={() => void prove()}
        className="border border-rule px-2 py-1 font-mono text-[10px] uppercase tracking-[0.12em] text-muted-foreground hover:border-copper hover:text-copper disabled:opacity-50"
      >
        {proving ? "Probing…" : "Probe retrieval"}
      </button>
    </div>
  );
}
