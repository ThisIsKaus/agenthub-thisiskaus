import { useHubState } from "@/hooks/use-realtime-state";
import { formatStamp } from "@/components/data";
import { SectionHeading } from "@/components/Section";
import { FieldHeading } from "@/components/Field";



function SecHead({ title, note }: { title: string; note: string }) {
  return (
    <div className="mb-3 flex flex-wrap items-baseline gap-x-4 gap-y-1">
      <SectionHeading>{title}</SectionHeading>
      <span className="font-mono text-[10px] uppercase tracking-[0.27em] text-faint">{note}</span>
    </div>
  );
}

function Lede({ children }: { children: React.ReactNode }) {
  return <p className="mb-6 max-w-[68ch] text-sm leading-relaxed text-muted-foreground">{children}</p>;
}

function Section({
  title,
  note,
  lede,
  children,
}: {
  title: string;
  note: string;
  lede?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <section className="border-t border-rule py-8">
      <SecHead title={title} note={note} />
      {lede ? <Lede>{lede}</Lede> : null}
      {children}
    </section>
  );
}

function Dot({ tone }: { tone: "ok" | "watch" | "risk" | "faint" }) {
  const bg = { ok: "bg-ok", watch: "bg-watch", risk: "bg-risk", faint: "bg-faint" }[tone];
  return <span aria-hidden className={`h-1.5 w-1.5 shrink-0 rounded-full ${bg}`} />;
}



function Card({ title, items }: { title: string; items: [string, string][] }) {
  return (
    <div className="border border-rule bg-panel p-5">
      <div className="mb-3"><FieldHeading>{title}</FieldHeading></div>
      <ul className="m-0 list-none p-0">
        {items.map(([b, rest]) => (
          <li key={b} className="border-b border-rule py-2.5 text-sm text-muted-foreground last:border-b-0">
            <b className="font-medium text-paper">{b}</b> {rest}
          </li>
        ))}
      </ul>
    </div>
  );
}

const RISKS: { level: "high" | "med" | "low"; title: string; detail: string; action: string }[] = [
  {
    level: "high",
    title: "Digest quality is below the bar that keeps it read",
    detail:
      "Entity accuracy fell after a prompt change and classifications cluster on the first value of each enumeration. A noisy morning brief makes the whole intake layer ornamental.",
    action: "Enum reordering plus worked examples, then re-score. Revert if it does not beat 60 / 80 / 80.",
  },
  {
    level: "high",
    title: "Local serving may not survive a restart unattended",
    detail:
      "If the serving layer does not start at login, every overnight digest fills with error strings and the failure is silent until someone looks.",
    action: "Enable auto-start, reboot, then read the health strip on Overview.",
  },
  {
    level: "med",
    title: "Two of four cloud aliases have never been called",
    detail:
      "Only the fast alias was exercised. Untested configuration fails at the least convenient hour.",
    action: "Call all four aliases from Ask; correct any that fail and restart the router.",
  },
  {
    level: "med",
    title: "Only two directories have a second copy",
    detail: "Offsite backup covers the hub and the factory. Everything else on one machine has no second copy.",
    action: "Attach an external drive and enable Time Machine.",
  },
  {
    level: "med",
    title: "Subscription limits are tighter than the workload assumes",
    detail: "Factory-cadence agentic coding is exactly the pattern that finds a Pro ceiling.",
    action: "Overflow to the local coder lane, or a logged, deliberate metered session. Never a silent fallback.",
  },
  {
    level: "low",
    title: "Housekeeping",
    detail: "Deprecated CI runtime warnings and one deprecated library call in the ingest script.",
    action: "Fold into the next monthly window. None of it is load-bearing.",
  },
];

const PHASES: [string, string, string, string][] = [
  ["P0", "Tooling, repository, config", "closed", "Nine tools version-verified; private config repo with a .gitignore proven to keep data, models and secrets untrackable."],
  ["P1", "Security foundation", "closed", "Block-all firewall with stealth, remote login off, FileVault on with the key held off-machine, API keys in Keychain and injected only at runtime."],
  ["P2", "Local inference", "closed", "Models benchmarked through the production endpoint, results pinned in models.lock.yaml, resident set inside the memory envelope."],
  ["P3", "Router, memory, approvals, schedule, backup", "closed", "Nine router aliases under launchd supervision. The approval dialog was proven on both branches: deny returns exit 1, approve executes and logs."],
  ["P4", "Integrations and the injection canary", "closed", "A hostile email planted in the inbox was classified as data, flagged, escalated to an approval dialog, denied and logged."],
  ["P5", "Evaluation and failure drills", "closed", "Router killed and self-resurrected; serving layer killed and the doctor alerted; backup restored byte-identical."],
  ["P6", "Factory layer", "closed", "Project registry with a work-in-progress limit enforced in software; scaffolding writes contract, CI and release workflow into every new repository."],
  ["P7", "Pilot product to ship gate", "closed", "One line of intent to a CI-tagged release without a production credential ever touching the machine."],
  ["P8", "Operations", "in progress", "This workspace replaces the standalone report: intake, factory, spend and remediation all read from the machine rather than from a rendered file."],
];

