import type { MachineBlock } from "@/lib/local-bridge";

export type Plane = "LIVE" | "AWAKE_REMOTE" | "DOZING" | "OFFLINE";

const FIVE_MINUTES = 5 * 60 * 1000;
const TWO_HOURS = 2 * 60 * 60 * 1000;

/**
 * Four states, not two. The MacBook is the compute engine; when it sleeps,
 * local reasoning stops and published figures start ageing.
 */
export function derivePlane(
  bridgeAvailable: boolean,
  updatedAt: string | null | undefined,
  now = Date.now(),
): Plane {
  if (bridgeAvailable) return "LIVE";
  if (!updatedAt) return "OFFLINE";
  const age = now - new Date(updatedAt).getTime();
  if (Number.isNaN(age)) return "OFFLINE";
  if (age < FIVE_MINUTES) return "AWAKE_REMOTE";
  if (age < TWO_HOURS) return "DOZING";
  return "OFFLINE";
}

export function clockOf(value: string | null | undefined) {
  if (!value) return "—";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "—";
  return date.toLocaleTimeString(undefined, {
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  });
}

/** "as of 14:22" — never present stale figures as current. */
export function asOf(plane: Plane, updatedAt: string | null | undefined) {
  return plane === "LIVE" ? null : `as of ${clockOf(updatedAt)}`;
}

export function batteryLine(machine: MachineBlock | null) {
  const power = machine?.power;
  if (!power) return null;
  const pct = power.percent ?? power.pct;
  if (power.on_ac) return pct != null ? `on power · ${pct}%` : "on power";
  return pct != null ? `battery ${pct}%` : "on battery";
}

export function holdersOf(machine: MachineBlock | null): string | null {
  const holders = machine?.sleep?.holders;
  if (!holders) return null;
  const list = Array.isArray(holders) ? holders : [holders];
  const clean = list.filter(Boolean).map(String);
  return clean.length ? clean.join(", ") : null;
}
