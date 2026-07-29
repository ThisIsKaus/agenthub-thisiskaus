import { useEffect } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";

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
