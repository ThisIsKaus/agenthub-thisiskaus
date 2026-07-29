import { queryOptions } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";

export type StateRow = {
  id: string;
  services: { lms?: string; router?: string; aliases?: number };
  models: unknown[];
  corpus: { chunks?: number; documents?: number };
  spend: { mtd?: number; requests?: number };
  factory: { wip?: number; limit?: number; projects?: unknown[] };
  digest: { date?: string | null; items?: number; flags?: number; tasks?: number };
  health: { passed?: number; warnings?: number; failed?: number; at?: string | null };
  updated_at: string;
};

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
