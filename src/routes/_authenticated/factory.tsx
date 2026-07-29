import { createFileRoute } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { Panel } from "@/components/AppShell";
import { Empty, Stat, formatStamp } from "@/components/data";
import { stateQueryOptions } from "@/lib/state";
import { insertJob } from "@/lib/jobs";
import { useOnline } from "@/hooks/use-online";

export const Route = createFileRoute("/_authenticated/factory")({
  head: () => ({
    meta: [
      { title: "Factory — AgentHub Remote" },
      {
        name: "description",
        content: "Work in progress against the WIP limit, stage advances, intake and ingest jobs.",
      },
      { property: "og:title", content: "Factory — AgentHub Remote" },
      {
        property: "og:description",
        content: "Work in progress against the WIP limit, stage advances, intake and ingest jobs.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: FactoryPage,
});

type Project = { id?: string; ref?: string; stage?: string; status?: string };

function FactoryPage() {
  const { data: state } = useQuery(stateQueryOptions);
  const queryClient = useQueryClient();
  const online = useOnline();
  const [pending, setPending] = useState<string | null>(null);
  const [note, setNote] = useState<string>("");

  const factory = state?.factory ?? {};
  const projects = (factory.projects ?? []) as Project[];
  const wip = factory.wip ?? 0;
  const limit = factory.limit ?? 0;
  const overLimit = limit > 0 && wip > limit;

  async function queue(key: string, kind: "factory_stage" | "intake" | "ingest", payload: Record<string, string>) {
    setPending(key);
    setNote("");
    try {
      await insertJob(kind, { ...payload, requested_at: new Date().toISOString() });
      setNote(`Queued ${kind}. The machine claims it within 30s.`);
      queryClient.invalidateQueries({ queryKey: ["jobs"] });
    } catch {
      setNote("Could not queue that. Try again.");
    } finally {
      setPending(null);
    }
  }

  return (
    <div className="space-y-4">
      <Panel title="Work in progress">
        <div className="grid grid-cols-2 gap-px">
          <Stat label="wip" value={wip} tone={overLimit ? "risk" : "paper"} />
          <Stat label="limit" value={limit || "—"} hint={overLimit ? "over limit" : "within limit"} />
        </div>
        <p className="mt-4 font-mono text-[10px] text-faint">
          Published {formatStamp(state?.updated_at)}
        </p>
      </Panel>

      <Panel title="Projects">
        {projects.length > 0 ? (
          <ul>
            {projects.map((project, index) => {
              const ref = project.ref ?? project.id ?? `project-${index + 1}`;
              return (
                <li
                  key={ref}
                  className="flex flex-wrap items-baseline justify-between gap-3 border-t border-rule py-3 first:border-t-0"
                >
                  <span className="font-mono text-[13px] text-paper">{ref}</span>
                  <span className="flex items-baseline gap-3 font-mono text-[11px]">
                    <span className="text-muted-foreground">{project.stage ?? "—"}</span>
                    <span className="text-faint">{project.status ?? "—"}</span>
                  </span>
                  <button
                    onClick={() => queue(ref, "factory_stage", { project: ref, action: "advance" })}
                    disabled={!online || pending === ref}
                    className="border border-rule px-3 py-1.5 font-mono text-[10px] uppercase tracking-[0.14em] text-muted-foreground transition-colors hover:border-copper hover:text-copper disabled:cursor-not-allowed disabled:text-faint disabled:hover:border-rule disabled:hover:text-faint"
                  >
                    {pending === ref ? "Queueing…" : "Advance stage"}
                  </button>
                </li>
              );
            })}
          </ul>
        ) : (
          <Empty>No projects published.</Empty>
        )}
      </Panel>

      <Panel title="Queue work">
        <p className="max-w-prose text-[13px] leading-relaxed">
          Instructions only — the machine decides what they touch and keeps the material local.
        </p>
        <div className="mt-4 grid gap-2 sm:grid-cols-2">
          <button
            onClick={() => queue("intake", "intake", { source: "remote" })}
            disabled={!online || pending === "intake"}
            className="border border-rule px-4 py-2.5 font-mono text-[11px] uppercase tracking-[0.14em] text-muted-foreground transition-colors hover:border-copper hover:text-copper disabled:cursor-not-allowed disabled:text-faint disabled:hover:border-rule disabled:hover:text-faint"
          >
            {pending === "intake" ? "Queueing…" : "Run intake"}
          </button>
          <button
            onClick={() => queue("ingest", "ingest", { target: "kb_main" })}
            disabled={!online || pending === "ingest"}
            className="border border-rule px-4 py-2.5 font-mono text-[11px] uppercase tracking-[0.14em] text-muted-foreground transition-colors hover:border-copper hover:text-copper disabled:cursor-not-allowed disabled:text-faint disabled:hover:border-rule disabled:hover:text-faint"
          >
            {pending === "ingest" ? "Queueing…" : "Re-index corpus"}
          </button>
        </div>
        <p className="mt-3 font-mono text-[10px] text-faint">
          {!online ? "Offline — reconnect to queue work." : note || "\u00a0"}
        </p>
      </Panel>
    </div>
  );
}
