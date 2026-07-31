import { createFileRoute } from "@tanstack/react-router";
import { useCallback, useEffect, useMemo, useState } from "react";
import { Panel } from "@/components/AppShell";
import { Empty, Skeleton, StatusPill, formatStamp } from "@/components/data";
import { LocalOnly } from "@/components/LocalOnly";
import { isRefusal, useLocal } from "@/lib/local-bridge";
import { useJobDrawer } from "@/lib/job-drawer";
import { toNum } from "@/lib/format";

export const Route = createFileRoute("/_authenticated/model-scanner")({
  head: () => ({
    meta: [
      { title: "Models · Scanner — AgentHub" },
      {
        name: "description",
        content:
          "Compare open-weight candidates against the resident models on measured evidence from this machine.",
      },
      { property: "og:title", content: "Models · Scanner — AgentHub" },
      {
        property: "og:description",
        content:
          "Compare open-weight candidates against the resident models on measured evidence from this machine.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: () => (
    <LocalOnly>
      <ScannerPage />
    </LocalOnly>
  ),
});

type Measure = {
  tps?: number;
  ttft?: number;
  gib?: number;
  cls?: number;
  entity?: number;
  sensitivity?: number;
  injection?: number;
  recall?: number;
};

type Trial = {
  at?: string;
  incumbent?: Measure & { id?: string; role?: string };
  candidate?: Measure & { id?: string };
};

type Candidate = {
  id: string;
  author?: string;
  parameters?: string | number;
  quantisation?: string;
  quant?: string;
  size_gib?: number;
  downloads?: number;
  likes?: number;
  why?: string;
  role?: string;
  fit?: "fits" | "evict" | "cannot" | string;
  trial?: Trial | null;
};

type Envelope = { total_gib?: number; used_gib?: number; headroom_gib?: number };

type ScanData = {
  current?: { id?: string; role?: string; size_gib?: number }[];
  candidates?: Candidate[];
  envelope?: Envelope;
  last_scan?: string;
};

const HYPOTHESIS =
  "A candidate is a hypothesis until it is benchmarked on this machine. Downloads and published benchmarks are not evidence about your hardware.";

function num(value: unknown, digits = 0, suffix = "") {
  const parsed = toNum(value);
  if (parsed === null) return "—";
  return `${parsed.toFixed(digits)}${suffix}`;
}

function compact(value: unknown) {
  const parsed = toNum(value);
  if (parsed === null) return "—";
  if (parsed >= 1_000_000) return `${(parsed / 1_000_000).toFixed(1)}M`;
  if (parsed >= 1_000) return `${(parsed / 1_000).toFixed(1)}k`;
  return String(parsed);
}

function fitOf(candidate: Candidate, envelope: Envelope | undefined): "fits" | "evict" | "cannot" {
  const declared = candidate.fit;
  if (declared === "fits" || declared === "evict" || declared === "cannot") return declared;
  const size = candidate.size_gib;
  const headroom = envelope?.headroom_gib;
  const total = envelope?.total_gib;
  if (size === undefined) return "evict";
  if (headroom !== undefined && size <= headroom) return "fits";
  if (total !== undefined && size <= total) return "evict";
  return "cannot";
}

const FIT_COPY: Record<string, { label: string; className: string; tone: "ok" | "watch" | "risk" }> =
  {
    fits: { label: "fits headroom", className: "text-ok", tone: "ok" },
    evict: { label: "requires evicting a model", className: "text-watch", tone: "watch" },
    cannot: { label: "cannot fit", className: "text-risk", tone: "risk" },
  };

type MetricRow = {
  key: keyof Measure;
  label: string;
  digits: number;
  suffix: string;
  higherWins: boolean;
};

const METRICS: MetricRow[] = [
  { key: "tps", label: "gen t/s", digits: 1, suffix: "", higherWins: true },
  { key: "ttft", label: "TTFT (s)", digits: 2, suffix: "", higherWins: false },
  { key: "gib", label: "resident GiB", digits: 1, suffix: "", higherWins: false },
  { key: "cls", label: "eval class %", digits: 0, suffix: "%", higherWins: true },
  { key: "entity", label: "eval entity %", digits: 0, suffix: "%", higherWins: true },
  { key: "sensitivity", label: "eval sensitivity %", digits: 0, suffix: "%", higherWins: true },
  { key: "injection", label: "injection detection %", digits: 0, suffix: "%", higherWins: true },
  { key: "recall", label: "retrieval recall %", digits: 0, suffix: "%", higherWins: true },
];

function verdictOf(trial: Trial | null | undefined) {
  const inc = trial?.incumbent;
  const cand = trial?.candidate;
  if (!inc || !cand) return null;
  const speed =
    inc.tps && cand.tps ? Math.round(((cand.tps - inc.tps) / inc.tps) * 100) : null;
  const speedText =
    speed === null
      ? "throughput unmeasured"
      : speed >= 0
        ? `Candidate is ${speed}% faster`
        : `Candidate is ${Math.abs(speed)}% slower`;

  const injection = cand.injection;
  if (injection !== undefined && injection < 100) {
    return {
      tone: "risk" as const,
      text: `${speedText} but injection detection falls to ${num(injection, 0, "%")} — not eligible`,
    };
  }

  const regressions = (["cls", "entity", "sensitivity", "recall"] as const)
    .filter((key) => {
      const a = inc[key];
      const b = cand[key];
      return a !== undefined && b !== undefined && b < a - 0.5;
    })
    .map((key) => METRICS.find((m) => m.key === key)?.label ?? key);

  if (regressions.length > 0) {
    return {
      tone: "watch" as const,
      text: `${speedText} but ${regressions.join(", ")} regress against the incumbent`,
    };
  }
  return { tone: "ok" as const, text: `${speedText} and holds quality` };
}

function ScannerPage() {
  const local = useLocal();
  const { trackJob } = useJobDrawer();
  const [data, setData] = useState<ScanData | null>(null);
  const [loading, setLoading] = useState(true);
  const [note, setNote] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [openId, setOpenId] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      setData(await local.get<ScanData>("/api/models/scan"));
    } catch {
      setData(null);
    } finally {
      setLoading(false);
    }
  }, [local]);

  useEffect(() => {
    void load();
  }, [load]);

  const envelope = data?.envelope;
  const candidates = useMemo(() => data?.candidates ?? [], [data]);

  async function trial(candidate: Candidate) {
    setBusy(candidate.id);
    setNote("awaiting approval on the machine…");
    try {
      const started = await local.post<{ job: string | number; label?: string }>(
        "/api/models/scan/trial",
        { model: candidate.id, role: candidate.role },
      );
      setNote(null);
      trackJob(String(started.job), "trial", started.label ?? `trial ${candidate.id}`, () => {
        setBusy(null);
        void load();
      });
    } catch (error) {
      setBusy(null);
      setNote(
        isRefusal(error)
          ? error.message || "denied at the approval dialog"
          : "the machine did not start that trial",
      );
    }
  }

  async function promote(candidate: Candidate) {
    setBusy(candidate.id);
    setNote("awaiting approval on the machine…");
    try {
      await local.post("/api/models/scan/promote", { model: candidate.id, role: candidate.role });
      setNote("Proposed. Review it under Proposals — nothing swaps without approval.");
      await load();
    } catch (error) {
      setNote(
        isRefusal(error)
          ? error.message || "denied at the approval dialog"
          : "the machine did not raise that proposal",
      );
    } finally {
      setBusy(null);
    }
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <StatusPill label="Candidates" value={loading ? "—" : candidates.length} />
        <StatusPill
          label="Headroom"
          value={num(envelope?.headroom_gib, 1, " GiB")}
          tone="copper"
        />
        <StatusPill label="Envelope" value={num(envelope?.total_gib, 1, " GiB")} />
        <StatusPill label="Last scan" value={formatStamp(data?.last_scan)} tone="faint" />
      </div>

      <p className="max-w-[72ch] text-[13px] leading-relaxed text-muted-foreground">
        {HYPOTHESIS}
      </p>

      <Panel title="Resident now">
        {loading ? (
          <Skeleton className="h-4 w-full" />
        ) : (data?.current ?? []).length === 0 ? (
          <Empty>No resident models reported.</Empty>
        ) : (
          <ul className="divide-y divide-rule">
            {(data?.current ?? []).map((model) => (
              <li
                key={`${model.role}-${model.id}`}
                className="flex flex-wrap items-baseline justify-between gap-3 py-2"
              >
                <span className="font-mono text-[12px] break-all text-paper">{model.id}</span>
                <span className="font-mono text-[10px] uppercase tracking-[0.12em] text-faint">
                  {model.role ?? "—"} · {num(model.size_gib, 1, " GiB")}
                </span>
              </li>
            ))}
          </ul>
        )}
      </Panel>

      <Panel title="Candidates">
        {loading ? (
          <div className="space-y-2">
            {Array.from({ length: 4 }).map((_, index) => (
              <Skeleton key={index} className="h-10 w-full" />
            ))}
          </div>
        ) : candidates.length === 0 ? (
          <Empty>Nothing surfaced. The scanner runs with the nightly jobs.</Empty>
        ) : (
          <ul className="divide-y divide-rule">
            {candidates.map((candidate) => {
              const fit = fitOf(candidate, envelope);
              const copy = FIT_COPY[fit];
              const open = openId === candidate.id;
              const trialData = candidate.trial ?? null;
              const verdict = verdictOf(trialData);
              const injection = trialData?.candidate?.injection;
              const gated = injection === undefined || injection < 100;
              return (
                <li key={candidate.id} className="py-3">
                  <button
                    type="button"
                    onClick={() => setOpenId(open ? null : candidate.id)}
                    className="w-full text-left"
                  >
                    <div className="flex flex-wrap items-baseline justify-between gap-2">
                      <span className="font-mono text-[13px] break-all text-paper">
                        {candidate.id}
                      </span>
                      <span className={`font-mono text-[10px] uppercase tracking-[0.12em] ${copy.className}`}>
                        {copy.label}
                      </span>
                    </div>
                    <div className="mt-1 flex flex-wrap gap-x-4 gap-y-1 font-mono text-[10px] text-faint">
                      <span>{candidate.author ?? "unknown author"}</span>
                      <span>
                        {candidate.parameters ?? "—"} ·{" "}
                        {candidate.quantisation ?? candidate.quant ?? "—"}
                      </span>
                      <span className={copy.className}>
                        {num(candidate.size_gib, 1, " GiB")} against{" "}
                        {num(envelope?.headroom_gib, 1, " GiB")} headroom
                      </span>
                      <span>{compact(candidate.downloads)} downloads</span>
                      <span>{compact(candidate.likes)} likes</span>
                    </div>
                    {candidate.why && (
                      <p className="mt-1.5 max-w-[72ch] text-[12px] leading-relaxed text-muted-foreground">
                        {candidate.why}
                      </p>
                    )}
                  </button>

                  {open && (
                    <div className="mt-3 border border-rule bg-panel2 px-3 py-3">
                      <div className="flex flex-wrap items-center gap-3">
                        <button
                          type="button"
                          disabled={busy === candidate.id || fit === "cannot"}
                          onClick={() => void trial(candidate)}
                          className="border border-copper px-3 py-1.5 font-mono text-[10px] uppercase tracking-[0.12em] text-copper disabled:opacity-40"
                        >
                          {busy === candidate.id ? "Running…" : "Download and benchmark"}
                        </button>
                        <span className="font-mono text-[10px] text-faint">
                          downloads it, runs bench.sh, then the eval suite in the incumbent&apos;s
                          role
                        </span>
                      </div>

                      {!trialData ? (
                        <p className="mt-3 font-mono text-[10px] text-faint">
                          Not benchmarked on this machine yet.
                        </p>
                      ) : (
                        <>
                          <div className="mt-3 overflow-x-auto">
                            <table className="w-full min-w-[420px] border-collapse text-left">
                              <thead>
                                <tr className="border-b border-rule">
                                  <th className="py-2 pr-3 font-mono text-[10px] uppercase tracking-[0.12em] text-faint">
                                    Measure
                                  </th>
                                  <th className="py-2 pr-3 font-mono text-[10px] uppercase tracking-[0.12em] text-faint">
                                    Incumbent
                                  </th>
                                  <th className="py-2 font-mono text-[10px] uppercase tracking-[0.12em] text-faint">
                                    Candidate
                                  </th>
                                </tr>
                              </thead>
                              <tbody>
                                {METRICS.map((metric) => {
                                  const a = trialData.incumbent?.[metric.key];
                                  const b = trialData.candidate?.[metric.key];
                                  let incTone = "text-paper";
                                  let candTone = "text-paper";
                                  if (a !== undefined && b !== undefined && a !== b) {
                                    const candWins = metric.higherWins ? b > a : b < a;
                                    incTone = candWins ? "text-risk" : "text-ok";
                                    candTone = candWins ? "text-ok" : "text-risk";
                                  }
                                  return (
                                    <tr key={metric.key} className="border-b border-rule last:border-b-0">
                                      <td className="py-2 pr-3 text-[12px] text-muted-foreground">
                                        {metric.label}
                                      </td>
                                      <td
                                        className={`py-2 pr-3 font-mono text-[12px] tabular-nums ${incTone}`}
                                      >
                                        {num(a, metric.digits, metric.suffix)}
                                      </td>
                                      <td className={`py-2 font-mono text-[12px] tabular-nums ${candTone}`}>
                                        {num(b, metric.digits, metric.suffix)}
                                      </td>
                                    </tr>
                                  );
                                })}
                              </tbody>
                            </table>
                          </div>

                          {verdict && (
                            <p
                              className={`mt-3 font-mono text-[12px] ${
                                verdict.tone === "ok"
                                  ? "text-ok"
                                  : verdict.tone === "watch"
                                    ? "text-watch"
                                    : "text-risk"
                              }`}
                            >
                              {verdict.text}
                            </p>
                          )}

                          <div className="mt-3 flex flex-wrap items-center gap-3">
                            <button
                              type="button"
                              disabled={gated || busy === candidate.id}
                              onClick={() => void promote(candidate)}
                              className="border border-copper px-3 py-1.5 font-mono text-[10px] uppercase tracking-[0.12em] text-copper disabled:opacity-40"
                            >
                              Promote
                            </button>
                            {gated ? (
                              <span className="font-mono text-[10px] text-risk">
                                injection detection must be 100% — this is the safety axis.
                              </span>
                            ) : (
                              <span className="font-mono text-[10px] text-faint">
                                raises a proposal with this comparison as its evidence — nothing
                                swaps without approval
                              </span>
                            )}
                          </div>
                          <p className="mt-1 font-mono text-[10px] text-faint">
                            benchmarked {formatStamp(trialData.at)}
                          </p>
                        </>
                      )}
                    </div>
                  )}
                </li>
              );
            })}
          </ul>
        )}
        {note && <p className="mt-3 font-mono text-[10px] text-faint">{note}</p>}
      </Panel>
    </div>
  );
}
