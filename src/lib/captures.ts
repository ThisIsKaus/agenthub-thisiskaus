import { queryOptions } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";

export type CaptureRow = {
  id: string;
  text: string;
  captured_at: string;
  /** held = on this device only · queued = with the machine · delivered = run locally */
  state: "held" | "queued" | "delivered" | "failed";
};

type JobRecord = {
  id: string;
  status: "queued" | "claimed" | "done" | "failed";
  created_at: string;
  payload: { text?: string; captured_at?: string } | null;
};

/** The last 20 captures this device sent. Status only — no machine output is read back. */
export const capturesQueryOptions = queryOptions({
  queryKey: ["captures"],
  refetchInterval: 15_000,
  queryFn: async (): Promise<CaptureRow[]> => {
    const { data, error } = await supabase
      .from("jobs")
      .select("id, status, created_at, payload")
      .eq("kind", "capture")
      .order("created_at", { ascending: false })
      .limit(20);
    if (error) throw error;

    return ((data ?? []) as JobRecord[]).map((job) => ({
      id: job.id,
      text: job.payload?.text ?? "",
      captured_at: job.payload?.captured_at ?? job.created_at,
      state:
        job.status === "done" ? "delivered" : job.status === "failed" ? "failed" : "queued",
    }));
  },
});

/** "just now", "4m", "3h", "2d" — no absolute times beyond a day. */
export function relativeTime(iso: string, now = Date.now()) {
  const then = new Date(iso).getTime();
  if (Number.isNaN(then)) return "—";
  const seconds = Math.max(0, Math.round((now - then) / 1000));
  if (seconds < 45) return "just now";
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.round(hours / 24);
  if (days < 7) return `${days}d ago`;
  return new Date(iso).toLocaleDateString(undefined, { month: "short", day: "2-digit" });
}

export function clockTime(iso: string) {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "--:--";
  return date.toLocaleTimeString(undefined, {
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  });
}
