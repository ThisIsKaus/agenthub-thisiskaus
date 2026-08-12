/**
 * The figures band — the seven numbers checked every morning, first on screen.
 *
 * One row of <Field> cells, no heading. Every cell links to the route that
 * explains it, and every cell carries provenance: "live" when the machine
 * answered, or "published · {age}" when the figure came from the published row.
 */
import { Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { Field, type FieldTone } from "@/components/Field";
import { useLocal } from "@/lib/local-bridge";
import { asPercent, num, useBoardTelemetry } from "@/hooks/use-board-telemetry";
import { normaliseService } from "@/lib/state";

type CostPayload = Record<string, unknown>;

function fmt(value: number | null | undefined, digits = 0) {
  if (value == null || !Number.isFinite(value)) return null;
  return value.toLocaleString(undefined, {
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  });
}

const PRESSURE_DOT: Record<string, string> = {
  green: "bg-ok",
  amber: "bg-watch",
  red: "bg-risk",
};

function ageLine(live: boolean, provenance: string) {
  return live ? "live" : `published · ${provenance}`;
}

export function FiguresBand() {
  const local = useLocal();
  const live = local.available;
  const { state, provenance, kb, models, evals, factory: localFactory } = useBoardTelemetry(live);

  const { data: cost } = useQuery({
    queryKey: ["local", "board", "cost"],
    enabled: live,
    refetchInterval: 120_000,
    staleTime: 60_000,
    retry: false,
    queryFn: () => local.get<CostPayload>("/api/cost"),
  });

  const stamp = ageLine(live, provenance);

  // SERVING — lms · router · console
  const services = (state?.services ?? {}) as Record<string, unknown>;
  const loose = (state ?? {}) as unknown as Record<string, unknown>;
  const serviceRow: [string, "up" | "down" | undefined][] = [
    ["lms", normaliseService(services.lms) ?? normaliseService(loose.lms)],
    ["router", normaliseService(services.router) ?? normaliseService(loose.router)],
    ["console", normaliseService(services.console) ?? normaliseService(loose.console)],
  ];
  const known = serviceRow.filter(([, value]) => value !== undefined);
  const up = known.filter(([, value]) => value === "up").length;
  const servingValue = known.length ? `${up}/${known.length}` : null;
  const servingTone: FieldTone = !known.length
    ? "paper"
    : up === known.length
      ? "ok"
      : up === 0
        ? "risk"
        : "watch";
  const servingDetail = `${serviceRow
    .map(([name, value]) => `${name} ${value ?? "—"}`)
    .join(" · ")} · ${stamp}`;

  // MEMORY — pressure and headroom, from /api/models memory.budget
  const memory = (models?.memory ?? {}) as {
    pressure?: string;
    budget?: Record<string, unknown>;
  };
  const budget = (memory.budget ?? (memory as Record<string, unknown>)) as Record<string, unknown>;
  const envelope = num(budget.envelope_gib);
  const pinnedGib = num(budget.pinned_gib);
  const elasticGib = num(budget.elastic_gib);
  const headroom =
    num(budget.headroom_gib) ??
    (envelope != null ? Math.max(0, envelope - (pinnedGib ?? 0) - (elasticGib ?? 0)) : null);
  const pressure = (memory.pressure ?? "").toLowerCase();
  const memoryTone: FieldTone =
    pressure === "red" ? "risk" : pressure === "amber" ? "watch" : pressure === "green" ? "ok" : "paper";

  // CORPUS
  const chunks = num(kb?.chunks) ?? num(state?.corpus?.chunks);
  const documents = num(kb?.documents) ?? num(state?.corpus?.documents);

  // RETRIEVAL — recall from the last eval
  const evalResults = evals?.results ?? [];
  const lastEval = evalResults.length ? evalResults[evalResults.length - 1] : null;
  const recall = asPercent(lastEval?.scores?.recall);

  // HEALTH
  const health = state?.health ?? {};
  const passed = num(health.passed);
  const warnings = num(health.warnings) ?? 0;
  const failed = num(health.failed) ?? 0;
  const healthTone: FieldTone = failed > 0 ? "risk" : warnings > 0 ? "watch" : "ok";

  // SPEND — month to date
  const costRecord = (cost ?? {}) as Record<string, unknown>;
  const mtd =
    num(costRecord.total_usd) ??
    num(costRecord.mtd) ??
    num((costRecord.spend as Record<string, unknown> | undefined)?.mtd) ??
    num(state?.spend?.mtd);
  const meteredCalls =
    num(costRecord.metered_calls) ?? num(costRecord.requests) ?? num(state?.spend?.requests);

  // WIP — factory
  const factory = { ...(state?.factory ?? {}), ...(localFactory ?? {}) };
  const wip = num(factory.wip);
  const limit = num(factory.limit) ?? 2;

  const cells: {
    to: string;
    label: string;
    value: string | null;
    unit?: string;
    detail: React.ReactNode;
    tone?: FieldTone;
  }[] = [
    {
      to: "/models",
      label: "Serving",
      value: servingValue,
      detail: servingDetail,
      tone: servingTone,
    },
    {
      to: "/models",
      label: "Memory",
      value: headroom != null ? headroom.toFixed(1) : null,
      unit: "GiB free",
      detail: (
        <span className="inline-flex items-center gap-1.5">
          <span
            aria-hidden
            className={`inline-block h-1.5 w-1.5 rounded-full ${PRESSURE_DOT[pressure] ?? "bg-muted"}`}
          />
          {pressure || "pressure —"}
          {envelope != null ? ` · of ${envelope.toFixed(0)} GiB` : ""} · {stamp}
        </span>
      ),
      tone: memoryTone,
    },
    {
      to: "/corpus",
      label: "Corpus",
      value: fmt(chunks),
      detail: `${fmt(documents) ?? "—"} documents · ${stamp}`,
    },
    {
      to: "/evals",
      label: "Retrieval",
      value: recall != null ? recall.toFixed(0) : null,
      unit: "%",
      detail: `recall${lastEval?.date ? ` · ${lastEval.date}` : ""} · ${stamp}`,
      tone: recall != null && recall < 80 ? "watch" : "paper",
    },
    {
      to: "/health",
      label: "Health",
      value: passed != null ? fmt(passed) : null,
      detail: `${warnings} warnings · ${failed} failed · ${stamp}`,
      tone: healthTone,
    },
    {
      to: "/cost",
      label: "Spend",
      value: mtd != null ? `$${mtd.toFixed(2)}` : null,
      detail: `${fmt(meteredCalls) ?? "0"} metered · month to date · ${stamp}`,
    },
    {
      to: "/canvas",
      label: "WIP",
      value: wip != null ? `${wip}/${limit}` : null,
      detail: `factory work in progress · ${stamp}`,
      tone: wip != null && wip > limit ? "risk" : "paper",
    },
  ];

  return (
    <div
      aria-label="Standing figures"
      className="grid grid-cols-2 gap-px sm:grid-cols-4 lg:grid-cols-7"
    >
      {cells.map((cell) => (
        <Link
          key={cell.label}
          to={cell.to}
          className="block focus-visible:outline focus-visible:outline-1 focus-visible:outline-copper"
        >
          <Field
            label={cell.label}
            value={cell.value}
            unit={cell.unit}
            detail={cell.detail}
            tone={cell.tone}
            missing={cell.value === null}
            className="h-full transition-colors hover:bg-panel"
          />
        </Link>
      ))}
    </div>
  );
}
