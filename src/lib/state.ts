import { queryOptions } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import type { MachineBlock } from "@/lib/local-bridge";

export type StateRow = {
  id: string;
  services: { lms?: string; router?: string; aliases?: number };
  models: unknown[];
  corpus: { chunks?: number; documents?: number };
  spend: { mtd?: number; requests?: number };
  factory: { wip?: number; limit?: number; projects?: unknown[] };
  digest: { date?: string | null; items?: number; flags?: number; tasks?: number };
  health: { passed?: number; warnings?: number; failed?: number; at?: string | null };
  machine?: MachineBlock | null;
  updated_at: string;
};

/** REMOTE plane: the published row. Correct only when the machine cannot answer. */
export const stateQueryOptions = queryOptions({
  queryKey: ["state", "current"],
  refetchInterval: 30_000,
  queryFn: async (): Promise<StateRow | null> => {
    const { data, error } = await supabase
      .from("state")
      .select("*")
      .eq("id", "current")
      .maybeSingle();
    if (error) throw error;
    return (data as StateRow | null) ?? null;
  },
});

type LocalGet = <T = unknown>(
  path: string,
  query?: Record<string, string | number | undefined>,
) => Promise<T>;

type SelfTestRow = { group?: string; name?: string; state?: string; detail?: string };

function countSelfTest(rows: SelfTestRow[]) {
  let passed = 0;
  let warnings = 0;
  let failed = 0;
  for (const row of rows) {
    const state = String(row.state ?? "").toLowerCase();
    if (state.startsWith("pass") || state === "ok") passed += 1;
    else if (state.startsWith("warn")) warnings += 1;
    else if (state.startsWith("fail") || state === "error") failed += 1;
  }
  return { passed, warnings, failed };
}

/**
 * LOCAL plane: the machine's own answer. Authoritative when present — it is current
 * and complete, where the published row may be days old. Loopback only; never
 * forwarded anywhere.
 */
export function localStateQueryOptions(get: LocalGet, enabled: boolean) {
  return queryOptions({
    queryKey: ["state", "local"],
    enabled,
    refetchInterval: 20_000,
    staleTime: 10_000,
    queryFn: async (): Promise<StateRow> => {
      const soft = <T,>(promise: Promise<T>) => promise.catch(() => null);

      const [raw, kb, selftest, models, capabilities] = await Promise.all([
        soft(get<Partial<StateRow> & Record<string, unknown>>("/api/state")),
        soft(get<{ chunks?: number; documents?: number }>("/api/kb")),
        soft(get<{ summary?: string; rows?: SelfTestRow[] }>("/api/selftest")),
        soft(get<{ resident?: unknown[]; aliases?: unknown[] }>("/api/models")),
        soft(get<{ machine?: MachineBlock; time?: string }>("/api/capabilities")),
      ]);

      const base = (raw ?? {}) as Partial<StateRow>;
      const corpus = {
        chunks: kb?.chunks ?? base.corpus?.chunks,
        documents: kb?.documents ?? base.corpus?.documents,
      };

      const counted = selftest?.rows?.length ? countSelfTest(selftest.rows) : null;
      const health = {
        passed: counted?.passed ?? base.health?.passed,
        warnings: counted?.warnings ?? base.health?.warnings,
        failed: counted?.failed ?? base.health?.failed,
        at: base.health?.at ?? capabilities?.time ?? new Date().toISOString(),
      };

      const resident = models?.resident ?? [];
      const modelList = resident.length ? resident : (base.models ?? []);

      const services = {
        ...(base.services ?? {}),
        aliases: base.services?.aliases ?? models?.aliases?.length,
      };

      return {
        id: "current",
        services,
        models: modelList,
        corpus,
        spend: base.spend ?? {},
        factory: base.factory ?? {},
        digest: base.digest ?? {},
        health,
        machine: capabilities?.machine ?? base.machine ?? null,
        updated_at: capabilities?.time ?? new Date().toISOString(),
      };
    },
  });
}
