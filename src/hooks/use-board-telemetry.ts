import { useQuery } from "@tanstack/react-query";
import { useLocal } from "@/lib/local-bridge";
import { useHubState } from "@/hooks/use-realtime-state";
import type { StateRow } from "@/lib/state";

/**
 * Every figure on the board, gathered once. Local endpoints are read only when
 * the loopback bridge is up; there is never a Supabase fallback for them.
 */

export type Bench = { role?: string; id?: string; tps?: number; ttft?: number; gib?: number };
type ModelsPayload = {
  resident?: unknown[];
  available?: unknown[];
  bench?: Bench[];
  aliases?: unknown[];
};
type KbPayload = { chunks?: number; documents?: number; sources?: unknown[] };
type EvalScores = {
  class?: number;
  cls?: number;
  entity?: number;
  sensitivity?: number;
  injection?: number;
  recall?: number;
};
type EvalsPayload = {
  results?: { date?: string; model?: string; scores?: EvalScores }[];
  set_size?: number;
  real_items?: number;
};
type CascadePayload = {
  tiers?: Record<string, number> | { tier?: string | number; count?: number }[];
  resolved_locally?: number;
  verify_pass_rate?: number;
  runs?: number;
};
type CapabilitiesPayload = { version?: string; features?: string[]; time?: string };
type RootsPayload = { roots?: unknown[] } | unknown[];
type FactoryPayload = { wip?: number; limit?: number; projects?: unknown[] };

function useLocalJson<T>(key: string, path: string, enabled: boolean, ms = 60_000) {
  const local = useLocal();
  return useQuery({
    queryKey: ["local", "board", key],
    enabled,
    refetchInterval: ms,
    staleTime: ms / 2,
    retry: false,
    queryFn: () => local.get<T>(path),
  });
}

export function num(value: unknown): number | null {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

/** Scores arrive either as a ratio or as a percentage. Normalise to percent. */
export function asPercent(value: unknown): number | null {
  const parsed = num(value);
  if (parsed === null) return null;
  return parsed <= 1 ? parsed * 100 : parsed;
}

export function modelName(entry: unknown, index = 0): string {
  if (typeof entry === "string") return entry;
  if (entry && typeof entry === "object") {
    const record = entry as Record<string, unknown>;
    const label = record.id ?? record.name ?? record.model ?? record.alias;
    if (label) return String(label);
  }
  return `model-${index + 1}`;
}

export type BoardTelemetry = {
  live: boolean;
  state: StateRow | null;
  provenance: string;
  isPending: boolean;
  kb: KbPayload | null;
  models: ModelsPayload | null;
  evals: EvalsPayload | null;
  cascade: CascadePayload | null;
  capabilities: CapabilitiesPayload | null;
  roots: number | null;
  factory: FactoryPayload | null;
  bestBench: Bench | null;
  residentGiB: number | null;
  latestScores: EvalScores | null;
};

export function useBoardTelemetry(live: boolean): BoardTelemetry {
  const { data: state, provenance, isPending } = useHubState();

  const kb = useLocalJson<KbPayload>("kb", "/api/kb", live, 120_000);
  const models = useLocalJson<ModelsPayload>("models", "/api/models", live, 120_000);
  const evals = useLocalJson<EvalsPayload>("evals", "/api/evals", live, 300_000);
  const cascade = useLocalJson<CascadePayload>("cascade", "/api/cascade/stats", live, 300_000);
  const capabilities = useLocalJson<CapabilitiesPayload>(
    "capabilities",
    "/api/capabilities",
    live,
    300_000,
  );
  const roots = useLocalJson<RootsPayload>("roots", "/api/roots", live, 300_000);
  const factory = useLocalJson<FactoryPayload>("factory", "/api/factory", live, 120_000);

  const bench = models.data?.bench ?? [];
  const bestBench =
    bench.length > 0
      ? bench.reduce((best, row) => ((num(row.tps) ?? 0) > (num(best.tps) ?? 0) ? row : best), bench[0])
      : null;

  const residentGiB = bench.length
    ? bench.reduce((total, row) => total + (num(row.gib) ?? 0), 0)
    : null;

  const rootsList = Array.isArray(roots.data)
    ? roots.data
    : ((roots.data as { roots?: unknown[] } | null)?.roots ?? null);

  const results = evals.data?.results ?? [];
  const latestScores = results.length ? (results[results.length - 1]?.scores ?? null) : null;

  return {
    live,
    state,
    provenance,
    isPending,
    kb: kb.data ?? null,
    models: models.data ?? null,
    evals: evals.data ?? null,
    cascade: cascade.data ?? null,
    capabilities: capabilities.data ?? null,
    roots: rootsList ? rootsList.length : null,
    factory: factory.data ?? null,
    bestBench,
    residentGiB: residentGiB && residentGiB > 0 ? residentGiB : null,
    latestScores,
  };
}
