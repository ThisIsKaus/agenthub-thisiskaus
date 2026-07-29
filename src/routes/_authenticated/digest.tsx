import { createFileRoute } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { Panel } from "@/components/AppShell";
import { Figure, formatStamp } from "@/components/data";
import { stateQueryOptions } from "@/lib/state";
import { insertJob } from "@/lib/jobs";
import { useOnline } from "@/hooks/use-online";
import { useRealtimeState } from "@/hooks/use-realtime-state";

export const Route = createFileRoute("/_authenticated/digest")({
  head: () => ({
    meta: [
      { title: "Digest — AgentHub Remote" },
      {
        name: "description",
        content: "Nightly digest counts and flags, with a way to request a fresh run.",
      },
      { property: "og:title", content: "Digest — AgentHub Remote" },
      {
        property: "og:description",
        content: "Nightly digest counts and flags, with a way to request a fresh run.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: DigestPage,
});

function DigestPage() {
  useRealtimeState();
  const { data: state } = useQuery(stateQueryOptions);
  const queryClient = useQueryClient();
  const online = useOnline();
  const [status, setStatus] = useState<"idle" | "sending" | "queued" | "error">("idle");

  const digest = state?.digest ?? {};

  async function requestReport() {
    setStatus("sending");
    try {
      await insertJob("report", { scope: "digest", requested_at: new Date().toISOString() });
      setStatus("queued");
      queryClient.invalidateQueries({ queryKey: ["jobs"] });
    } catch {
      setStatus("error");
    }
  }

  return (
    <div className="space-y-4">
      <Panel title="Last digest">
        <div className="grid grid-cols-3 gap-px">
          <Figure label="items triaged" value={digest.items ?? 0} />
          <Figure
            label="flagged"
            value={digest.flags ?? 0}
            tone={(digest.flags ?? 0) > 0 ? "watch" : "paper"}
          />
          <Figure
            label="tasks outstanding"
            value={digest.tasks ?? 0}
            tone={(digest.tasks ?? 0) > 0 ? "copper" : "paper"}
          />
        </div>
        <p className="mt-4 font-mono text-[10px] text-faint">
          Digest date {digest.date ?? "—"} · published {formatStamp(state?.updated_at)}
        </p>
      </Panel>

      <Panel title="Why there is nothing to read here">
        <p className="max-w-prose text-[13px] leading-relaxed text-muted-foreground">
          Item detail stays on the local machine. Open the console at{" "}
          <span className="font-mono text-paper">127.0.0.1:4100</span> to read and correct
          classifications.
        </p>
      </Panel>

      <Panel title="Request a run">
        <p className="max-w-prose text-[13px] leading-relaxed">
          Queues a <span className="font-mono text-paper">report</span> job. The machine claims it
          within 30 seconds and runs the digest locally.
        </p>
        <button
          onClick={requestReport}
          disabled={!online || status === "sending"}
          className="mt-4 w-full border border-copper px-4 py-2.5 font-mono text-[11px] uppercase tracking-[0.14em] text-copper transition-colors hover:bg-copper hover:text-ink disabled:cursor-not-allowed disabled:border-rule disabled:text-faint disabled:hover:bg-transparent disabled:hover:text-faint sm:w-auto"
        >
          {status === "sending" ? "Queueing…" : "Queue digest run"}
        </button>
        <p className="mt-3 font-mono text-[10px] text-faint">
          {!online
            ? "Offline — reconnect to queue a run."
            : status === "queued"
              ? "Queued. The machine will pick it up on its next poll."
              : status === "error"
                ? "Could not queue that. Try again."
                : "\u00a0"}
        </p>
      </Panel>
    </div>
  );
}
