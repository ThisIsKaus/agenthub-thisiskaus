import { createFileRoute } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { Panel } from "@/components/AppShell";
import { Empty, Figure, StatusPill, formatStamp } from "@/components/data";
import { stateQueryOptions } from "@/lib/state";
import { insertJob } from "@/lib/jobs";
import { useOnline } from "@/hooks/use-online";
import { useRealtimeState } from "@/hooks/use-realtime-state";

export const Route = createFileRoute("/_authenticated/factory")({
  head: () => ({
    meta: [
      { title: "Factory — AgentHub" },
      {
        name: "description",
        content: "Work in progress against the WIP limit, stage advances, intake and ingest jobs.",
      },
      { property: "og:title", content: "Factory — AgentHub" },
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

type Project = {
  id?: string;
  ref?: string;
  name?: string;
  entity?: string;
  stage?: string;
  status?: string;
};

const statusTone = (status?: string) => {
  const value = (status ?? "").toLowerCase();
  if (["active", "shipped", "green", "on track", "ok"].includes(value)) return "ok";
  if (["blocked", "at risk", "red", "stalled"].includes(value)) return "risk";
  if (["waiting", "review", "amber", "paused"].includes(value)) return "watch";
  return "faint" as const;
};

function FactoryPage() {
  useRealtimeState();
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
          <Figure
            label="wip"
            value={`${wip}/${limit || "—"} active`}
            detail={overLimit ? "over the limit" : "within the limit"}
            tone={overLimit ? "risk" : "paper"}
          />
          <Figure
            label="products"
            value={projects.length}
            detail={`published ${formatStamp(state?.updated_at)}`}
          />
        </div>
      </Panel>

      <Panel title="Products">
        {projects.length > 0 ? (
          <div className="-mx-4 overflow-x-auto px-4 sm:mx-0 sm:px-0">
            <table className="w-full min-w-[420px] border-collapse text-left">
              <thead>
                <tr className="border-b border-rule">
                  {["name", "entity", "stage", "status", ""].map((heading, index) => (
                    <th
                      key={heading || index}
                      scope="col"
                      className="pb-2 font-mono text-[10px] uppercase tracking-[0.14em] font-normal text-faint"
                    >
                      {heading}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {projects.map((project, index) => {
                  const ref = project.ref ?? project.name ?? project.id ?? `project-${index + 1}`;
                  return (
                    <tr key={ref} className="border-b border-rule last:border-b-0 align-baseline">
                      <td className="py-3 pr-3 text-[13px] text-paper">{ref}</td>
                      <td className="py-3 pr-3 font-mono text-[11px] text-muted-foreground">
                        {project.entity ?? "—"}
                      </td>
                      <td className="py-3 pr-3 font-mono text-[11px] text-muted-foreground">
                        {project.stage ?? "—"}
                      </td>
                      <td className="py-3 pr-3">
                        <StatusPill
                          label=""
                          value={project.status ?? "—"}
                          tone={statusTone(project.status)}
                        />
                      </td>
                      <td className="py-3 text-right">
                        <button
                          onClick={() => queue(ref, "factory_stage", { project: ref, action: "advance" })}
                          disabled={!online || pending === ref}
                          className="whitespace-nowrap border border-rule px-3 py-1.5 font-mono text-[10px] uppercase tracking-[0.14em] text-muted-foreground transition-colors hover:border-copper hover:text-copper disabled:cursor-not-allowed disabled:text-faint disabled:hover:border-rule disabled:hover:text-faint"
                        >
                          {pending === ref ? "Queueing…" : "Advance stage"}
                        </button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        ) : (
          <Empty>No products published.</Empty>
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
