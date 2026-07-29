import { createFileRoute } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { Panel } from "@/components/AppShell";
import { Empty, Figure, FigureSkeleton, Row, Skeleton, StatusPill, formatStamp } from "@/components/data";
import { stateQueryOptions } from "@/lib/state";
import { recentJobsQueryOptions } from "@/lib/jobs";
import { useRealtimeState } from "@/hooks/use-realtime-state";
import { changesSince, snapshotOf, useLastSeen } from "@/lib/since";

export const Route = createFileRoute("/_authenticated/overview")({
  head: () => ({
    meta: [
      { title: "Overview — AgentHub Remote" },
      {
        name: "description",
        content: "What moved since your last visit, plus service status, corpus counts and self-test health.",
      },
      { property: "og:title", content: "Overview — AgentHub Remote" },
      {
        property: "og:description",
        content: "What moved since your last visit, plus service status, corpus counts and self-test health.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: OverviewPage,
});

const statusTone: Record<string, string> = {
  queued: "text-faint",
  claimed: "text-watch",
  done: "text-ok",
  failed: "text-risk",
};

const TWO_HOURS = 2 * 60 * 60 * 1000;

function OverviewPage() {
  useRealtimeState();
  const { data: state, isPending } = useQuery(stateQueryOptions);
  const { data: jobs } = useQuery(recentJobsQueryOptions);
  const { previous, firstVisit } = useLastSeen(state);

  const services = state?.services ?? {};
  const corpus = state?.corpus ?? {};
  const health = state?.health ?? {};
  const spend = state?.spend ?? {};
  const factory = state?.factory ?? {};
  const models = state?.models ?? [];
  const projects = (factory.projects ?? []) as unknown[];

  const wip = Number(factory.wip ?? 0);
  const limit = Number(factory.limit ?? 0);
  const overLimit = limit > 0 && wip > limit;
  const failed = Number(health.failed ?? 0);
  const warnings = Number(health.warnings ?? 0);
  const healthTone = failed > 0 ? "risk" : warnings > 0 ? "watch" : "ok";
  const mtd = Number(spend.mtd ?? 0);

  const updatedAt = state?.updated_at ? new Date(state.updated_at) : null;
  const stale = updatedAt ? Date.now() - updatedAt.getTime() > TWO_HOURS : false;

  const changes = state ? changesSince(previous, snapshotOf(state)) : [];

  return (
    <div className="space-y-4">
      {stale && (
        <div className="border border-copper bg-panel px-4 py-3">
          <p className="font-mono text-[11px] leading-relaxed text-copper">
            The machine has not reported since {formatStamp(state?.updated_at)} — it may be asleep
            or offline. Figures below are last-known, not current.
          </p>
        </div>
      )}

      <Panel title="Since you last looked">
        {!state ? (
          <Empty>Waiting for the machine's first report.</Empty>
        ) : firstVisit ? (
          <p className="max-w-prose text-[13px] leading-relaxed text-muted-foreground">
            First look on this device — nothing to compare against yet. Changes will be listed here
            next time.
          </p>
        ) : changes.length === 0 ? (
          <p className="max-w-prose text-[13px] leading-relaxed text-muted-foreground">
            Nothing has moved since your last visit.
          </p>
        ) : (
          <ul className="space-y-2">
            {changes.map((line) => (
              <li key={line} className="flex gap-3 text-[13px] leading-relaxed">
                <span aria-hidden className="font-mono text-copper">
                  ·
                </span>
                <span>{line}</span>
              </li>
            ))}
          </ul>
        )}
      </Panel>

      <div className="flex flex-wrap gap-2">
        <StatusPill
          label="serving"
          value={String(services.lms ?? "—")}
          tone={services.lms === "up" ? "ok" : services.lms ? "risk" : "faint"}
        />
        <StatusPill
          label="router"
          value={String(services.router ?? "—")}
          tone={services.router === "up" ? "ok" : services.router ? "risk" : "faint"}
        />
        <StatusPill label="corpus" value={(Number(corpus.chunks ?? 0)).toLocaleString()} />
        <StatusPill label="spend mtd" value={`$${mtd.toFixed(2)}`} tone={mtd > 0 ? "copper" : "paper"} />
        <StatusPill
          label="wip"
          value={`${wip}/${limit || "—"}`}
          tone={overLimit ? "risk" : "paper"}
        />
      </div>

      {isPending ? (
        <div className="grid grid-cols-2 gap-px sm:grid-cols-3">
          {Array.from({ length: 6 }).map((_, index) => (
            <FigureSkeleton key={index} />
          ))}
        </div>
      ) : (
      <div className="grid grid-cols-2 gap-px sm:grid-cols-3">
        <Figure
          label="corpus chunks"
          value={Number(corpus.chunks ?? 0).toLocaleString()}
          detail={`${Number(corpus.documents ?? 0).toLocaleString()} documents`}
        />
        <Figure
          label="resident models"
          value={models.length}
          detail={`${Number(services.aliases ?? 0)} router aliases`}
        />
        <Figure
          label="active products"
          value={projects.length}
          detail={overLimit ? `${wip} in flight — over limit` : `${wip} in flight`}
          tone={overLimit ? "risk" : "paper"}
        />
        <Figure
          label="spend month to date"
          value={`$${mtd.toFixed(2)}`}
          detail={`${Number(spend.requests ?? 0).toLocaleString()} metered requests`}
          tone={mtd > 0 ? "copper" : "paper"}
        />
        <Figure
          label="self-test"
          value={`${Number(health.passed ?? 0)}/${warnings}/${failed}`}
          detail={`passed · warnings · failed — ${formatStamp(health.at)}`}
          tone={healthTone}
        />
        <Figure
          label="last report"
          value={updatedAt ? formatStamp(state?.updated_at).split(",")[1]?.trim() || "—" : "—"}
          detail={stale ? "stale — over two hours old" : formatStamp(state?.updated_at)}
          tone={stale ? "copper" : "paper"}
        />
      </div>
      )}

      <Panel title="Queue">
        {!jobs ? (
          <div className="space-y-2">
            {Array.from({ length: 4 }).map((_, index) => (
              <Skeleton key={index} className="h-4 w-full" />
            ))}
          </div>
        ) : jobs.length > 0 ? (
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

      <p
        className={`font-mono text-[11px] tabular-nums ${
          healthTone === "risk" ? "text-risk" : healthTone === "watch" ? "text-watch" : "text-ok"
        }`}
      >
        {Number(health.passed ?? 0)} checks passed · {warnings} warnings · {failed} failed
        <span className="text-faint"> · {formatStamp(health.at)}</span>
      </p>
    </div>
  );
}
