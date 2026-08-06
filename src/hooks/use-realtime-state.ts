import { createContext, useContext, useEffect, useMemo } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useLocal } from "@/lib/local-bridge";
import { localStateQueryOptions, stateQueryOptions, type StateRow } from "@/lib/state";

/**
 * Subscribes to the single published `state` row and to job status changes so the
 * read-only tabs update without a refresh. Payloads are never read here — the
 * change event only invalidates the queries, which re-fetch status and counts.
 */
export function useRealtimeState() {
  const queryClient = useQueryClient();

  useEffect(() => {
    const channel = supabase
      .channel("agenthub-state")
      .on("postgres_changes", { event: "*", schema: "public", table: "state" }, () => {
        queryClient.invalidateQueries({ queryKey: ["state"] });
      })
      .on("postgres_changes", { event: "*", schema: "public", table: "jobs" }, () => {
        queryClient.invalidateQueries({ queryKey: ["jobs"] });
        queryClient.invalidateQueries({ queryKey: ["captures"] });
      })
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [queryClient]);
}

export type HubSource = "local" | "published";

function relative(value: string | null | undefined) {
  if (!value) return "never";
  const then = new Date(value).getTime();
  if (Number.isNaN(then)) return "never";
  const mins = Math.max(0, Math.round((Date.now() - then) / 60_000));
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.round(mins / 60);
  if (hours < 48) return `${hours}h ago`;
  return `${Math.round(hours / 24)}d ago`;
}

/** Fill only the gaps — the machine's own figures always win. */
function fillGaps(live: StateRow, published: StateRow | null | undefined): StateRow {
  if (!published) return live;
  const pick = <T extends object>(a: T | undefined, b: T | undefined): T =>
    ({ ...(b ?? {}), ...Object.fromEntries(Object.entries(a ?? {}).filter(([, v]) => v != null)) }) as T;
  return {
    ...live,
    services: pick(live.services, published.services),
    corpus: pick(live.corpus, published.corpus),
    spend: pick(live.spend, published.spend),
    factory: pick(live.factory, published.factory),
    digest: pick(live.digest, published.digest),
    health: pick(live.health, published.health),
    models: live.models?.length ? live.models : published.models,
    machine: live.machine ?? published.machine ?? null,
  };
}

export type HubState = {
  data: StateRow | null;
  source: HubSource;
  asOf: string | null;
  provenance: string;
  isPending: boolean;
};

/**
 * PRECEDENCE: the machine answers for itself when the loopback bridge is up;
 * otherwise the published row, always labelled with how old it is.
 */
export function useHubStateValue(): HubState {
  const local = useLocal();
  const published = useQuery(stateQueryOptions);
  const localState = useQuery(localStateQueryOptions(local.get, local.available));

  return useMemo(() => {
    // Until the loopback probe settles, the source is unknown. Published state
    // may not be rendered as current on a machine that is about to answer.
    if (!local.resolved) {
      return { data: null, source: "published", asOf: null, provenance: "reading", isPending: true };
    }
    const isLocal = local.available && !!localState.data;
    const data = isLocal ? fillGaps(localState.data!, published.data) : (published.data ?? null);
    const source: HubSource = isLocal ? "local" : "published";
    const asOf = data?.updated_at ?? null;
    return {
      data,
      source,
      asOf,
      provenance: isLocal ? "live" : `published ${relative(asOf)}`,
      isPending: isLocal ? false : published.isPending && localState.isPending,
    };
  }, [
    local.available,
    local.resolved,
    localState.data,
    localState.isPending,
    published.data,
    published.isPending,
  ]);
}

/**
 * One read for the whole shell. The header and every route consume the same
 * object, so two routes can never report different figures for one machine.
 */
export const HubStateContext = createContext<HubState | null>(null);

export function useHubState(): HubState {
  const shared = useContext(HubStateContext);
  const own = useHubStateValue();
  return shared ?? own;
}
