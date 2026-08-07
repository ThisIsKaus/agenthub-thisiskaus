/**
 * Making the quiet day legible.
 *
 * The mail genuinely repeats. These helpers group identical subjects within a day,
 * count how often a subject recurred across the last seven days, and state what the
 * day amounted to in one line. Nothing here leaves the machine.
 */

export type Lane = "flagged" | "task" | "signal" | "noise";

export const LANE_ORDER: Record<Lane, number> = { flagged: 0, task: 1, signal: 2, noise: 3 };

/** Normalised subject — digits, punctuation and casing removed so "×4" can be counted. */
export function subjectKey(text: string | undefined): string {
  return (text ?? "")
    .toLowerCase()
    .replace(/\d+/g, "")
    .replace(/[^a-z\s]+/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 90);
}

export type Row<T> = {
  item: T;
  index: number;
  lane: Lane;
  action: string | null;
  at: string | null;
};

export type Group<T> = {
  key: string;
  rows: Row<T>[];
  /** Representative row — the first arrival. */
  head: Row<T>;
  lane: Lane;
  count: number;
  undecided: Row<T>[];
  decided: Row<T>[];
};

export function groupRows<T>(rows: Row<T>[]): Group<T>[] {
  const byKey = new Map<string, Row<T>[]>();
  for (const row of rows) {
    const key = `${row.lane}:${subjectKey((row.item as { one?: string }).one)}`;
    const bucket = byKey.get(key);
    if (bucket) bucket.push(row);
    else byKey.set(key, [row]);
  }
  return [...byKey.entries()].map(([key, bucket]) => ({
    key,
    rows: bucket,
    head: bucket[0]!,
    lane: bucket[0]!.lane,
    count: bucket.length,
    undecided: bucket.filter((row) => !row.action),
    decided: bucket.filter((row) => row.action),
  }));
}

export function sortGroups<T>(groups: Group<T>[]): Group<T>[] {
  return [...groups].sort(
    (a, b) => LANE_ORDER[a.lane] - LANE_ORDER[b.lane] || a.head.index - b.head.index,
  );
}

/**
 * Recurrence across days. `history` maps a date to the subjects seen that day.
 * Only three or more of the last seven days is worth saying — below that it is noise about noise.
 */
export function recurrenceMap(history: Record<string, string[]>): Map<string, number> {
  const counts = new Map<string, number>();
  const days = Object.keys(history).slice(0, 7);
  for (const day of days) {
    const seen = new Set(history[day]!.map(subjectKey).filter(Boolean));
    for (const key of seen) counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  return counts;
}

export function recurrenceNote(days: number | undefined, window: number): string | null {
  if (!days || days < 3) return null;
  return `recurring — ${days} of the last ${window} days`;
}

/** The answer, before the list. */
export function dayHeadline(needing: number, flagged: number): string {
  if (needing === 0) return "Nothing needed you.";
  const word = needing === 1 ? "One thing needs you." : `${spell(needing)} things need you`;
  if (needing === 1) return word;
  if (flagged === 1) return `${word}, one flagged.`;
  if (flagged > 1) return `${word}, ${spell(flagged)} flagged.`;
  return `${word}.`;
}

function spell(n: number): string {
  const words = [
    "Zero",
    "One",
    "Two",
    "Three",
    "Four",
    "Five",
    "Six",
    "Seven",
    "Eight",
    "Nine",
    "Ten",
  ];
  return words[n] ?? String(n);
}

export function daySubline(arrived: number, informational: number, decided: number): string {
  return `${arrived} arrived · ${informational} informational · ${decided} already handled.`;
}
