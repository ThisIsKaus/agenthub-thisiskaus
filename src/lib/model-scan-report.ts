/**
 * The machine writes the trial as a markdown report. The interface parses it
 * rather than recomputing anything — the verdict must come from the same
 * numbers the machine used, so the two cannot disagree.
 */

export type ComparisonRow = {
  label: string;
  incumbent: string;
  candidate: string;
  /** null when neither wins, or when the row is not numeric. */
  winner: "incumbent" | "candidate" | null;
  /** parsed candidate number, when the row is numeric */
  candidateValue: number | null;
};

export type TrialReport = {
  rows: ComparisonRow[];
  verdict: string | null;
  incumbentName: string | null;
  candidateName: string | null;
  /** candidate injection detection percentage, when the report carries it */
  injection: number | null;
};

/** Rows where a lower number is the better number. */
const LOWER_WINS = [/ttft/i, /time to first token/i, /resident/i, /latency/i];

const AXIS_ORDER = [
  /tokens per second|gen t\/s|throughput|tps/i,
  /ttft|time to first token/i,
  /resident/i,
  /class/i,
  /entity/i,
  /sensitivity/i,
  /injection/i,
  /recall/i,
];

function parseNumber(cell: string): number | null {
  const match = cell.replace(/,/g, "").match(/-?\d+(\.\d+)?/);
  if (!match) return null;
  const value = Number(match[0]);
  return Number.isFinite(value) ? value : null;
}

function splitRow(line: string): string[] {
  return line
    .trim()
    .replace(/^\|/, "")
    .replace(/\|$/, "")
    .split("|")
    .map((cell) => cell.trim());
}

function isSeparator(cells: string[]): boolean {
  return cells.every((cell) => /^:?-{2,}:?$/.test(cell));
}

function rank(label: string): number {
  const index = AXIS_ORDER.findIndex((pattern) => pattern.test(label));
  return index === -1 ? AXIS_ORDER.length : index;
}

export function parseTrialReport(out: string): TrialReport | null {
  if (!out) return null;
  const lines = out.split(/\r?\n/);

  const tableLines = lines.filter((line) => line.trim().startsWith("|"));
  const rows: ComparisonRow[] = [];
  let incumbentName: string | null = null;
  let candidateName: string | null = null;

  for (const line of tableLines) {
    const cells = splitRow(line);
    if (cells.length < 3 || isSeparator(cells)) continue;
    const [label, incumbent, candidate] = cells;
    if (!label) continue;

    if (/^(measure|metric|axis)$/i.test(label) || /incumbent/i.test(incumbent)) {
      incumbentName = incumbent || null;
      candidateName = candidate || null;
      continue;
    }

    const a = parseNumber(incumbent);
    const b = parseNumber(candidate);
    let winner: ComparisonRow["winner"] = null;
    if (a !== null && b !== null && a !== b) {
      const lowerWins = LOWER_WINS.some((pattern) => pattern.test(label));
      const candidateWins = lowerWins ? b < a : b > a;
      winner = candidateWins ? "candidate" : "incumbent";
    }
    rows.push({ label, incumbent, candidate, winner, candidateValue: b });
  }

  if (rows.length === 0) return null;
  rows.sort((x, y) => rank(x.label) - rank(y.label));

  const verdictLine = lines.find((line) => /verdict/i.test(line) && !line.trim().startsWith("|"));
  const verdict = verdictLine
    ? verdictLine
        .replace(/[#*_>`]/g, "")
        .replace(/^\s*verdict\s*[:\-–]?\s*/i, "")
        .trim() || null
    : null;

  const injectionRow = rows.find((row) => /injection/i.test(row.label));

  return {
    rows,
    verdict,
    incumbentName,
    candidateName,
    injection: injectionRow?.candidateValue ?? null,
  };
}
