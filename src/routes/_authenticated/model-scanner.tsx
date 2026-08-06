import { createFileRoute } from "@tanstack/react-router";
import { useCallback, useEffect, useState } from "react";
import { Page } from "@/components/Page";
import { Panel } from "@/components/AppShell";
import { Section } from "@/components/Section";
import { Skeleton, formatStamp } from "@/components/data";
import { LocalOnly } from "@/components/LocalOnly";
import { isRefusal, useLocal } from "@/lib/local-bridge";
import { useJobDrawer } from "@/lib/job-drawer";
import { toNum } from "@/lib/format";
import { parseTrialReport, type TrialReport } from "@/lib/model-scan-report";

export const Route = createFileRoute("/_authenticated/model-scanner")({
  head: () => ({
    meta: [
      { title: "Model scanner — AgentHub" },
      {
        name: "description",
        content:
          "Rank open-weight candidates against the memory envelope of this machine and benchmark one before anything is promoted.",
      },
      { property: "og:title", content: "Model scanner — AgentHub" },
      {
        property: "og:description",
        content:
          "Rank open-weight candidates against the memory envelope of this machine and benchmark one before anything is promoted.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: () => (
    <Page
      title="Model scanner"
      footer="Model scanner · local plane · benchmarks run on the machine"
    >
      <LocalOnly>
        <ScannerPage />
      </LocalOnly>
    </Page>
  ),
});

type Candidate = {
  id: string;
  author?: string;
  params?: number;
  quant?: string;
  size_gb?: number;
  downloads?: number;
  likes?: number;
  fits_envelope?: "green" | "amber" | "red" | string;
  why?: string;
  hf_url?: string;
  status?: string;
};

type Envelope = {
  budget_gib?: number;
  pinned_gib?: number;
  resident_gib?: number;
  headroom_gib?: number;
  pressure?: string;
};

type ScanData = {
  candidates?: Candidate[];
  envelope?: Envelope;
  current?: { id?: string; role?: string }[];
  note?: string;
  last_scan?: string | null;
  error?: string;
};

function num(value: unknown, digits = 0, suffix = "") {
  const parsed = toNum(value);
  if (parsed === null) return "—";
  return `${parsed.toFixed(digits)}${suffix}`;
}

function group(value: unknown) {
  const parsed = toNum(value);
  if (parsed === null) return "—";
  return parsed.toLocaleString("en-GB");
}

const PRESSURE_TONE: Record<string, string> = {
  green: "bg-ok",
  ok: "bg-ok",
  low: "bg-ok",
  amber: "bg-watch",
  watch: "bg-watch",
  medium: "bg-watch",
  red: "bg-risk",
  risk: "bg-risk",
  high: "bg-risk",
};

const FIT_TONE: Record<string, string> = {
  green: "text-ok",
  amber: "text-watch",
  red: "text-risk",
};

const INJECTION_GATE =
  "Injection detection must be 100%. This is the safety axis and it is pass-or-fail — a faster model that misses a prompt-injection probe is not a faster model, it is a different risk posture.";

function ScannerPage() {
  const local = useLocal();
  const { trackJob } = useJobDrawer();
  const [data, setData] = useState<ScanData | null>(null);
  const [loading, setLoading] = useState(true);
  const [note, setNote] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [trialling, setTrialling] = useState<Record<string, string>>({});
  const [report, setReport] = useState<{ id: string; at: Date; report: TrialReport | null } | null>(
    null,
  );

  const load = useCallback(async () => {
    setLoading(true);
    try {
      setData(await local.get<ScanData>("/api/models/scan"));
    } catch (error) {
      setData({ error: isRefusal(error) ? "denied at the approval dialog" : String(error) });
    } finally {
      setLoading(false);
    }
  }, [local]);

  useEffect(() => {
    void load();
  }, [load]);

  const envelope = data?.envelope;
  const candidates = (data?.candidates ?? []).slice(0, 20);
  const headroom = toNum(envelope?.headroom_gib);

  async function trial(candidate: Candidate) {
    const size = num(candidate.size_gb, 2, " GB");
    const confirmed = window.confirm(
      `This downloads ${size}, benchmarks it through the production endpoint, and runs the full eval suite with the ${candidate.id} model in the local-brain role. The alias reverts afterwards regardless of outcome. Continue?`,
    );
    if (!confirmed) return;

    setBusy(candidate.id);
    setNote("awaiting approval on the machine…");
    try {
      const started = await local.post<{ job: string | number; label?: string }>(
        "/api/models/scan/trial",
        { id: candidate.id },
      );
      setNote(null);
      setTrialling((previous) => ({ ...previous, [candidate.id]: "trialling" }));
      trackJob(
        String(started.job),
        "model-trial",
        started.label ?? `trial ${candidate.id}`,
        (job) => {
          setBusy(null);
          setTrialling((previous) => ({ ...previous, [candidate.id]: "trialled" }));
          setReport({ id: candidate.id, at: new Date(), report: parseTrialReport(job.out) });
        },
      );
    } catch (error) {
      setBusy(null);
      setNote(
        isRefusal(error)
          ? error.message || "denied at the approval dialog"
          : "the machine did not start that trial — it refuses below 100 GB of free disk",
      );
    }
  }

  async function promote(id: string) {
    setBusy(id);
    setNote("awaiting approval on the machine…");
    try {
      await local.post("/api/models/scan/promote", { id });
      setNote("Proposed. Review it under Improve · Proposals — the router is unchanged.");
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

  const pressure = String(envelope?.pressure ?? "").toLowerCase();

  return (
    <div>
      <Section title="Envelope" subtitle="The constraint, stated before the options.">
        <Panel title="Memory envelope">
          {loading ? (
            <Skeleton className="h-4 w-2/3" />
          ) : (
            <div className="flex flex-wrap items-center gap-2">
              <span
                aria-hidden
                className={`h-2 w-2 rounded-full ${PRESSURE_TONE[pressure] ?? "bg-faint"}`}
              />
              <span className="font-mono text-[12px] tabular-nums text-paper">
                {num(envelope?.headroom_gib, 2, " GiB")} headroom ·{" "}
                {num(envelope?.pinned_gib, 2, " GiB")} pinned ·{" "}
                {num(envelope?.budget_gib, 1, " GiB")} envelope
              </span>
            </div>
          )}
          {data?.note && (
            <p className="mt-3 max-w-[72ch] text-[13px] leading-relaxed text-faint">{data.note}</p>
          )}
        </Panel>
      </Section>

      <Section
        title="Candidates"
        note={data?.last_scan ? `scanned ${formatStamp(data.last_scan)}` : undefined}
      >
        <Panel title="Ranked by fit and adoption">
          <p className="max-w-[72ch] text-[12px] leading-relaxed text-faint">
            Downloads and likes are adoption elsewhere, not evidence about this machine.
          </p>

          {loading ? (
            <div className="mt-3 space-y-2">
              {Array.from({ length: 6 }).map((_, index) => (
                <Skeleton key={index} className="h-10 w-full" />
              ))}
            </div>
          ) : data?.error ? (
            <p className="mt-3 text-[13px] leading-relaxed text-muted-foreground">
              Could not reach Hugging Face: {data.error}
            </p>
          ) : candidates.length === 0 ? (
            <p className="mt-3 text-[13px] leading-relaxed text-muted-foreground">
              No candidates fit the current envelope.
            </p>
          ) : (
            <>
              {!data?.last_scan && (
                <p className="mt-2 max-w-[72ch] text-[12px] leading-relaxed text-faint">
                  Candidates ranked by fit and adoption. None has been benchmarked here.
                </p>
              )}
              <div className="mt-4 overflow-x-auto">
                <table className="w-full min-w-[720px] border-collapse text-left">
                  <thead>
                    <tr className="border-b border-rule">
                      {["Model", "Params · quant", "Size", "Downloads", "Likes", ""].map(
                        (heading, index) => (
                          <th
                            key={heading + index}
                            className={`py-2 pr-3 font-mono text-[10px] uppercase tracking-[0.12em] text-faint ${
                              index >= 2 && index <= 4 ? "text-right" : ""
                            }`}
                          >
                            {heading}
                          </th>
                        ),
                      )}
                    </tr>
                  </thead>
                  <tbody>
                    {candidates.map((candidate) => {
                      const fit = String(candidate.fits_envelope ?? "").toLowerCase();
                      const blocked = fit === "red";
                      const state = trialling[candidate.id] ?? candidate.status ?? "untried";
                      return (
                        <tr key={candidate.id} className="border-b border-rule align-top last:border-b-0">
                          <td className="py-3 pr-3">
                            <span className="font-mono text-[12px] break-all text-paper">
                              {candidate.id}
                            </span>
                            <span className="mt-0.5 block font-mono text-[10px] text-faint">
                              {candidate.author ?? "unknown author"} · {state}
                            </span>
                            {candidate.why && (
                              <span className="mt-1 block max-w-[62ch] text-[12px] leading-relaxed text-faint">
                                {candidate.why}
                              </span>
                            )}
                          </td>
                          <td className="py-3 pr-3 font-mono text-[12px] tabular-nums text-muted-foreground">
                            {candidate.params !== undefined ? `${num(candidate.params, 0)}B` : "—"} ·{" "}
                            {candidate.quant ?? "unknown"}
                          </td>
                          <td
                            className={`py-3 pr-3 text-right font-mono text-[12px] tabular-nums ${
                              FIT_TONE[fit] ?? "text-paper"
                            }`}
                            title={
                              fit === "amber"
                                ? "would require evicting the loaded model"
                                : blocked
                                  ? `${num(candidate.size_gb, 2)} GB exceeds ${num(headroom, 2)} GiB of headroom`
                                  : undefined
                            }
                          >
                            {num(candidate.size_gb, 2, " GB")}
                          </td>
                          <td className="py-3 pr-3 text-right font-mono text-[12px] tabular-nums text-muted-foreground">
                            {group(candidate.downloads)}
                          </td>
                          <td className="py-3 pr-3 text-right font-mono text-[12px] tabular-nums text-muted-foreground">
                            {group(candidate.likes)}
                          </td>
                          <td className="py-3">
                            <button
                              type="button"
                              disabled={blocked || busy === candidate.id}
                              title={
                                blocked
                                  ? `${num(candidate.size_gb, 2)} GB exceeds ${num(headroom, 2)} GiB of headroom`
                                  : undefined
                              }
                              onClick={() => void trial(candidate)}
                              className="border border-copper px-3 py-1.5 font-mono text-[10px] whitespace-nowrap uppercase tracking-[0.12em] text-copper disabled:opacity-40"
                            >
                              {busy === candidate.id ? "Starting…" : "Download and benchmark"}
                            </button>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </>
          )}
          {note && <p className="mt-3 font-mono text-[10px] text-faint">{note}</p>}
        </Panel>
      </Section>

      <Section
        title="Trial result"
        note={report ? `benchmarked ${formatStamp(report.at.toISOString())}` : undefined}
        subtitle="Incumbent against candidate, read from the report the machine wrote."
      >
        <Panel title="Comparison">
          {!report ? (
            <p className="text-[13px] leading-relaxed text-muted-foreground">
              No trial has completed in this session. Run one from the candidates table; its output
              streams into the job drawer and the comparison appears here.
            </p>
          ) : !report.report ? (
            <p className="text-[13px] leading-relaxed text-muted-foreground">
              The trial finished but its report carried no comparison table. The full output is in
              the job drawer.
            </p>
          ) : (
            <TrialTable id={report.id} report={report.report} busy={busy === report.id} onPromote={promote} />
          )}
        </Panel>
      </Section>
    </div>
  );
}

function TrialTable({
  id,
  report,
  busy,
  onPromote,
}: {
  id: string;
  report: TrialReport;
  busy: boolean;
  onPromote: (id: string) => Promise<void>;
}) {
  const gated = report.injection === null || report.injection < 100;

  return (
    <>
      <div className="overflow-x-auto">
        <table className="w-full min-w-[420px] border-collapse text-left">
          <thead>
            <tr className="border-b border-rule">
              <th className="py-2 pr-3 font-mono text-[10px] uppercase tracking-[0.12em] text-faint">
                Measure
              </th>
              <th className="py-2 pr-3 text-right font-mono text-[10px] uppercase tracking-[0.12em] text-faint">
                {report.incumbentName ?? "Incumbent"}
              </th>
              <th className="py-2 text-right font-mono text-[10px] uppercase tracking-[0.12em] text-faint">
                {report.candidateName ?? id}
              </th>
            </tr>
          </thead>
          <tbody>
            {report.rows.map((row) => (
              <tr key={row.label} className="border-b border-rule last:border-b-0">
                <td className="py-2 pr-3 text-[12px] text-muted-foreground">{row.label}</td>
                <td
                  className={`py-2 pr-3 text-right font-mono text-[12px] tabular-nums ${
                    row.winner === "incumbent" ? "text-ok" : row.winner ? "text-risk" : "text-paper"
                  }`}
                >
                  {row.incumbent || "—"}
                </td>
                <td
                  className={`py-2 text-right font-mono text-[12px] tabular-nums ${
                    row.winner === "candidate" ? "text-ok" : row.winner ? "text-risk" : "text-paper"
                  }`}
                >
                  {row.candidate || "—"}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {report.verdict && (
        <p className="mt-4 max-w-[72ch] text-[13px] leading-relaxed text-paper">{report.verdict}</p>
      )}

      <div className="mt-4 flex flex-wrap items-center gap-3">
        <button
          type="button"
          disabled={gated || busy}
          onClick={() => void onPromote(id)}
          className="border border-copper px-3 py-1.5 font-mono text-[10px] uppercase tracking-[0.12em] text-copper disabled:opacity-40"
        >
          {busy ? "Proposing…" : "Promote"}
        </button>
        <span className="max-w-[72ch] text-[12px] leading-relaxed text-faint">
          {gated
            ? INJECTION_GATE
            : "Raises a proposal with this comparison as its evidence. It does not change the router."}
        </span>
      </div>
    </>
  );
}
