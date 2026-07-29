import { queryOptions } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";

export type JobKind = "capture" | "factory_stage" | "ingest" | "intake" | "report";

export type JobRow = {
  id: string;
  kind: JobKind;
  status: "queued" | "claimed" | "done" | "failed";
  created_at: string;
  claimed_at: string | null;
  completed_at: string | null;
  error: string | null;
};

/** Queue work for the machine. It claims this within 30s on its next outbound poll. */
export async function insertJob(kind: JobKind, payload: Record<string, unknown>) {
  const { data } = await supabase.auth.getUser();
  const userId = data.user?.id;
  if (!userId) throw new Error("No session");

  const { error } = await supabase.from("jobs").insert({ kind, created_by: userId, payload });
  if (error) throw error;
}

/** Status only — payloads and results are never read back into the UI. */
export const recentJobsQueryOptions = queryOptions({
  queryKey: ["jobs", "recent"],
  refetchInterval: 30_000,
  queryFn: async (): Promise<JobRow[]> => {
    const { data, error } = await supabase
      .from("jobs")
      .select("id, kind, status, created_at, claimed_at, completed_at, error")
      .order("created_at", { ascending: false })
      .limit(12);
    if (error) throw error;
    return (data ?? []) as JobRow[];
  },
});
