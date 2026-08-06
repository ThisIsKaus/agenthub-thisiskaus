import { createFileRoute } from "@tanstack/react-router";
import { Page } from "@/components/Page";
import { useQuery } from "@tanstack/react-query";
import { Panel } from "@/components/AppShell";
import { Section } from "@/components/Section";
import { Empty, Figure, FigureSkeleton, Row, Skeleton, formatStamp } from "@/components/data";
import { stateQueryOptions } from "@/lib/state";
import { useRealtimeState } from "@/hooks/use-realtime-state";
import { count, fixed, toNum } from "@/lib/format";
import { Disclosure } from "@/components/Disclosure";

export const Route = createFileRoute("/_authenticated/cost")({
  head: () => ({
    meta: [
      { title: "Cost — AgentHub" },
      {
        name: "description",
        content: "Month-to-date metered spend, the last thirty days, and the local model roster.",
      },
      { property: "og:title", content: "Cost — AgentHub" },
      {
        property: "og:description",
        content: "Month-to-date metered spend, the last thirty days, and the local model roster.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: () => (
    <Page title="Cost" subtitle="Metered spend only — local inference and prepaid subscriptions carry the daily load at zero marginal cost." footer="Cost · published figures from the machine">
      <CostPage />
    </Page>
  ),
});

type Model = string | { id?: string; name?: string; alias?: string; tps?: number };

function modelLabel(model: Model, index: number) {
  if (typeof model === "string") return model;
  return model.alias ?? model.name ?? model.id ?? `model-${index + 1}`;
}

type Day = { date: string; amount: number };

/** Accepts either a list of {date, amount} or a {date: amount} map. */
function readDaily(spend: Record<string, unknown>): Day[] {
  const raw = (spend.daily ?? spend.days ?? spend.history) as unknown;
  let days: Day[] = [];

  if (Array.isArray(raw)) {
    days = raw
      .map((entry) => {
        if (!entry || typeof entry !== "object") return null;
        const record = entry as Record<string, unknown>;
        const date = String(record.date ?? record.day ?? "");
        const amount = Number(record.amount ?? record.mtd ?? record.spend ?? 0);
        return date ? { date, amount: Number.isFinite(amount) ? amount : 0 } : null;
      })
      .filter((day): day is Day => day !== null);
  } else if (raw && typeof raw === "object") {
    days = Object.entries(raw as Record<string, unknown>).map(([date, amount]) => ({
      date,
      amount: Number(amount) || 0,
    }));
  }

  return days.sort((a, b) => a.date.localeCompare(b.date)).slice(-30);
}

function dayLabel(date: string) {
  const parsed = new Date(date);
  if (Number.isNaN(parsed.getTime())) return date;
  return parsed.toLocaleDateString(undefined, { month: "short", day: "2-digit" });
}

function CostPage() {
  useRealtimeState();
  const { data: state, isPending } = useQuery(stateQueryOptions);

  const spend = (state?.spend ?? {}) as Record<string, unknown>;
  const models = (state?.models ?? []) as Model[];
  const requests = Number(spend.requests ?? 0);
  const mtd = Number(spend.mtd ?? 0);
  const perRequest = requests > 0 ? mtd / requests : 0;

  const daysElapsed = new Date().getDate();
  const dailyAverage = mtd / Math.max(daysElapsed, 1);

  const days = readDaily(spend);
  const peak = days.reduce((max, day) => Math.max(max, day.amount), 0);

  return (
    <div className="space-y-4">
      <Section title="This month" flush>
      <Panel title="Metered lane">
        {isPending ? (
          <div className="grid grid-cols-2 gap-px sm:grid-cols-3">
            <FigureSkeleton />
            <FigureSkeleton />
            <FigureSkeleton />
          </div>
        ) : (
          <div className="grid grid-cols-2 gap-px sm:grid-cols-3">
            <Figure
              label="spend month to date"
              value={`$${fixed(mtd, 2)}`}
              detail={`$${fixed(dailyAverage, 2)} daily average over ${daysElapsed} days`}
              tone="copper"
            />
            <Figure label="metered requests" value={count(requests)} />
            <Figure label="per request" value={`$${fixed(perRequest, 4)}`} />
          </div>
        )}
        <p className="mt-4 max-w-prose text-[13px] leading-relaxed text-muted-foreground">
          Local inference and prepaid subscriptions carry the daily load at zero marginal cost. Only
          metered API calls appear here.
        </p>
        <p className="mt-2 font-mono text-[10px] text-faint">
          Published {formatStamp(state?.updated_at)}
        </p>
      </Panel>
      </Section>

      <Section title="By model" flush>
      <Panel title="Detail">
        <Disclosure
          summary={
            <span className="font-mono text-[11px] uppercase tracking-[0.12em] text-faint">
              By model
            </span>
          }
        >
        {isPending ? (
          <div className="space-y-2">
            {Array.from({ length: 4 }).map((_, index) => (
              <Skeleton key={index} className="h-4 w-full" />
            ))}
          </div>
        ) : models.length > 0 ? (
          <div>
            {models.map((model, index) => (
              <Row
                key={modelLabel(model, index)}
                label={modelLabel(model, index)}
                value={
                  typeof model === "object" && toNum(model.tps) != null
                    ? `${fixed(model.tps, 1)} tok/s`
                    : "local"
                }
              />
            ))}
          </div>
        ) : (
          <Empty>No models published.</Empty>
        )}
        <p className="mt-4 font-mono text-[10px] leading-relaxed text-faint">
          Work on the local lane costs nothing and never leaves the machine.
        </p>
        </Disclosure>
      </Panel>
      </Section>

      <Section title="By day" flush>
      <Panel title="Detail">
        <Disclosure
          summary={
            <span className="font-mono text-[11px] uppercase tracking-[0.12em] text-faint">
              Day by day · last {days.length || 30} days
            </span>
          }
        >
            {days.length > 0 ? (
              <ul className="space-y-1.5">
                {days.map((day) => (
                  <li key={day.date} className="flex items-center gap-3">
                    <span className="w-14 shrink-0 font-mono text-[10px] tabular-nums text-faint">
                      {dayLabel(day.date)}
                    </span>
                    <span className="h-2 flex-1 bg-panel2">
                      <span
                        className="block h-2 bg-copper"
                        style={{ width: peak > 0 ? `${Math.max((day.amount / peak) * 100, day.amount > 0 ? 2 : 0)}%` : "0%" }}
                      />
                    </span>
                    <span className="w-16 shrink-0 text-right font-mono text-[10px] tabular-nums text-paper">
                      ${fixed(day.amount, 2)}
                    </span>
                  </li>
                ))}
              </ul>
            ) : (
              <Empty>The machine has not published a daily breakdown.</Empty>
            )}
        </Disclosure>
      </Panel>
      </Section>
    </div>
  );
}
