import { createFileRoute } from "@tanstack/react-router";
import { useCallback, useEffect, useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Panel } from "@/components/AppShell";
import { Empty, FigureSkeleton, Skeleton, formatStamp } from "@/components/data";
import { MachineStatePanel } from "@/components/MachineStatePanel";
import { useHubState, useRealtimeState } from "@/hooks/use-realtime-state";
import { changesSince, snapshotOf, useLastSeen } from "@/lib/since";
import { useLocal, isRefusal } from "@/lib/local-bridge";
import { useJobDrawer } from "@/lib/job-drawer";
import { clockOf, derivePlane } from "@/lib/machine-state";

export const Route = createFileRoute("/_authenticated/overview")({
  head: () => ({
    meta: [
      { title: "Overview — AgentHub" },
      {
        name: "description",
        content:
          "Machine state, what moved since your last visit, and the standing figures for corpus, spend, factory and self-test.",
      },
      { property: "og:title", content: "Overview — AgentHub" },
      {
        property: "og:description",
        content:
          "Machine state, what moved since your last visit, and the standing figures for corpus, spend, factory and self-test.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: OverviewPage,
});

type Cell = {
  label: string;
  value: string | null;
  detail: string;
  tone?: "paper" | "ok" | "watch" | "risk" | "copper";
};

type BenchRow = { role?: string; id?: string; tps?: number; gib?: number };
type DigestItem = { flag?: string; src?: string; cls?: string; ent?: string; sen?: string; one?: string };

function FigureCell({ label, value, detail, tone = "paper" }: Cell) {
  const toneClass = {
    paper: "text-paper",
    ok: "text-ok",
    watch: "text-watch",
    risk: "text-risk",
    copper: "text-copper",
  }[tone];
  const missing = value === null;

  return (
    <div className="border border-rule bg-panel2 px-3 py-4 sm:px-4 sm:py-5">
      <div
        className={`font-serif text-[2rem] leading-none tabular-nums sm:text-[2.5rem] ${
          missing ? "text-faint" : toneClass
        }`}
      >
        {missing ? "—" : value}
      </div>
      <div className="mt-3 font-mono text-[10px] uppercase tracking-[0.16em] text-muted-foreground">
        {label}
      </div>
      <div className="mt-1 break-words font-mono text-[10px] leading-relaxed text-faint">
        {missing ? "needs the machine" : detail}
      </div>
    </div>
  );
}

function OverviewPage() {
  useRealtimeState();
  const { data: state, isPending, source, provenance } = useHubState();
  const { previous, firstVisit } = useLastSeen(state);
  const local = useLocal();

  const plane = derivePlane(local.available, state?.updated_at);
  const live = plane === "LIVE";
  const age = source === "local" ? "live" : provenance;

  const services = state?.services ?? {};
  const corpus = state?.corpus ?? {};
  const health = state?.health ?? {};
  const spend = state?.spend ?? {};
  const factory = state?.factory ?? {};
  const digest = state?.digest ?? {};
  const models = (state?.models ?? []) as (string | { id?: string; name?: string })[];
  const projects = (factory.projects ?? []) as { name?: string; ref?: string; stage?: string }[];

  const passed = Number(health.passed ?? 0);
  const warnings = Number(health.warnings ?? 0);
  const failed = Number(health.failed ?? 0);
  const healthTone = failed > 0 ? "risk" : warnings > 0 ? "watch" : "ok";
  const mtd = Number(spend.mtd ?? 0);

  // Local plane only: bench figures and digest detail never come from Supabase.
  const { data: localModels } = useQuery({
    queryKey: ["local", "models"],
    enabled: live,
    refetchInterval: 60_000,
    queryFn: () => local.get<{ bench?: BenchRow[] }>("/api/models"),
  });
  const { data: localDigest } = useQuery({
    queryKey: ["local", "digest"],
    enabled: live,
    refetchInterval: 60_000,
    queryFn: () => local.get<{ date?: string; items?: DigestItem[] }>("/api/digest"),
  });

  const bench = localModels?.bench?.find((row) => (row.role ?? "").includes("quality"));
  const machine = live ? (local.machine ?? state?.machine ?? null) : (state?.machine ?? null);

  const modelNames = models
    .map((model) => (typeof model === "string" ? model : (model.id ?? model.name ?? "")))
    .filter(Boolean);

  const cells: Cell[] = [
    {
      label: "Corpus",
      value: corpus.chunks != null ? Number(corpus.chunks).toLocaleString() : null,
      detail: `${Number(corpus.documents ?? 0).toLocaleString()} documents indexed`,
    },
    {
      label: "Resident",
      value: modelNames.length ? String(modelNames.length) : null,
      detail: modelNames.join(", "),
    },
    {
      label: "Active products",
      value: factory.wip != null ? `${factory.wip}/2` : null,
      detail: projects.map((project) => project.name ?? project.ref ?? "").filter(Boolean).join(", "),
      tone: Number(factory.wip ?? 0) > Number(factory.limit ?? 2) ? "risk" : "paper",
    },

    {
      label: "Triaged today",
      value: digest.items != null ? String(digest.items) : null,
      detail: `${Number(digest.flags ?? 0)} flagged · ${Number(digest.tasks ?? 0)} need you`,
    },
    {
      label: "Approvals",
      value: live && machine?.approvals_today != null ? String(machine.approvals_today) : null,
      detail: "all logged",
    },
  ];

  const changes = state ? changesSince(previous, snapshotOf(state)) : [];

  return (
    <div className="space-y-4">
      <MachineStatePanel plane={plane} machine={machine} updatedAt={state?.updated_at} />

      <Panel title="Since you last looked">
        {!state ? (
          <div className="space-y-2">
            <Skeleton className="h-3.5 w-3/4" />
            <Skeleton className="h-3.5 w-2/3" />
          </div>
        ) : firstVisit ? (
          <p className="font-mono text-[12px] leading-relaxed text-muted-foreground">
            First look on this device — changes will be listed here next time.
          </p>
        ) : changes.length === 0 ? (
          <p className="font-mono text-[12px] leading-relaxed text-muted-foreground">
            No change since {clockOf(previous?.at ?? state.updated_at)}.
          </p>
        ) : (
          <ul className="space-y-1.5">
            {changes.map((line) => (
              <li
                key={line}
                className="break-words font-mono text-[12px] leading-relaxed text-paper"
              >
                <span aria-hidden className="mr-2 text-copper">
                  ·
                </span>
                {line}
              </li>
            ))}
          </ul>
        )}
      </Panel>

      <section aria-label="Standing">
        <div className="mb-2 flex items-baseline justify-between gap-3">
          <h2 className="font-mono text-[10px] uppercase tracking-[0.16em] text-faint">Standing</h2>
          <span className="font-mono text-[10px] text-faint">{age}</span>
        </div>
        {isPending ? (
          <div className="grid grid-cols-2 gap-px sm:grid-cols-4">
            {Array.from({ length: 8 }).map((_, index) => (
              <FigureSkeleton key={index} />
            ))}
          </div>
        ) : (
          <div className="grid grid-cols-2 gap-px sm:grid-cols-4">
            {cells.map((cell) => (
              <FigureCell key={cell.label} {...cell} />
            ))}
          </div>
        )}
      </section>

      <NeedsYou
        live={live}
        items={localDigest?.items ?? []}
        counts={{
          items: Number(digest.items ?? 0),
          flags: Number(digest.flags ?? 0),
          tasks: Number(digest.tasks ?? 0),
        }}
        age={age}
      />

      <Panel title="Where work goes">
        <div className="space-y-2">
          <Lane
            tone="ok"
            name="Local"
            detail="35B, 27B, embeddings, all S3 work"
            cost="$0, unlimited"
          />
          <Lane
            tone="ok"
            name="Subscription"
            detail="Claude Code, Claude app, ChatGPT review"
            cost="$0 marginal"
          />
          <Lane
            tone="copper"
            name="Metered"
            detail="router aliases, scheduled and programmatic only"
            cost={`$${mtd.toFixed(2)} this month`}
          />
        </div>
      </Panel>

      <HealthStrip
        passed={passed}
        warnings={warnings}
        failed={failed}
        at={health.at}
        tone={healthTone}
        live={live}
      />

      <p className="font-mono text-[10px] text-faint">
        {Number(services.aliases ?? 0)} router aliases · {provenance} · {formatStamp(state?.updated_at)}
      </p>
    </div>
  );
}

function Lane({
  tone,
  name,
  detail,
  cost,
}: {
  tone: "ok" | "copper";
  name: string;
  detail: string;
  cost: string;
}) {
  const toneClass = tone === "ok" ? "text-ok" : "text-copper";
  return (
    <div className="flex flex-wrap items-baseline gap-x-2 gap-y-1 border-t border-rule pt-2 font-mono text-[11px] leading-relaxed first:border-t-0 first:pt-0">
      <span className={toneClass}>{name}</span>
      <span className="text-faint">·</span>
      <span className="text-muted-foreground">{detail}</span>
      <span className={`ml-auto tabular-nums ${toneClass}`}>{cost}</span>
    </div>
  );
}

function NeedsYou({
  live,
  items,
  counts,
  age,
}: {
  live: boolean;
  items: DigestItem[];
  counts: { items: number; flags: number; tasks: number };
  age: string | null;
}) {
  if (!live) {
    return (
      <Panel title="Needs you">
        <p className="font-mono text-[12px] leading-relaxed text-paper">
          {counts.items} triaged · {counts.flags} flagged · {counts.tasks} need you
        </p>
        <p className="mt-2 text-[13px] leading-relaxed text-muted-foreground">
          Item detail requires the machine. {age ? `Counts ${age}.` : ""}
        </p>
      </Panel>
    );
  }

  const flagged = items.filter((item) => item.flag);

  return (
    <Panel title="Needs you">
      {flagged.length === 0 ? (
        <Empty>Nothing flagged today.</Empty>
      ) : (
        <ul>
          {flagged.map((item, index) => (
            <DigestRow key={`${item.src ?? "item"}-${index}`} item={item} />
          ))}
        </ul>
      )}
    </Panel>
  );
}

const RESTRICTED = new Set(["S1c", "S2", "S3"]);

function DigestRow({ item }: { item: DigestItem }) {
  const local = useLocal();
  const [note, setNote] = useState<string | null>(null);
  const restricted = RESTRICTED.has(item.sen ?? "");

  const correct = useCallback(async () => {
    setNote("awaiting approval on the machine…");
    try {
      await local.post("/api/eval/correct", {
        text: item.one ?? "",
        cls: item.cls ?? "",
        entity: item.ent ?? "",
        sensitivity: item.sen ?? "",
      });
      setNote("correction recorded");
    } catch (error) {
      setNote(
        isRefusal(error)
          ? (error.message || "denied at the approval dialog")
          : "the machine did not accept that correction",
      );
    }
  }, [item, local]);

  return (
    <li className="border-t border-rule py-2.5 first:border-t-0">
      <div className="flex flex-wrap items-baseline gap-x-2 gap-y-1">
        <span className="font-mono text-[10px] uppercase tracking-[0.12em] text-copper">
          {item.sen ?? "S0"}
        </span>
        <span className="text-[13px] leading-relaxed text-paper">
          {restricted ? `${item.cls ?? "item"} — classification only` : (item.one ?? item.cls ?? "item")}
        </span>
        <button
          type="button"
          onClick={() => void correct()}
          className="ml-auto border border-rule px-2 py-0.5 font-mono text-[10px] uppercase tracking-[0.12em] text-muted-foreground hover:border-copper hover:text-copper"
        >
          Correct
        </button>
      </div>
      {note && <p className="mt-1 font-mono text-[10px] text-faint">{note}</p>}
    </li>
  );
}

function HealthStrip({
  passed,
  warnings,
  failed,
  at,
  tone,
  live,
}: {
  passed: number;
  warnings: number;
  failed: number;
  at: string | null | undefined;
  tone: "ok" | "watch" | "risk";
  live: boolean;
}) {
  const { runJob } = useJobDrawer();
  const [running, setRunning] = useState(false);

  const run = useCallback(() => {
    setRunning(true);
    void runJob("verify", "self-test", () => setRunning(false));
  }, [runJob]);

  const toneClass = tone === "risk" ? "text-risk" : tone === "watch" ? "text-watch" : "text-ok";

  return (
    <footer className="flex flex-wrap items-center gap-x-3 gap-y-2 border-t border-rule pt-3">
      <p className={`font-mono text-[11px] tabular-nums ${toneClass}`}>
        {passed} checks passed · {warnings} warnings · {failed} failed
        <span className="text-faint"> · {formatStamp(at)}</span>
      </p>
      {live && (
        <button
          type="button"
          onClick={run}
          disabled={running}
          className="border border-rule px-2 py-0.5 font-mono text-[10px] uppercase tracking-[0.12em] text-muted-foreground hover:border-copper hover:text-copper disabled:opacity-50"
        >
          {running ? "Running…" : "Run self-test"}
        </button>
      )}
      {running && (
        <span className="font-mono text-[10px] text-faint">streaming in the Jobs drawer…</span>
      )}
    </footer>
  );
}
