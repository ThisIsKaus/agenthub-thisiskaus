/**
 * Applying a plan. The policy decides; this carries it out against the machine.
 *
 * Every step is a multipart POST to /api/models/action — a JSON body returns
 * 422. Evictions run before the load, one at a time, because LM Studio frees
 * memory as each unload completes and a parallel burst can still trip the
 * "would likely overload your system" refusal.
 */

import { useCallback, useState } from "react";
import { useLocal, isRefusal } from "@/lib/local-bridge";
import { useLaneCapacity } from "@/lib/lane-capacity";
import { describePlan, planFor, useModelPolicy, type LoadPlan } from "@/lib/model-policy";

export type ApplyResult = { ok: boolean; message: string };

export function useAutopilot() {
  const local = useLocal();
  const capacity = useLaneCapacity();
  const { policy, update, togglePin } = useModelPolicy();
  const [working, setWorking] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);

  const plan = useCallback(
    (laneId: string): LoadPlan | null =>
      planFor(laneId, {
        lanes: capacity.lanes,
        resident: capacity.resident,
        bench: capacity.bench,
        policy,
      }),
    [capacity.lanes, capacity.resident, capacity.bench, policy],
  );

  const apply = useCallback(
    async (laneId: string): Promise<ApplyResult> => {
      const target = plan(laneId);
      if (!target) return { ok: false, message: "unknown lane" };
      if (target.kind === "resident" || target.kind === "cloud")
        return { ok: true, message: describePlan(target) };
      if (target.kind !== "load") return { ok: false, message: describePlan(target) };

      setWorking(laneId);
      setNote("awaiting the machine…");
      try {
        for (const victim of target.evict) {
          setNote(`unloading ${victim}…`);
          await local.post("/api/models/action", { action: "unload", model: victim });
        }
        setNote(`loading ${target.lane.label}…`);
        await local.post("/api/models/action", { action: "load", model: target.modelId });
        await capacity.refresh();
        const message = `${target.lane.label} is resident — ${target.headroom.toFixed(1)} GiB left in budget.`;
        setNote(message);
        return { ok: true, message };
      } catch (error) {
        const message = isRefusal(error)
          ? error.message || "denied at the approval dialog"
          : "the machine did not carry that out";
        setNote(message);
        return { ok: false, message };
      } finally {
        setWorking(null);
      }
    },
    [plan, local, capacity],
  );

  /**
   * Used before a run: make the lane serve, but only silently when autopilot is
   * on. With it off the caller gets the plan back and asks the reader first.
   */
  const ensureLane = useCallback(
    async (laneId: string): Promise<ApplyResult> => {
      const target = plan(laneId);
      if (!target) return { ok: false, message: "unknown lane" };
      if (target.kind === "resident" || target.kind === "cloud" || target.kind === "unknown")
        return { ok: true, message: describePlan(target) };
      if (!policy.autopilot)
        return {
          ok: false,
          message: `${target.lane.label} is not loaded. ${describePlan(target)} Turn on autopilot, or load it on Engine · Models.`,
        };
      return apply(laneId);
    },
    [plan, policy.autopilot, apply],
  );

  return { policy, update, togglePin, capacity, plan, apply, ensureLane, working, note, setNote };
}
