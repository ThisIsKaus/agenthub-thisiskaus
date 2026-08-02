import { createFileRoute } from "@tanstack/react-router";
import { Page } from "@/components/Page";
import { useQuery } from "@tanstack/react-query";
import { Panel } from "@/components/AppShell";
import { FigureSkeleton, Skeleton, formatStamp } from "@/components/data";
import { MachineStatePanel } from "@/components/MachineStatePanel";
import { DecisionStream } from "@/components/DecisionStream";
import { Omnibox } from "@/components/Omnibox";

import { AboutSystemBody } from "@/components/AboutSystemBody";
import { BoardDiagram, type Zone } from "@/components/BoardDiagram";
import { useRealtimeState } from "@/hooks/use-realtime-state";
import { asPercent, modelName, num, useBoardTelemetry } from "@/hooks/use-board-telemetry";
import { changesSince, snapshotOf, useLastSeen } from "@/lib/since";
import { useLocal } from "@/lib/local-bridge";
import { clockOf, derivePlane } from "@/lib/machine-state";

export const Route = createFileRoute("/_authenticated/overview")({
  head: () => ({
    meta: [
      { title: "Overview — AgentHub" },
      {
        name: "description",
        content:
          "The whole board in one view: machine state, the routing map with live telemetry, and the standing figures for corpus, spend, factory, evals and self-test.",
      },
      { property: "og:title", content: "Overview — AgentHub" },
      {
        property: "og:description",
        content:
          "The whole board in one view: machine state, the routing map with live telemetry, and the standing figures for corpus, spend, factory, evals and self-test.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: () => (
    <Page title="Overview" subtitle="Where the machine stands right now, and what changed since you last looked." footer="Overview · local readings when the machine answers, published state otherwise">
      <OverviewPage />
    </Page>
  ),
});

type DigestItem = { flag?: string; src?: string; cls?: string; ent?: string; sen?: string; one?: string };

type Fact = {
  label: string;
  value: string | null;
  unit?: string;
  detail: string;
  tone?: "paper" | "ok" | "watch" | "risk" | "copper";
};

/** Views wrapped in LocalOnly — material that never leaves the machine. */
const LOCAL_ONLY_VIEWS = [
  "ask",
  "digest",
  "files",
  "knowledge",
  "memory",
  "models",
  "model-scanner",
  "prompts",
  "skills",
  "evals",
  "proposals",
  "build",
];
const VIEW_COUNT = 16;
const SECTION_COUNT = 7;
const MEMORY_ENVELOPE_GIB = 26;

function fmt(value: number | null | undefined, digits = 0) {
  if (value == null || !Number.isFinite(value)) return null;
  return value.toLocaleString(undefined, {
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  });
}

function FactCell({ label, value, unit, detail, tone = "paper" }: Fact) {
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
        className={`font-serif text-[1.85rem] leading-none tabular-nums sm:text-[2.1rem] ${
          missing ? "text-faint" : toneClass
        }`}
      >
        {missing ? "—" : value}
        {!missing && unit ? (
          <span className="ml-1 font-mono text-[13px] text-muted-foreground">{unit}</span>
        ) : null}
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

function SectionHead({ title, note }: { title: string; note: string }) {
  return (
    <div className="mb-2 flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
      <h2 className="font-serif text-[25px] leading-[1.15] text-paper">{title}</h2>
      <span className="font-mono text-[10px] uppercase tracking-[0.12em] text-faint">{note}</span>
    </div>
  );
}

function OverviewPage() {
  useRealtimeState();
  const local = useLocal();

  const { state, provenance, isPending, kb, models, evals, cascade, capabilities, roots, factory: localFactory, bestBench, residentGiB, latestScores } =
    useBoardTelemetry(local.available);

  const { previous, firstVisit } = useLastSeen(state);
  const plane = derivePlane(local.available, state?.updated_at);
  const live = plane === "LIVE";
  const age = live ? "live" : provenance;

  const services = state?.services ?? {};
  const corpus = state?.corpus ?? {};
  const health = state?.health ?? {};
  const spend = state?.spend ?? {};
  const factory = { ...(state?.factory ?? {}), ...(localFactory ?? {}) };
  const digest = state?.digest ?? {};
  const stateModels = (state?.models ?? []) as unknown[];
  const projects = (factory.projects ?? []) as { name?: string; ref?: string; stage?: string }[];

  const passed = Number(health.passed ?? 0);
  const warnings = Number(health.warnings ?? 0);
  const failed = Number(health.failed ?? 0);
  const healthTone = failed > 0 ? "risk" : warnings > 0 ? "watch" : "ok";
  const mtd = Number(spend.mtd ?? 0);
  const requests = Number(spend.requests ?? 0);

  const { data: localDigest } = useQuery({
    queryKey: ["local", "digest"],
    enabled: live,
    refetchInterval: 60_000,
    retry: false,
    queryFn: () => local.get<{ date?: string; items?: DigestItem[] }>("/api/digest"),
  });

  const machine = live ? (local.machine ?? state?.machine ?? null) : (state?.machine ?? null);

  const residentList = (models?.resident ?? []) as unknown[];
  const resident = residentList.length ? residentList : stateModels;
  const residentNames = resident.map((entry, index) => modelName(entry, index));
  const aliasList = (models?.aliases ?? []) as unknown[];
  const aliasNames = aliasList.map((entry, index) => modelName(entry, index));
  const localAliases = aliasNames.filter((name) => /local|brain|coder|embed|triage|fast-local/i.test(name));
  const cloudAliases = aliasNames.length ? aliasNames.length - localAliases.length : null;
  const aliasCount = aliasNames.length || num(services.aliases);

  const chunks = num(kb?.chunks) ?? num(corpus.chunks);
  const documents = num(kb?.documents) ?? num(corpus.documents);
  const sources = kb?.sources?.length ?? null;
  const endpoints = capabilities?.features?.length ?? null;

  const recall = asPercent(latestScores?.recall);
  const classAcc = asPercent(latestScores?.class ?? latestScores?.cls);
  const injection = asPercent(latestScores?.injection);
  const verifyPass = asPercent(cascade?.verify_pass_rate);
  const localShare = asPercent(cascade?.resolved_locally);

  const zones: Zone[] = [
    {
      id: "browser",
      title: "Browser",
      lines: [
        { text: "agenthub.thisiskaus.com" },
        { text: "React · TanStack · Lovable", tone: "faint" },
        { text: `${VIEW_COUNT} views · ${SECTION_COUNT} sections` },
        { text: `${LOCAL_ONLY_VIEWS.length} wrapped in LocalOnly` },
        { text: live ? "served over HTTPS · on the machine" : "served over HTTPS", tone: live ? "ok" : "muted" },
        { text: live ? "loopback bridge up" : "loopback bridge unavailable", tone: live ? "ok" : "faint" },
      ],
    },
    {
      id: "api",
      title: "Local API",
      accent: "copper",
      lines: [
        { text: "127.0.0.1:4100 · FastAPI" },
        { text: endpoints != null ? `${endpoints} endpoints` : "endpoints —" },
        { text: capabilities?.version ? `version ${capabilities.version}` : "version —", tone: "faint" },
        { text: "CORS: one named origin" },
        { text: "path allowlist · vault 403" },
        { text: "T2 dialog for external change", tone: "risk" },
      ],
    },
    {
      id: "router",
      title: "Router",
      lines: [
        { text: "127.0.0.1:4000 · LiteLLM" },
        {
          text: localAliases.length ? `${localAliases.length} local aliases · $0` : "local aliases —",
          tone: "ok",
        },
        {
          text: cloudAliases != null ? `${cloudAliases} cloud aliases · metered` : "cloud aliases —",
          tone: "copper",
        },
        { text: `$${mtd.toFixed(4)} month to date` },
        { text: `${fmt(requests) ?? "—"} metered requests`, tone: "faint" },
        { text: `serving ${services.router ?? "—"} · lms ${services.lms ?? "—"}`, tone: "faint" },
      ],
    },
    {
      id: "serving",
      title: "LM Studio · MLX",
      accent: "ok",
      lines: [
        { text: "127.0.0.1:1234" },
        ...residentNames.slice(0, 3).map((name) => ({ text: name })),
        {
          text:
            residentGiB != null
              ? `${residentGiB.toFixed(2)} of ~${MEMORY_ENVELOPE_GIB} GiB envelope`
              : `${residentNames.length || "—"} resident`,
          tone: "ok" as const,
        },
      ],
    },
    {
      id: "corpus",
      title: "Knowledge base",
      lines: [
        { text: "LanceDB · on disk" },
        {
          text:
            chunks != null
              ? `${fmt(chunks)} chunks · ${fmt(documents) ?? "—"} docs`
              : "chunks — · docs —",
        },
        { text: sources != null ? `${fmt(sources)} indexed sources` : "sources —" },
        { text: "S1c · S2 · S3 never leave", tone: "risk" },
        { text: "counts only on the remote plane", tone: "faint" },
      ],
    },
    {
      id: "source",
      title: "Source",
      lines: [
        { text: "OneDrive · macOS sync" },
        { text: roots != null ? `${roots} allowlisted roots` : "roots —" },
        { text: documents != null ? `${fmt(documents)} documents read` : "documents —" },
        { text: "blocked paths keep a reason", tone: "risk" },
        { text: "sync is inbound to disk only", tone: "faint" },
      ],
    },
    {
      id: "frontier",
      title: "Frontier",
      lines: [
        { text: "Claude Code" },
        { text: "Codex CLI" },
        { text: "outbound only", tone: "faint" },
        {
          text: localShare != null ? `${localShare.toFixed(0)}% stays local` : "escalation only",
          tone: "faint",
        },
      ],
    },
    {
      id: "backup",
      title: "Backblaze",
      lines: [
        { text: "restic · encrypted" },
        { text: "every 4 hours" },
        { text: "outbound only", tone: "faint" },
        { text: failed > 0 ? "restore check failing" : "restore verified", tone: "faint" },
      ],
    },
  ];

  const facts: Fact[] = [
    {
      label: "Checks passing",
      value: health.passed != null ? fmt(passed) : null,
      detail: `${warnings} warnings · ${failed} failures · ${formatStamp(health.at)}`,
      tone: healthTone,
    },
    {
      label: "Local quality brain",
      value: num(bestBench?.tps) != null ? (num(bestBench?.tps) as number).toFixed(1) : null,
      unit: "t/s",
      detail: bestBench
        ? `${bestBench.role ?? bestBench.id ?? "brain"}${bestBench.ttft != null ? ` · ${bestBench.ttft}s to first token` : ""}`
        : "",
      tone: "ok",
    },
    {
      label: "Chunks indexed",
      value: fmt(chunks),
      detail: `${fmt(documents) ?? "—"} documents · ${age}`,
    },
    {
      label: "Retrieval recall",
      value: recall != null ? recall.toFixed(0) : null,
      unit: "%",
      detail: classAcc != null ? `class accuracy ${classAcc.toFixed(0)}%` : "from the golden set",
      tone: recall != null && recall < 80 ? "watch" : "paper",
    },
    {
      label: "Injection detection",
      value: injection != null ? injection.toFixed(0) : null,
      unit: "%",
      detail: "the safety axis · must be 100%",
      tone: injection != null && injection < 100 ? "risk" : "ok",
    },
    {
      label: "Metered, month to date",
      value: `$${mtd.toFixed(4)}`,
      detail: `${fmt(requests) ?? "0"} metered requests · ${age}`,
      tone: "copper",
    },
    {
      label: "Resident memory",
      value: residentGiB != null ? residentGiB.toFixed(2) : null,
      unit: "GiB",
      detail: `${residentNames.length || "—"} models in a ~${MEMORY_ENVELOPE_GIB} GiB envelope`,
      tone:
        residentGiB != null && residentGiB > MEMORY_ENVELOPE_GIB * 0.95 ? "watch" : "paper",
    },
    {
      label: "Verify pass rate",
      value: verifyPass != null ? verifyPass.toFixed(0) : null,
      unit: "%",
      detail: cascade?.runs != null ? `${fmt(cascade.runs)} cascade runs` : "build cascade",
      tone: verifyPass != null && verifyPass < 80 ? "watch" : "ok",
    },
    {
      label: "Active products",
      value: factory.wip != null ? `${factory.wip}/${factory.limit ?? 2}` : null,
      detail: projects.map((p) => p.name ?? p.ref ?? "").filter(Boolean).join(", ") || "work in progress limit",
      tone: Number(factory.wip ?? 0) > Number(factory.limit ?? 2) ? "risk" : "paper",
    },
    {
      label: "Triaged today",
      value: digest.items != null ? String(digest.items) : null,
      detail: `${Number(digest.flags ?? 0)} flagged · ${Number(digest.tasks ?? 0)} need you`,
    },
    {
      label: "Approvals today",
      value: machine?.approvals_today != null ? String(machine.approvals_today) : null,
      detail: "each one logged",
    },
    {
      label: "Inbound ports",
      value: "0",
      detail: "every arrow points outward",
      tone: "ok",
    },
  ];

  const changes = state ? changesSince(previous, snapshotOf(state)) : [];

  return (
    <div className="space-y-6">
      <Omnibox />

      <MachineStatePanel plane={plane} machine={machine} updatedAt={state?.updated_at} />

      <DecisionStream />




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
              <li key={line} className="break-words font-mono text-[12px] leading-relaxed text-paper">
                <span aria-hidden className="mr-2 text-copper">
                  ·
                </span>
                {line}
              </li>
            ))}
          </ul>
        )}
      </Panel>


      <section aria-label="The board in numbers" className="border-t border-rule pt-6">
        <SectionHead title="The board in numbers" note="health · corpus · evals · cost · factory" />
        {isPending ? (
          <div className="grid grid-cols-2 gap-px sm:grid-cols-3 lg:grid-cols-4">
            {Array.from({ length: 8 }).map((_, index) => (
              <FigureSkeleton key={index} />
            ))}
          </div>
        ) : (
          <div className="grid grid-cols-2 gap-px sm:grid-cols-3 lg:grid-cols-4">
            {facts.map((fact) => (
              <FactCell key={fact.label} {...fact} />
            ))}
          </div>
        )}
      </section>

      <details className="border border-rule bg-panel">
        <summary className="cursor-pointer list-none px-5 py-4 font-mono text-[11px] uppercase tracking-[0.14em] text-faint hover:text-copper">
          The whole board · {age ?? "routing map"}
        </summary>
        <div className="border-t border-rule px-5 py-6">
          <BoardDiagram
            zones={zones}
            caption={
              live
                ? `Read from the machine at ${clockOf(state?.updated_at ?? new Date().toISOString())}`
                : `Local figures need the machine · ${provenance}`
            }
          />
          <div className="mt-4 space-y-2">
            <Lane
              tone="ok"
              name="Local"
              detail={residentNames.slice(0, 3).join(", ") || "brain, coder, embeddings, all S3 work"}
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
              detail={`${cloudAliases ?? "—"} router aliases, scheduled and programmatic only`}
              cost={`$${mtd.toFixed(2)} this month`}
            />
          </div>
        </div>
      </details>


      <details className="border border-rule bg-panel">
        <summary className="cursor-pointer list-none px-5 py-4 font-mono text-[11px] uppercase tracking-[0.14em] text-faint hover:text-copper">
          About this system
        </summary>
        <div className="border-t border-rule px-5 pt-6">
          <AboutSystemBody />
        </div>
      </details>

      <p className="font-mono text-[10px] leading-relaxed text-faint">
        {aliasCount ?? "—"} router aliases · {evals?.set_size != null ? `${evals.set_size} golden eval items · ` : ""}
        {provenance} · {formatStamp(state?.updated_at)}
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

