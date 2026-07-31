/**
 * Model autopilot — residency as a budget, not a wish.
 *
 * The machine has one pool of unified memory. LM Studio refuses a load that
 * would overrun it, and the router hands that refusal back as a 200 whose body
 * is an error string. The only reliable way to "just work" is to decide, before
 * asking, which weights should be resident for the work in hand — and to make
 * room deliberately rather than hope.
 *
 * Three rules, in order:
 *   1. Preference wins. A lane the reader pinned is never unloaded automatically.
 *   2. The embedder is never evicted — the knowledge base is dead without it.
 *   3. Nothing is unloaded speculatively. Eviction happens only to fit a load
 *      that was actually asked for, and the plan is shown before it runs.
 */

import { useCallback, useEffect, useMemo, useState } from "react";
import { LANES } from "@/lib/canvas-types";
import { toNum } from "@/lib/format";
import type { Bench, LaneCapacity } from "@/lib/lane-capacity";

const STORE_KEY = "agenthub.model-policy.v1";

/** Work classes the harness actually routes. Complexity ascends. */
export const TASK_CLASSES = [
  { id: "triage", label: "Triage", detail: "classify, tag, one-line summaries", weight: 1 },
  { id: "ask", label: "Ask", detail: "questions over the knowledge base", weight: 2 },
  { id: "draft", label: "Draft", detail: "long-form writing and reasoning", weight: 3 },
  { id: "code", label: "Code", detail: "code reading, patches, review", weight: 3 },
  { id: "critique", label: "Critique", detail: "a second opinion on a pinned run", weight: 2 },
] as const;

export type TaskClass = (typeof TASK_CLASSES)[number]["id"];

export type ModelPolicy = {
  /** Load and evict without asking, when a plan is safe. */
  autopilot: boolean;
  /** Memory the reader is willing to hold in weights, GiB. */
  budgetGib: number;
  /** Lanes that must never be evicted to make room. */
  pinned: string[];
  /** Work class → router alias. */
  routes: Record<TaskClass, string>;
  /** Fall back to a metered cloud lane when the local plan cannot fit. */
  allowCloudFallback: boolean;
};

export const DEFAULT_POLICY: ModelPolicy = {
  autopilot: true,
  budgetGib: 48,
  pinned: [],
  routes: {
    triage: "local-triage",
    ask: "local-brain",
    draft: "local-brain",
    code: "local-coder",
    critique: "local-triage",
  },
  allowCloudFallback: false,
};

function read(): ModelPolicy {
  if (typeof window === "undefined") return DEFAULT_POLICY;
  try {
    const raw = window.localStorage.getItem(STORE_KEY);
    if (!raw) return DEFAULT_POLICY;
    const value = JSON.parse(raw) as Partial<ModelPolicy>;
    return {
      ...DEFAULT_POLICY,
      ...value,
      routes: { ...DEFAULT_POLICY.routes, ...(value.routes ?? {}) },
      pinned: Array.isArray(value.pinned) ? value.pinned : [],
    };
  } catch {
    return DEFAULT_POLICY;
  }
}

function write(policy: ModelPolicy) {
  try {
    window.localStorage.setItem(STORE_KEY, JSON.stringify(policy));
  } catch {
    /* private mode — the defaults still hold for this session */
  }
}

export function isEmbedder(id: string) {
  return /embed/i.test(id);
}

/** Resident weight, GiB, as far as the bench can account for it. */
export function residentLoad(resident: string[], bench: Bench[]): number {
  return resident.reduce((total, entry) => {
    const value = entry.toLowerCase();
    const match = bench.find((item) => {
      const id = (item.id ?? "").toLowerCase();
      return id && (id === value || id.includes(value) || value.includes(id));
    });
    return total + (toNum(match?.gib) ?? 0);
  }, 0);
}

export type LoadPlan =
  | { kind: "resident"; lane: LaneCapacity }
  | { kind: "cloud"; lane: LaneCapacity }
  | { kind: "unknown"; lane: LaneCapacity; reason: string }
  | { kind: "load"; lane: LaneCapacity; modelId: string; evict: string[]; freed: number; headroom: number }
  | { kind: "blocked"; lane: LaneCapacity; reason: string };

