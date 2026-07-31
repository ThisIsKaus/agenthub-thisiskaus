/**
 * Lane capacity — the machine has one pool of unified memory, not a fleet.
 *
 * A router alias is not a promise of availability. Asking a cold 27B lane while
 * a 35B is resident makes LM Studio refuse the load, and the router hands that
 * refusal back as a 200 whose `answer` is a JSON error string. Two consequences,
 * both handled here:
 *
 *   1. The canvas must know which lanes are actually resident before it offers
 *      them, and must never pick a cold lane on the reader's behalf (critique).
 *   2. A body that is an upstream failure must be read as a failure, not pinned
 *      as an answer. A run that records an error as its output poisons every
 *      downstream block that quotes it.
 */

import { useQuery } from "@tanstack/react-query";
import { LANES } from "@/lib/canvas-types";
import { useLocal } from "@/lib/local-bridge";

/** Router alias → the bench role that backs it. Cloud lanes have no role. */
const LANE_ROLE: Record<string, string> = {
  "local-brain": "quality-brain",
  "local-coder": "coding-local",
  "local-triage": "triage",
};

type Bench = { role: string; id: string; tps: number; gib: number };
type ModelsData = { resident?: string[]; bench?: Bench[] };

export type LaneStatus = "resident" | "cold" | "cloud" | "unknown";

export type LaneCapacity = {
  id: string;
  label: string;
  cost: string;
  status: LaneStatus;
  /** Weight to load, when the bench knows it. */
  gib: number | null;
  /** One line, plain: shown in the option and in the refusal. */
  note: string;
};

function match(resident: string[], modelId: string | undefined) {
  if (!modelId) return false;
  const needle = modelId.toLowerCase();
  return resident.some((entry) => {
    const value = entry.toLowerCase();
    return value === needle || value.includes(needle) || needle.includes(value);
  });
}

export function useLaneCapacity() {
  const local = useLocal();
  const query = useQuery({
    queryKey: ["lane-capacity"],
    enabled: local.available,
    staleTime: 30_000,
    refetchInterval: 60_000,
    queryFn: () => local.get<ModelsData>("/api/models"),
  });

  const resident = query.data?.resident ?? [];
  const bench = query.data?.bench ?? [];

  const lanes: LaneCapacity[] = LANES.map((lane) => {
    const role = LANE_ROLE[lane.id];
    if (!role) {
      return { id: lane.id, label: lane.label, cost: lane.cost, status: "cloud", gib: null, note: "off the machine" };
    }
    const entry = bench.find((item) => item.role === role);
    const gib = entry?.gib ?? null;
    if (!local.available || query.isLoading || !query.data) {
      return { id: lane.id, label: lane.label, cost: lane.cost, status: "unknown", gib, note: "" };
    }
    const isResident = match(resident, entry?.id);
    return {
      id: lane.id,
      label: lane.label,
      cost: lane.cost,
      status: isResident ? "resident" : "cold",
      gib,
      note: isResident ? "resident" : gib ? `needs ${gib.toFixed(1)} GiB loaded` : "not loaded",
    };
  });

  const byId = (id: string) => lanes.find((lane) => lane.id === id);

  /**
   * The honest second opinion: a different lane that is actually resident. A
   * cold lane is never chosen automatically — that is what produced the load
   * refusal in the first place.
   */
  function critiqueLane(currentModel: string | undefined): LaneCapacity | null {
    const different = lanes.filter((lane) => lane.id !== currentModel && lane.status !== "cloud");
    return (
      different.find((lane) => lane.status === "resident") ??
      different.find((lane) => lane.status === "unknown") ??
      null
    );
  }

  return { lanes, byId, critiqueLane, loading: query.isLoading, refresh: query.refetch };
}

/**
 * The router returns upstream failures inside a 200 body. Recognise them so a
 * failure is filed as a failure.
 */
const CAPACITY = /insufficient system resources|model loading was stopped|out of memory|would likely overload/i;
const UPSTREAM =
  /^\s*router \d{3}:|badrequesterror|openaiexception|apiconnectionerror|"error"\s*:\s*\{|failed to load model/i;

export type AnswerVerdict =
  | { ok: true }
  | { ok: false; kind: "capacity" | "upstream"; message: string };

export function readAnswer(answer: string, lane: string): AnswerVerdict {
  const text = (answer ?? "").trim();
  if (!text) return { ok: true };
  const head = text.slice(0, 600);
  if (CAPACITY.test(head)) {
    return {
      ok: false,
      kind: "capacity",
      message: `${lane} could not be loaded — the machine does not have the memory free while the current model is resident. Free it on Engine · Models, or ask on a resident lane.`,
    };
  }
  if (UPSTREAM.test(head)) {
    return { ok: false, kind: "upstream", message: `the router declined this lane — ${head.slice(0, 200)}` };
  }
  return { ok: true };
}
