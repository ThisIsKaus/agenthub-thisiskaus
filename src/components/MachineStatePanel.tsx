import { SectionHeading } from "@/components/Section";
import type { MachineBlock } from "@/lib/local-bridge";
import { batteryLine, clockOf, holdersOf, type Plane } from "@/lib/machine-state";

const BORDER: Record<Plane, string> = {
  LIVE: "border-l-copper",
  AWAKE_REMOTE: "border-l-ok",
  DOZING: "border-l-watch",
  OFFLINE: "border-l-risk",
};

const DOT: Record<Plane, string> = {
  LIVE: "bg-copper",
  AWAKE_REMOTE: "bg-ok",
  DOZING: "bg-watch",
  OFFLINE: "bg-risk",
};

export function MachineStatePanel({
  plane,
  machine,
  updatedAt,
}: {
  plane: Plane;
  machine: MachineBlock | null;
  updatedAt: string | null | undefined;
}) {
  const sleepSince = machine?.sleep?.asleep_since ?? machine?.sleep?.since ?? updatedAt;
  const nextWake = machine?.schedule?.repeat?.at;
  const onAc = machine?.power?.on_ac ?? true;
  const pct = machine?.power?.percent ?? machine?.power?.pct;
  const holders = holdersOf(machine);
  const rawUptime = machine?.uptime as number | string | { uptime_hours?: number } | undefined;
  const uptimeHours =
    rawUptime != null && typeof rawUptime === "object" ? rawUptime.uptime_hours : rawUptime;

  let headline: string;
  let detail: string;
  let amber: string | null = null;

  if (plane === "LIVE") {
    headline = `Live · ${machine?.posture ?? "active"}`;
    const parts = [
      batteryLine(machine) ?? "power unknown",
      uptimeHours != null ? `up ${uptimeHours}h` : null,
      nextWake ? `wake ${nextWake}` : null,
    ].filter(Boolean) as string[];
    detail = parts.join(" · ");
    if (machine?.sleep?.sleep_prevented) {
      detail += holders ? ` · held awake by ${holders}` : " · held awake";
    }
  } else if (plane === "AWAKE_REMOTE") {
    headline = "Awake · you are remote";
    detail = "Reasoning and files need the machine's browser. Status is live.";
  } else if (plane === "DOZING") {
    headline = `Asleep since ${clockOf(sleepSince)} · next wake ${nextWake ?? "unscheduled"}`;
    detail = "Published status is last-known, not current.";
    if (!onAc) {
      amber = `On battery at ${pct ?? "—"}% — scheduled work will skip until it is on power.`;
    }
  } else {
    headline = `No contact since ${clockOf(updatedAt)} — closed, off power, or a fault`;
    detail = "Captures are held on this device and will send when it reconnects.";
  }

  return (
    <section
      className={`border border-l-2 border-rule bg-panel px-4 py-4 ${BORDER[plane]}`}
      aria-label="Machine state"
    >
      <div className="flex items-center gap-2.5">
        <span aria-hidden className={`h-2 w-2 shrink-0 rounded-full ${DOT[plane]}`} />
        <SectionHeading>{headline}</SectionHeading>
      </div>
      <p className="mt-2 break-words font-mono text-[11px] leading-relaxed text-faint">{detail}</p>
      {amber && (
        <p className="mt-2 break-words font-mono text-[11px] leading-relaxed text-watch">{amber}</p>
      )}
    </section>
  );
}
