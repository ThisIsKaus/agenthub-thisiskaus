import { createFileRoute } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { Panel } from "@/components/AppShell";
import { Empty, Row, Stat, formatStamp } from "@/components/data";
import { stateQueryOptions } from "@/lib/state";

export const Route = createFileRoute("/_authenticated/cost")({
  head: () => ({
    meta: [
      { title: "Cost — AgentHub Remote" },
      {
        name: "description",
        content: "Month-to-date metered spend, request volume and the local model roster.",
      },
      { property: "og:title", content: "Cost — AgentHub Remote" },
      {
        property: "og:description",
        content: "Month-to-date metered spend, request volume and the local model roster.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: CostPage,
});

type Model = string | { id?: string; name?: string; alias?: string; tps?: number };

function modelLabel(model: Model, index: number) {
  if (typeof model === "string") return model;
  return model.alias ?? model.name ?? model.id ?? `model-${index + 1}`;
}

function CostPage() {
  const { data: state } = useQuery(stateQueryOptions);

  const spend = state?.spend ?? {};
  const models = (state?.models ?? []) as Model[];
  const requests = spend.requests ?? 0;
  const mtd = Number(spend.mtd ?? 0);
  const perRequest = requests > 0 ? mtd / requests : 0;

  return (
    <div className="space-y-4">
      <Panel title="Metered lane">
        <div className="grid grid-cols-2 gap-px sm:grid-cols-3">
          <Stat label="mtd" value={`$${mtd.toFixed(2)}`} tone="copper" />
          <Stat label="requests" value={requests.toLocaleString()} />
          <Stat label="per req" value={`$${perRequest.toFixed(4)}`} tone="faint" />
        </div>
        <p className="mt-4 font-mono text-[10px] text-faint">
          Published {formatStamp(state?.updated_at)}
        </p>
      </Panel>

      <Panel title="Local models">
        {models.length > 0 ? (
          <div>
            {models.map((model, index) => (
              <Row
                key={modelLabel(model, index)}
                label={modelLabel(model, index)}
                value={
                  typeof model === "object" && model.tps
                    ? `${model.tps.toFixed(1)} tok/s`
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
      </Panel>
    </div>
  );
}
