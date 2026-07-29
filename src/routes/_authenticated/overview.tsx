import { createFileRoute } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { Panel } from "@/components/AppShell";
import { Empty, Row, Stat, formatStamp } from "@/components/data";
import { stateQueryOptions } from "@/lib/state";
import { recentJobsQueryOptions } from "@/lib/jobs";

export const Route = createFileRoute("/_authenticated/overview")({
  head: () => ({
    meta: [
      { title: "Overview — AgentHub Remote" },
      {
        name: "description",
        content: "Service status, corpus counts, self-test health and the live job queue.",
      },
      { property: "og:title", content: "Overview — AgentHub Remote" },
      {
        property: "og:description",
        content: "Service status, corpus counts, self-test health and the live job queue.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: OverviewPage,
});

const statusTone = {
  queued: "text-faint",
  claimed: "text-watch",
  done: "text-ok",
  failed: "text-risk",
} as const;

function OverviewPage() {
  const { data: state } = useQuery(stateQueryOptions);
  const { data: jobs } = useQuery(recentJobsQueryOptions);

  const services = state?.services ?? {};
  const corpus = state?.corpus ?? {};
  const health = state?.health ?? {};
  const models = state?.models ?? [];

  const healthTone =
    (health.failed ?? 0) > 0 ? "risk" : (health.warnings ?? 0) > 0 ? "watch" : "ok";

  return (
    <div className="space-y-4">
      <Panel title="Machine">
        <div className="grid grid-cols-2 gap-px sm:grid-cols-4">
          <Stat
            label="lms"
            value={String(services.lms ?? "—")}
            tone={services.lms === "up" ? "ok" : services.lms ? "risk" : "faint"}
          />
          <Stat
            label="router"
            value={String(services.router ?? "—")}
            tone={services.router === "up" ? "ok" : services.router ? "risk" : "faint"}
          />
          <Stat label="aliases" value={services.aliases ?? 0} hint="routing lanes" />
          <Stat label="models" value={models.length} hint="loaded locally" />
        </div>
        <p className="mt-4 font-mono text-[10px] leading-relaxed text-faint">
          Published {formatStamp(state?.updated_at)} · the machine polls outbound every 30s
        </p>
      </Panel>

      <div className="grid gap-4 sm:grid-cols-2">
        <Panel title="Corpus">
          <div className="grid grid-cols-2 gap-px">
            <Stat label="chunks" value={(corpus.chunks ?? 0).toLocaleString()} />
            <Stat label="documents" value={(corpus.documents ?? 0).toLocaleString()} />
          </div>
          <p className="mt-4 font-mono text-[10px] leading-relaxed text-faint">
            Counts only. Titles and contents stay on the machine.
          </p>
        </Panel>

        <Panel title="Self-test">
          <div className="grid grid-cols-3 gap-px">
            <Stat label="passed" value={health.passed ?? 0} tone="ok" />
            <Stat label="warnings" value={health.warnings ?? 0} tone="watch" />
            <Stat label="failed" value={health.failed ?? 0} tone={healthTone} />
          </div>
          <p className="mt-4 font-mono text-[10px] text-faint">Last run {formatStamp(health.at)}</p>
        </Panel>
      </div>

      <Panel title="Queue">
        {jobs && jobs.length > 0 ? (
          <div>
            {jobs.map((job) => (
              <Row
                key={job.id}
                label={job.kind}
                value={
                  <span className="inline-flex items-baseline gap-3">
                    <span className="text-faint">{formatStamp(job.created_at)}</span>
                    <span className={statusTone[job.status] ?? "text-faint"}>{job.status}</span>
                  </span>
                }
              />
            ))}
          </div>
        ) : (
          <Empty>No jobs queued.</Empty>
        )}
      </Panel>
    </div>
  );
}