export function AboutSystemBody() {
  const { data } = useHubState();


  const stamp = formatStamp(data?.updated_at);

  return (
    <div className="pb-4">

      <Section title="Two planes" note="which direction connections flow" lede="The distinction that governs everything else in this workspace.">
        <div className="grid gap-4 sm:grid-cols-2">
          <Card
            title="Local plane — loopback only"
            items={[
              ["127.0.0.1:4100.", "Reachable only when this browser runs on the machine. The request never leaves it."],
              ["Reads S1c / S2 / S3 material.", "Ask, Files, Knowledge, Models, Prompts, Digest detail, Memory, Evals, job output."],
              ["No fallback.", "Away from the machine these sections say so quietly and show nothing else."],
            ]}
          />
          <Card
            title="Remote plane — published state"
            items={[
              ["Outbound only.", "An agent on the machine polls every 30s, claims jobs, runs them locally, posts results back."],
              ["Nothing connects inward.", "No inbound port; the firewall blocks all incoming traffic."],
              ["Status and counts only.", "Never document text, file paths, email subjects or personal data."],
            ]}
          />
        </div>
      </Section>

      <Section
        title="Where work goes"
        note="the keystone decision"
        lede="Every request takes one of three lanes and the lane decides the cost. Two are already paid for. The third is metered, reserved for scheduled and programmatic work, and logged per request so the claim can be checked rather than believed."
      >
        <div className="border border-rule bg-panel p-2">
          <svg
            viewBox="0 0 1000 380"
            className="block h-auto w-full"
            role="img"
            aria-label="Three-lane routing diagram: front door into triage, then a local lane at zero cost, a subscription lane at zero marginal cost, and a metered router lane; a T2 approval gate defaults to deny."
          >
            <defs>
              <marker id="sys-ar" markerWidth="9" markerHeight="9" refX="8" refY="4.5" orient="auto">
                <path d="M0,0 L9,4.5 L0,9 Z" fill="#6E6E78" />
              </marker>
              <marker id="sys-arc" markerWidth="9" markerHeight="9" refX="8" refY="4.5" orient="auto">
                <path d="M0,0 L9,4.5 L0,9 Z" fill="#C8744A" />
              </marker>
            </defs>
            <rect x="20" y="150" width="150" height="80" fill="#191919" stroke="#26262A" />
            <text x="95" y="182" textAnchor="middle" fill="#ECEBE8" fontFamily="Inter,sans-serif" fontSize="15" fontWeight="500">Front door</text>
            <text x="95" y="203" textAnchor="middle" fill="#8E8E96" fontFamily="Geist Mono,monospace" fontSize="10">mail · calendar · files</text>
            <rect x="215" y="150" width="130" height="80" fill="#191919" stroke="#C8744A" />
            <text x="280" y="177" textAnchor="middle" fill="#ECEBE8" fontFamily="Inter,sans-serif" fontSize="14" fontWeight="500">Triage</text>
            <text x="280" y="197" textAnchor="middle" fill="#8E8E96" fontFamily="Geist Mono,monospace" fontSize="11">4B · always resident</text>
            <text x="280" y="214" textAnchor="middle" fill="#7FA88C" fontFamily="Geist Mono,monospace" fontSize="10">+ pattern filter</text>
            <line x1="172" y1="190" x2="211" y2="190" stroke="#6E6E78" strokeWidth="1.5" markerEnd="url(#sys-ar)" />
            <line x1="347" y1="190" x2="428" y2="88" stroke="#7FA88C" strokeWidth="1.5" markerEnd="url(#sys-ar)" />
            <rect x="432" y="52" width="300" height="72" fill="#191919" stroke="#26262A" />
            <text x="452" y="80" fill="#ECEBE8" fontFamily="Inter,sans-serif" fontSize="14" fontWeight="500">Local lane</text>
            <text x="452" y="101" fill="#8E8E96" fontFamily="Geist Mono,monospace" fontSize="11">brain · coder · embeddings · S3 finance</text>
            <text x="752" y="86" fill="#7FA88C" fontFamily="Geist Mono,monospace" fontSize="19">$0</text>
            <text x="752" y="104" fill="#6E6E78" fontFamily="Geist Mono,monospace" fontSize="10">unlimited</text>
            <line x1="347" y1="190" x2="428" y2="190" stroke="#7FA88C" strokeWidth="1.5" markerEnd="url(#sys-ar)" />
            <rect x="432" y="154" width="300" height="72" fill="#191919" stroke="#26262A" />
            <text x="452" y="182" fill="#ECEBE8" fontFamily="Inter,sans-serif" fontSize="14" fontWeight="500">Subscription lane</text>
            <text x="452" y="203" fill="#8E8E96" fontFamily="Geist Mono,monospace" fontSize="11">agentic coding · review · assistants</text>
            <text x="752" y="188" fill="#7FA88C" fontFamily="Geist Mono,monospace" fontSize="19">$0</text>
            <text x="752" y="206" fill="#6E6E78" fontFamily="Geist Mono,monospace" fontSize="10">marginal</text>
            <line x1="347" y1="190" x2="428" y2="292" stroke="#C8744A" strokeWidth="1.5" markerEnd="url(#sys-arc)" />
            <rect x="432" y="256" width="300" height="72" fill="#191919" stroke="#C8744A" />
            <text x="452" y="284" fill="#ECEBE8" fontFamily="Inter,sans-serif" fontSize="14" fontWeight="500">Metered lane</text>
            <text x="452" y="305" fill="#8E8E96" fontFamily="Geist Mono,monospace" fontSize="11">router :4000 · scheduled and programmatic only</text>
            <text x="752" y="290" fill="#C8744A" fontFamily="Geist Mono,monospace" fontSize="19">$</text>
            <text x="752" y="308" fill="#6E6E78" fontFamily="Geist Mono,monospace" fontSize="10">logged per request</text>
            <path d="M836 88 L856 88 L856 292 L836 292" fill="none" stroke="#26262A" />
            <path d="M836 190 L856 190" stroke="#26262A" />
            <line x1="856" y1="190" x2="906" y2="190" stroke="#6E6E78" strokeWidth="1.5" markerEnd="url(#sys-ar)" />
            <rect x="908" y="150" width="76" height="80" fill="#191919" stroke="#26262A" />
            <text x="946" y="180" textAnchor="middle" fill="#ECEBE8" fontFamily="Inter,sans-serif" fontSize="13" fontWeight="500">CI</text>
            <text x="946" y="199" textAnchor="middle" fill="#8E8E96" fontFamily="Geist Mono,monospace" fontSize="10">ships prod</text>
            <rect x="215" y="272" width="130" height="56" fill="none" stroke="#B5544A" strokeDasharray="3 3" />
            <text x="280" y="296" textAnchor="middle" fill="#B5544A" fontFamily="Inter,sans-serif" fontSize="12.5" fontWeight="500">T2 approval</text>
            <text x="280" y="314" textAnchor="middle" fill="#8E8E96" fontFamily="Geist Mono,monospace" fontSize="10">default deny</text>
            <line x1="280" y1="234" x2="280" y2="268" stroke="#B5544A" strokeWidth="1.5" markerEnd="url(#sys-ar)" />
          </svg>
        </div>
        <div className="mt-4 flex flex-wrap gap-5 font-mono text-[11px] text-muted-foreground">
          <span className="flex items-center gap-2">
            <i className="inline-block h-0.5 w-5 bg-ok" />
            already paid for
          </span>
          <span className="flex items-center gap-2">
            <i className="inline-block h-0.5 w-5 bg-copper" />
            metered and logged
          </span>
          <span className="flex items-center gap-2">
            <i className="inline-block h-0.5 w-5 bg-risk" />
            requires a human decision
          </span>
        </div>
      </Section>

      <Section title="Posture" note="the rules that don't bend">
        <div className="grid gap-4 sm:grid-cols-2">
          <Card
            title="Security"
            items={[
              ["Zero inbound.", "Block-all firewall with stealth; every service binds to loopback."],
              ["External content is data.", "Mail, invites and documents can never issue instructions; anything demanding action raises an approval dialog quoting its source."],
              ["Employer boundary.", "No work account on any agent surface, tenant-pinned tokens, router denylist."],
              ["Finance is local by impossibility.", "S3 work calls an endpoint that holds no cloud models and no keys."],
            ]}
          />
          <Card
            title="Delivery"
            items={[
              ["Two products active, maximum.", "Parking is honest and reversible; dilution is neither."],
              ["CI is the only ship path.", "Production credentials live in Actions; local production writes go through an approval wrapper."],
              ["A second model family reviews.", "Self-review by the building model is the cheapest and weakest check available."],
              ["Gates leave receipts.", "Skipping one is visible in the digest, by design."],
            ]}
          />
        </div>
      </Section>

      <Section title="Build evidence" note="each phase, its gate, its receipt">
        <div className="border border-rule bg-panel">
          {PHASES.map(([id, title, state, ev]) => (
            <details key={id} className="border-b border-rule last:border-b-0">
              <summary className="grid cursor-pointer grid-cols-[36px_1fr_auto] items-baseline gap-3 px-4 py-3 text-sm text-paper marker:content-['']">
                <span className="font-mono text-[11px] text-copper">{id}</span>
                <span>{title}</span>
                <span
                  className={`font-mono text-[10px] uppercase tracking-[0.27em] ${
                    state === "closed" ? "text-ok" : "text-watch"
                  }`}
                >
                  {state}
                </span>
              </summary>
              <p className="px-4 pb-4 pl-[64px] max-w-[68ch] text-[13px] leading-relaxed text-muted-foreground">{ev}</p>
            </details>
          ))}
        </div>
      </Section>

      <Section title="Open risks" note="ranked by what it would cost">
        <div>
          {RISKS.map((r) => (
            <div key={r.title} className="grid grid-cols-[3px_1fr] gap-4 border-b border-rule py-4 last:border-b-0">
              <div
                className={`w-[3px] rounded-sm ${
                  r.level === "high" ? "bg-risk" : r.level === "med" ? "bg-watch" : "bg-faint"
                }`}
              />
              <div>
                <div className="text-[15px] text-paper">{r.title}</div>
                <p className="mt-1 max-w-[72ch] text-sm leading-relaxed text-muted-foreground">{r.detail}</p>
                <p className="mt-1.5 font-mono text-[11px] text-copper">{r.action}</p>
              </div>
            </div>
          ))}
        </div>
      </Section>

      <Section
        title="Operating rhythm"
        note="what it costs to run"
        lede="Every action below now has a tab in this workspace. Nothing requires the terminal or a standalone page."
      >
        <div className="overflow-x-auto">
          <table className="w-full border-collapse text-sm">
            <thead>
              <tr>
                {["Cadence", "Action", "Time"].map((h, i) => (
                  <th
                    key={h}
                    className={`border-b border-rule pb-3 pr-3 font-mono text-[10px] uppercase tracking-[0.27em] text-faint ${
                      i === 2 ? "text-right" : "text-left"
                    }`}
                  >
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {[
                ["Daily", "Overview for the health strip, Digest for the brief. Act on flags and tasks.", "2 min"],
                ["In-flight", "Ask for the canon, Capture for anything caught away from the machine.", "—"],
                ["Weekly", "Factory registry honesty check, approvals review, no lingering red builds.", "10 min"],
                ["Monthly", "Cost review, then Evals — fold real misclassifications in before re-scoring.", "45 min"],
                ["Quarterly", "Health self-test, restore drill, both injection canaries.", "1 hr"],
              ].map(([c, a, t]) => (
                <tr key={c}>
                  <td className="border-b border-rule py-3 pr-3 text-paper">{c}</td>
                  <td className="border-b border-rule py-3 pr-3 text-muted-foreground">{a}</td>
                  <td className="border-b border-rule py-3 text-right font-mono tabular-nums text-muted-foreground">
                    {t}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Section>

      <footer className="border-t border-rule py-8 font-mono text-[11px] leading-loose text-faint">
        <div>
          <b className="font-normal text-muted-foreground">Hardware</b> MacBook Pro M5 Max · 18-core CPU / 32-core GPU
          / 36 GB unified / 460 GB/s
        </div>
        <div>
          <b className="font-normal text-muted-foreground">Provenance</b> every live figure above is read from the
          machine's published state at {stamp}; the narrative is version-controlled, the data never is
        </div>
      </footer>
    </div>
  );
}
