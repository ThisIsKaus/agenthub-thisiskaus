import { createFileRoute } from "@tanstack/react-router";
import { useState } from "react";
import { Panel } from "@/components/AppShell";
import { Empty, Skeleton } from "@/components/data";
import { LocalOnly } from "@/components/LocalOnly";
import { isRefusal, useLocal } from "@/lib/local-bridge";
import { fixed } from "@/lib/format";
import { useAutopilot } from "@/lib/model-autopilot";
import {
  EMBEDDER_COSTS,
  useEmbedderGuard,
  type EmbedderState,
} from "@/lib/embedder";
import type { Bench } from "@/lib/lane-capacity";
import {
  describePlan,
  isEmbedder,
  residentLoad,
  TASK_CLASSES,
  type TaskClass,
} from "@/lib/model-policy";
import { LANES } from "@/lib/canvas-types";

export const Route = createFileRoute("/_authenticated/models")({
  head: () => ({
    meta: [
      { title: "Models — AgentHub" },
      {
        name: "description",
        content:
          "Residency, memory budget and automatic loading for the models on the machine.",
      },
      { property: "og:title", content: "Models — AgentHub" },
      {
        property: "og:description",
        content:
          "Residency, memory budget and automatic loading for the models on the machine.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: () => (
    <LocalOnly>
      <ModelsPage />
    </LocalOnly>
  ),
});

const MODES = [
  { action: "standard", label: "Standard" },
  { action: "coding", label: "Coding" },
  { action: "tools", label: "Tools" },
  { action: "light", label: "Light" },
] as const;

const BUDGETS = [24, 32, 48, 64, 96] as const;

function ModelsPage() {
  const local = useLocal();
  const { policy, update, togglePin, capacity, plan, apply, ensureLane, working, note, setNote } =
    useAutopilot();
  const [busy, setBusy] = useState<string | null>(null);

  const loading = capacity.loading;
  const failed = !loading && capacity.error !== null;
  const resident = capacity.resident;
  const bench = capacity.bench;
  const used = residentLoad(resident, bench);
  const pct = policy.budgetGib > 0 ? Math.min(100, (used / policy.budgetGib) * 100) : 0;

  async function act(action: string, model?: string, label?: string) {
    setBusy(label ?? action);
    setNote("awaiting the machine…");
    try {
      await local.post("/api/models/action", { action, model });
      setNote(`${label ?? action} — done`);
      await capacity.refresh();
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

  const disabled = busy !== null || working !== null;

  return (
    <div className="space-y-4">
      {failed && (
        <div className="border border-copper bg-panel px-3 py-3">
          <p className="text-[13px] leading-relaxed text-copper">
            The machine is reachable but did not answer <span className="font-mono">/api/models</span>.
            Nothing below is current.
          </p>
          <button
            type="button"
            onClick={() => void capacity.refresh()}
            className="mt-2 border border-copper px-3 py-1 font-mono text-[10px] uppercase tracking-[0.12em] text-copper"
          >
            Try again
          </button>
        </div>
      )}

      <EmbedderPanel
        resident={resident}
        available={capacity.available}
        bench={bench}
        ready={!loading && !failed}
        refresh={capacity.refresh}
      />

      <Panel title="Autopilot">
        <div className="space-y-3">
          <label className="flex items-start gap-3">
            <input
              type="checkbox"
              checked={policy.autopilot}
              onChange={(event) => update({ autopilot: event.target.checked })}
              className="mt-1 accent-copper"
            />
            <span className="text-[13px] leading-relaxed text-paper">
              Load the lane a piece of work needs, evicting the heaviest unpinned model when the
              budget is tight.
              <span className="block text-muted-foreground">
                The embedder and pinned lanes are never evicted. Off, a cold lane is refused with the
                plan instead of run.
              </span>
            </span>
          </label>

          <div>
            <div className="flex items-baseline justify-between font-mono text-[10px] uppercase tracking-[0.14em] text-faint">
              <span>Memory budget</span>
              <span className="tabular-nums text-muted-foreground">
                {fixed(used, 1)} / {policy.budgetGib} GiB resident
              </span>
            </div>
            <div className="mt-1 h-1.5 w-full bg-panel2">
              <div
                className={pct > 90 ? "h-full bg-risk" : pct > 70 ? "h-full bg-watch" : "h-full bg-copper"}
                style={{ width: `${pct}%` }}
              />
            </div>
            <div className="mt-2 flex flex-wrap gap-2">
              {BUDGETS.map((value) => (
                <button
                  key={value}
                  type="button"
                  onClick={() => update({ budgetGib: value })}
                  className={`border px-2 py-1 font-mono text-[10px] ${
                    policy.budgetGib === value
                      ? "border-copper text-copper"
                      : "border-rule text-muted-foreground hover:border-copper hover:text-copper"
                  }`}
                >
                  {value} GiB
                </button>
              ))}
            </div>
          </div>
        </div>
      </Panel>

      <Panel title="Routing by work">
        <p className="mb-2 text-[13px] leading-relaxed text-muted-foreground">
          Which lane each class of work asks for. Complexity ascends; a heavier lane costs memory and
          latency, not accuracy alone.
        </p>
        <table className="w-full text-left">
          <tbody>
            {TASK_CLASSES.map((task) => {
              const laneId = policy.routes[task.id as TaskClass];
              const lane = capacity.byId(laneId);
              return (
                <tr key={task.id} className="border-b border-rule last:border-b-0 align-baseline">
                  <td className="py-2 pr-3">
                    <span className="text-[13px] text-paper">{task.label}</span>
                    <span className="block text-[11px] text-faint">{task.detail}</span>
                  </td>
                  <td className="py-2 pr-3">
                    <select
                      value={laneId}
                      onChange={(event) =>
                        update({ routes: { [task.id]: event.target.value } as Record<TaskClass, string> })
                      }
                      className="border border-rule bg-panel2 px-2 py-1 font-mono text-[11px] text-paper"
                    >
                      {LANES.map((option) => (
                        <option key={option.id} value={option.id}>
                          {option.label}
                        </option>
                      ))}
                    </select>
                  </td>
                  <td className="py-2 text-right font-mono text-[10px] uppercase tracking-[0.12em]">
                    <span
                      className={
                        lane?.status === "resident"
                          ? "text-ok"
                          : lane?.status === "cloud"
                            ? "text-muted-foreground"
                            : lane?.status === "cold"
                              ? "text-watch"
                              : "text-faint"
                      }
                    >
                      {lane?.status ?? "unknown"}
                    </span>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </Panel>

      <Panel title="Lanes">
        {loading ? (
          <Skeleton className="h-16 w-full" />
        ) : (
          <ul>
            {capacity.lanes.map((lane) => {
              const target = plan(lane.id);
              const pinned = policy.pinned.includes(lane.id);
              return (
                <li key={lane.id} className="border-b border-rule py-2 last:border-b-0">
                  <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
                    <span className="text-[13px] text-paper">{lane.label}</span>
                    <span className="font-mono text-[10px] text-faint">{lane.id}</span>
                    <span
                      className={`font-mono text-[10px] uppercase tracking-[0.12em] ${
                        lane.status === "resident"
                          ? "text-ok"
                          : lane.status === "cold"
                            ? "text-watch"
                            : "text-muted-foreground"
                      }`}
                    >
                      {lane.status}
                    </span>
                    {lane.gib != null && (
                      <span className="font-mono text-[10px] tabular-nums text-faint">
                        {fixed(lane.gib, 1)} GiB
                      </span>
                    )}
                    {lane.tps != null && (
                      <span className="font-mono text-[10px] tabular-nums text-faint">
                        {fixed(lane.tps, 1)} t/s
                      </span>
                    )}
                    <span className="flex-1" />
                    {lane.status !== "cloud" && (
                      <button
                        type="button"
                        onClick={() => togglePin(lane.id)}
                        className={`font-mono text-[10px] uppercase tracking-[0.12em] ${
                          pinned ? "text-copper" : "text-faint hover:text-copper"
                        }`}
                      >
                        {pinned ? "Pinned" : "Pin"}
                      </button>
                    )}
                    {lane.status === "cold" && (
                      <button
                        type="button"
                        disabled={disabled}
                        onClick={() => void apply(lane.id)}
                        className="border border-rule px-2 py-1 font-mono text-[10px] uppercase tracking-[0.12em] text-muted-foreground hover:border-copper hover:text-copper disabled:opacity-50"
                      >
                        {working === lane.id ? "…" : "Make resident"}
                      </button>
                    )}
                  </div>
                  {target && target.kind !== "resident" && target.kind !== "cloud" && (
                    <p className="mt-1 text-[11px] leading-relaxed text-muted-foreground">
                      {describePlan(target)}
                    </p>
                  )}
                </li>
              );
            })}
          </ul>
        )}
      </Panel>

      <Panel title="Mode">
        <div className="flex flex-wrap gap-2">
          {MODES.map((mode) => (
            <button
              key={mode.action}
              type="button"
              disabled={disabled}
              onClick={() => void act(mode.action, undefined, mode.label)}
              className="border border-rule px-3 py-1.5 font-mono text-[11px] uppercase tracking-[0.12em] text-muted-foreground hover:border-copper hover:text-copper disabled:opacity-50"
            >
              {busy === mode.label ? "…" : mode.label}
            </button>
          ))}
        </div>
      </Panel>



      <Panel title="Resident">
        {loading ? (
          <div className="space-y-2">
            {Array.from({ length: 3 }).map((_, index) => (
              <Skeleton key={index} className="h-4 w-full" />
            ))}
          </div>
        ) : resident.length === 0 ? (
          <Empty>{failed ? "The machine did not answer." : "Nothing loaded."}</Empty>
        ) : (
          <ul>
            {resident.map((model) => (
              <li
                key={model}
                className="flex items-baseline gap-3 border-b border-rule py-2 last:border-b-0"
              >
                <span className="min-w-0 flex-1 break-all font-mono text-[12px] text-paper">
                  {model}
                </span>
                <span className="shrink-0 font-mono text-[10px] tabular-nums text-faint">
                  {fixed(residentLoad([model], bench), 1)} GiB
                </span>
                {isEmbedder(model) ? (
                  <span className="shrink-0 font-mono text-[10px] text-faint">embedder</span>
                ) : (
                  <button
                    type="button"
                    disabled={disabled}
                    onClick={() => void act("unload", model, `unload ${model}`)}
                    className="shrink-0 font-mono text-[10px] uppercase tracking-[0.12em] text-faint hover:text-risk disabled:opacity-50"
                  >
                    Unload
                  </button>
                )}
              </li>
            ))}
          </ul>
        )}
      </Panel>

      <Panel title="Available on disk">
        {loading ? (
          <Skeleton className="h-5 w-2/3" />
        ) : capacity.available.length === 0 ? (
          <Empty>No other models on disk.</Empty>
        ) : (
          <div className="flex flex-wrap gap-2">
            {capacity.available.map((model) => (
              <button
                key={model}
                type="button"
                disabled={disabled}
                onClick={() => void act("load", model, `load ${model}`)}
                className="border border-rule px-2 py-1 font-mono text-[10px] text-muted-foreground hover:border-copper hover:text-copper disabled:opacity-50"
              >
                {model}
              </button>
            ))}
          </div>
        )}
      </Panel>

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
                    {fixed(row.gib, 1)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Panel>

      <Panel title="Router aliases">
        {loading ? (
          <Skeleton className="h-5 w-1/2" />
        ) : (
          <div className="flex flex-wrap gap-2">
            {capacity.aliases.map((alias) => (
              <span
                key={alias}
                className="border border-rule bg-panel2 px-2 py-1 font-mono text-[10px] text-muted-foreground"
              >
                {alias}
              </span>
            ))}
          </div>
        )}
      </Panel>

      {note && <p className="font-mono text-[10px] text-faint">{note}</p>}
      <button
        type="button"
        onClick={() => void ensureLane(policy.routes.ask)}
        className="font-mono text-[10px] uppercase tracking-[0.12em] text-faint hover:text-copper"
      >
        Ready the Ask lane
      </button>
    </div>
  );
}

const TONE: Record<EmbedderState, string> = {
  resident: "border-rule",
  answering: "border-rule",
  partial: "border-watch",
  missing: "border-risk",
  restoring: "border-copper",
  unknown: "border-rule",
};

const HEADLINE: Record<EmbedderState, string> = {
  resident: "All loaded and answering",
  answering: "Answering (not in the resident list)",
  partial: "Some not loaded",
  missing: "Not answering",
  restoring: "Loading",
  unknown: "Unproved",
};

const TEXT_TONE: Record<EmbedderState, string> = {
  resident: "text-ok",
  answering: "text-ok",
  partial: "text-watch",
  missing: "text-risk",
  restoring: "text-watch",
  unknown: "text-watch",
};

/** One sentence answering the only question that matters: is it working? */
const VERDICT: Record<EmbedderState, string> = {
  resident:
    "Every embedding model the machine knows about is loaded, and a live probe came back with sources. Retrieval is working.",
  answering:
    "A live probe came back with sources, so retrieval is working — the model list just does not report it under a name we recognise. Evidence beats the list.",
  partial:
    "Retrieval works, but not every embedding model is loaded. The guard is reloading the rest so anything that reaches for one finds it.",
  missing: "A live probe came back with no sources. Retrieval is not working right now.",
  restoring: "Loading the embedding models.",
  unknown:
    "Not proved yet. The model list is only an inventory — it does not show whether embedding actually answers. Run the probe to know.",
};

function stamp(value: Date | null) {
  return value ? value.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" }) : "—";
}

/**
 * Embedding is the one dependency whose absence is silent: questions still
 * answer, they just answer from nothing. So the whole embedding set gets a
 * standing panel — every known model, whether each is resident, proof, and a
 * narrow repair — and a watchdog that keeps them all loaded without being
 * asked, including after a machine restart. The panel never asserts "dead"
 * from an inventory read alone; only a failed live probe earns that word.
 */
function EmbedderPanel({
  resident,
  available,
  bench,
  ready,
  refresh,
}: {
  resident: string[];
  available: string[];
  bench: Bench[];
  ready: boolean;
  refresh: () => Promise<unknown>;
}) {
  const { health, restore, prove, restoring, proving } = useEmbedderGuard({
    sources: { resident, available, bench },
    ready,
    refresh,
  });
  const down = health.state === "missing";
  const busy = restoring || proving;

  return (
    <section className={`border ${TONE[health.state]} bg-panel px-3 py-3`}>
      <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
        <h2 className="font-serif text-[15px] text-paper">Embedding</h2>
        <span
          className={`font-mono text-[10px] uppercase tracking-[0.14em] ${TEXT_TONE[health.state]}`}
        >
          {HEADLINE[health.state]}
        </span>
        <span className="flex-1" />
        <span className="font-mono text-[10px] tabular-nums text-faint">
          {health.residentCount}/{health.knownCount} resident · list read {stamp(health.checkedAt)} ·
          probed {stamp(health.provedAt)}
        </span>
      </div>

      <p className="mt-2 text-[13px] leading-relaxed text-paper">{VERDICT[health.state]}</p>

      {health.models.length === 0 ? (
        <p className="mt-2 font-mono text-[11px] text-muted-foreground">
          no embedding model named on the machine
        </p>
      ) : (
        <ul className="mt-2 divide-y divide-rule border-y border-rule">
          {health.models.map((model) => (
            <li key={model.id} className="flex flex-wrap items-baseline gap-x-2 py-1.5">
              <span
                aria-hidden
                className={`h-1.5 w-1.5 shrink-0 rounded-full ${model.listed ? "bg-ok" : "bg-risk"}`}
              />
              <span className="break-all font-mono text-[11px] text-paper">{model.id}</span>
              {model.primary && (
                <span className="font-mono text-[10px] uppercase tracking-[0.12em] text-copper">
                  primary
                </span>
              )}
              <span className="flex-1" />
              <span className="font-mono text-[10px] tabular-nums text-faint">
                {model.gib === null ? "— GiB" : `${fixed(model.gib, 1)} GiB`}
              </span>
              <span
                className={`w-[7.5rem] text-right font-mono text-[10px] uppercase tracking-[0.12em] ${model.listed ? "text-ok" : "text-risk"}`}
              >
                {model.listed ? "resident" : "not loaded"}
              </span>
              {!model.listed && (
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => void restore(model.id)}
                  className="border border-copper px-2 py-0.5 font-mono text-[10px] uppercase tracking-[0.12em] text-copper disabled:opacity-40"
                >
                  Load
                </button>
              )}
            </li>
          ))}
        </ul>
      )}

      {down && (
        <ul className="mt-2 space-y-1 border-l border-risk pl-3">
          {EMBEDDER_COSTS.map((line) => (
            <li key={line} className="text-[13px] leading-relaxed text-muted-foreground">
              {line}
            </li>
          ))}
        </ul>
      )}

      <div className="mt-3 flex flex-wrap gap-2">
        <button
          type="button"
          disabled={busy}
          onClick={() => void prove()}
          className="border border-copper px-3 py-1 font-mono text-[10px] uppercase tracking-[0.12em] text-copper disabled:opacity-40"
        >
          {proving ? "Probing…" : "Probe retrieval"}
        </button>
        <button
          type="button"
          disabled={busy}
          onClick={() => void restore()}
          className="border border-rule px-3 py-1 font-mono text-[10px] uppercase tracking-[0.12em] text-muted-foreground hover:border-copper hover:text-copper disabled:opacity-40"
        >
          {restoring ? "Loading…" : "Load every embedder"}
        </button>
      </div>

      <p className="mt-2 text-[11px] leading-relaxed text-faint">
        {health.message ??
          `Kept resident always — not a preference and not part of the memory budget's eviction set. Residency is re-read every minute, and anything that drops out (including after a machine restart) is reloaded on its own${health.repairs ? ` · ${health.repairs} reload${health.repairs === 1 ? "" : "s"} this session` : ""}.`}
      </p>
    </section>
  );
}