type PlanInput = {
  lanes: LaneCapacity[];
  resident: string[];
  bench: Bench[];
  policy: ModelPolicy;
};

/**
 * What it would take to serve this lane. Pure — nothing is loaded or unloaded
 * until someone applies the plan.
 */
export function planFor(laneId: string, input: PlanInput): LoadPlan | null {
  const lane = input.lanes.find((item) => item.id === laneId);
  if (!lane) return null;
  if (lane.status === "cloud") return { kind: "cloud", lane };
  if (lane.status === "resident") return { kind: "resident", lane };
  if (lane.status === "unknown")
    return { kind: "unknown", lane, reason: "the machine has not reported residency yet" };
  if (!lane.modelId) return { kind: "blocked", lane, reason: "the bench does not name a model for this lane" };

  const need = lane.gib ?? 0;
  const used = residentLoad(input.resident, input.bench);
  let headroom = input.policy.budgetGib - used;

  // Lanes the reader pinned, and the embedder, are not eviction candidates.
  const pinnedModelIds = new Set(
    input.lanes
      .filter((item) => input.policy.pinned.includes(item.id) && item.modelId)
      .map((item) => item.modelId as string),
  );

  const evict: string[] = [];
  let freed = 0;

  if (need > headroom) {
    const candidates = input.resident
      .filter((entry) => !isEmbedder(entry))
      .filter((entry) => !pinnedModelIds.has(entry))
      .filter((entry) => entry.toLowerCase() !== lane.modelId?.toLowerCase())
      .map((entry) => ({ entry, gib: residentLoad([entry], input.bench) }))
      // Heaviest first: fewest evictions to fit.
      .sort((a, b) => b.gib - a.gib);

    for (const candidate of candidates) {
      if (need <= headroom + freed) break;
      evict.push(candidate.entry);
      freed += candidate.gib;
    }
  }

  if (need > headroom + freed) {
    return {
      kind: "blocked",
      lane,
      reason: `${lane.label} needs ${need.toFixed(1)} GiB and only ${(headroom + freed).toFixed(1)} GiB can be freed inside a ${input.policy.budgetGib} GiB budget. Raise the budget or unpin a lane.`,
    };
  }

  headroom = headroom + freed - need;
  return { kind: "load", lane, modelId: lane.modelId, evict, freed, headroom };
}

/** One line describing a plan, for the button and the log. */
export function describePlan(plan: LoadPlan): string {
  switch (plan.kind) {
    case "resident":
      return `${plan.lane.label} is already resident.`;
    case "cloud":
      return `${plan.lane.label} runs off the machine — nothing to load.`;
    case "unknown":
      return plan.reason;
    case "blocked":
      return plan.reason;
    case "load":
      return plan.evict.length
        ? `Unload ${plan.evict.join(", ")} (${plan.freed.toFixed(1)} GiB), then load ${plan.lane.label}.`
        : `Load ${plan.lane.label} (${(plan.lane.gib ?? 0).toFixed(1)} GiB).`;
  }
}

/** The lane the policy would use for a class of work. */
export function laneForTask(task: TaskClass, policy: ModelPolicy): string {
  return policy.routes[task] ?? LANES[0].id;
}

export function useModelPolicy() {
  const [policy, setPolicy] = useState<ModelPolicy>(DEFAULT_POLICY);

  useEffect(() => {
    setPolicy(read());
  }, []);

  const update = useCallback((patch: Partial<ModelPolicy>) => {
    setPolicy((current) => {
      const next = { ...current, ...patch, routes: { ...current.routes, ...(patch.routes ?? {}) } };
      write(next);
      return next;
    });
  }, []);

  const togglePin = useCallback(
    (laneId: string) =>
      setPolicy((current) => {
        const pinned = current.pinned.includes(laneId)
          ? current.pinned.filter((id) => id !== laneId)
          : [...current.pinned, laneId];
        const next = { ...current, pinned };
        write(next);
        return next;
      }),
    [],
  );

  return useMemo(() => ({ policy, update, togglePin, reset: () => update(DEFAULT_POLICY) }), [policy, update, togglePin]);
}
