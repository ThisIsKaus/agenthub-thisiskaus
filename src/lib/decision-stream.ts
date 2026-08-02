/**
 * The decision stream — four arrivals of one event.
 *
 * Mail needing a decision, proposals, builds awaiting review and failing checks all mean
 * the same thing: something arrived and needs a decision. They are merged client-side from
 * four LOCAL endpoints (loopback only, nothing leaves the machine) and ranked by consequence.
 */

export type DecisionKind = "check" | "proposal" | "build" | "digest" | "task";

export type DecisionItem = {
  id: string;
  kind: DecisionKind;
  /** Geist Mono pill text. */
  pill: string;
  /** One line of what arrived. */
  what: string;
  /** One line of why it matters — the evidence, never a summary of it. */
  why: string;
  weight: number;
  at?: string;
  /** Origin payload, kept for the actions. */
  raw: Record<string, unknown>;
};

export const WEIGHTS = {
  check: 10,
  build: 6,
  digest: 5,
  task: 3,
} as const;

type DigestPayload = {
  date?: string;
  items?: { flag?: string | boolean; src?: string; cls?: string; ent?: string; sen?: string; one?: string }[];
};

type ProposalPayload = {
  proposals?: {
    id?: string;
    title?: string;
    why?: string;
    score?: number;
    status?: string;
    created?: string;
    category?: string;
    files?: string[];
  }[];
};

type CascadePayload = {
  runs?: {
    id?: string;
    intent?: string;
    tier?: string | number;
    outcome?: string;
    verify?: string | boolean;
    first_pass?: boolean;
    merged?: boolean;
    review?: string;
    created?: string;
    at?: string;
    files?: string[];
  }[];
};

type SelfTestPayload = {
  rows?: { group?: string; name?: string; state?: string; detail?: string; fix?: string }[];
  summary?: { at?: string } & Record<string, unknown>;
  at?: string;
};

const RESTRICTED = new Set(["S1c", "S2", "S3"]);

function truthyFlag(flag: unknown) {
  if (flag === true) return true;
  if (typeof flag === "string") return flag.trim() !== "" && flag.toLowerCase() !== "false";
  return false;
}

function isFail(state: string | undefined) {
  const value = (state ?? "").toLowerCase();
  return value.startsWith("fail") || value === "error";
}

function isWarn(state: string | undefined) {
  return (state ?? "").toLowerCase().startsWith("warn");
}

/** Resolved by the cascade, verified, but not yet merged by a human. */
function awaitingReview(run: NonNullable<CascadePayload["runs"]>[number]) {
  if (run.merged === true) return false;
  const outcome = (run.outcome ?? "").toLowerCase();
  if (/merged|discard|abandon/.test(outcome)) return false;
  const resolved =
    /resolve|verified|pass|complete|done|ready/.test(outcome) ||
    run.first_pass === true ||
    /pass|ok|true/i.test(String(run.verify ?? ""));
  return resolved;
}

export function buildDigestItems(digest: DigestPayload | null): DecisionItem[] {
  const items = digest?.items ?? [];
  return items
    .map((item, index) => ({ item, index }))
    .filter(({ item }) => truthyFlag(item.flag) || (item.cls ?? "").toLowerCase() === "task")
    .map(({ item, index }) => {
      const flagged = truthyFlag(item.flag);
      const restricted = RESTRICTED.has(item.sen ?? "");
      const kind: DecisionKind = flagged ? "digest" : "task";
      return {
        id: `digest:${digest?.date ?? "today"}:${index}`,
        kind,
        pill: flagged ? "flagged" : "task",
        what: restricted
          ? `${item.cls ?? "item"} · ${item.ent ?? "unnamed"} — classification only`
          : (item.one ?? item.cls ?? "item"),
        why: `${item.sen ?? "S0"} · classed ${item.cls ?? "unclassed"}${
          item.ent ? ` · ${item.ent}` : ""
        }${item.src ? ` · from ${item.src}` : ""}${flagged && typeof item.flag === "string" ? ` · flag ${item.flag}` : ""}`,
        weight: flagged ? WEIGHTS.digest : WEIGHTS.task,
        at: digest?.date,
        raw: item as Record<string, unknown>,
      };
    });
}

export function buildProposalItems(payload: ProposalPayload | null): DecisionItem[] {
  return (payload?.proposals ?? [])
    .filter((proposal) => (proposal.status ?? "open").toLowerCase() === "open")
    .map((proposal, index) => ({
      id: `proposal:${proposal.id ?? index}`,
      kind: "proposal" as const,
      pill: "proposal",
      what: proposal.title ?? "unnamed proposal",
      why:
        proposal.why ??
        `${proposal.category ?? "change"} · ${(proposal.files ?? []).length} file${
          (proposal.files ?? []).length === 1 ? "" : "s"
        } touched`,
      weight: Number(proposal.score ?? 0) || 0,
      at: proposal.created,
      raw: proposal as Record<string, unknown>,
    }));
}

export function buildCascadeItems(payload: CascadePayload | null): DecisionItem[] {
  return (payload?.runs ?? [])
    .filter(awaitingReview)
    .map((run, index) => ({
      id: `build:${run.id ?? index}`,
      kind: "build" as const,
      pill: "build",
      what: run.intent ?? "build awaiting review",
      why: `tier ${run.tier ?? "—"} · ${run.outcome ?? "resolved"} · verify ${
        run.first_pass === true || /pass|ok|true/i.test(String(run.verify ?? "")) ? "first pass" : String(run.verify ?? "—")
      }${(run.files ?? []).length ? ` · ${(run.files ?? []).length} files` : ""}`,
      weight: WEIGHTS.build,
      at: run.created ?? run.at,
      raw: run as Record<string, unknown>,
    }));
}

export function buildCheckItems(payload: SelfTestPayload | null): DecisionItem[] {
  return (payload?.rows ?? [])
    .filter((row) => isFail(row.state) || isWarn(row.state))
    .map((row, index) => ({
      id: `check:${row.group ?? "check"}:${row.name ?? index}`,
      kind: "check" as const,
      pill: isFail(row.state) ? "check failed" : "check warning",
      what: `${row.group ? `${row.group} · ` : ""}${row.name ?? "check"}`,
      why: row.detail ?? row.fix ?? `state ${row.state ?? "unknown"}`,
      weight: isFail(row.state) ? WEIGHTS.check : WEIGHTS.check / 2,
      at: payload?.summary?.at ?? payload?.at,
      raw: row as Record<string, unknown>,
    }));
}

export function rankStream(items: DecisionItem[]): DecisionItem[] {
  return [...items].sort((a, b) => b.weight - a.weight || a.what.localeCompare(b.what));
}

export function mergeStream(sources: {
  digest: DigestPayload | null;
  proposals: ProposalPayload | null;
  cascade: CascadePayload | null;
  selftest: SelfTestPayload | null;
}): DecisionItem[] {
  return rankStream([
    ...buildCheckItems(sources.selftest),
    ...buildProposalItems(sources.proposals),
    ...buildCascadeItems(sources.cascade),
    ...buildDigestItems(sources.digest),
  ]);
}

/* ---------- memory surfacing ---------- */

export type MemoryEvent = {
  ts?: string;
  kind?: string;
  model?: string;
  question?: string;
  answer?: string;
};

export type MemoryEcho = { text: string };

function shortDate(ts: string | undefined) {
  if (!ts) return "before";
  const parsed = new Date(ts);
  if (Number.isNaN(parsed.getTime())) return ts;
  return parsed.toLocaleDateString(undefined, { day: "numeric", month: "short", year: "numeric" });
}

function tokens(text: string) {
  return new Set(
    text
      .toLowerCase()
      .split(/[^a-z0-9]+/)
      .filter((word) => word.length > 3),
  );
}

function overlaps(a: string, b: string) {
  const left = tokens(a);
  const right = tokens(b);
  if (left.size === 0 || right.size === 0) return 0;
  let shared = 0;
  for (const word of left) if (right.has(word)) shared += 1;
  return shared / Math.min(left.size, right.size);
}

/** Only returns a line when a real match exists. Never a placeholder. */
export function memoryEcho(item: DecisionItem, events: MemoryEvent[]): MemoryEcho | null {
  const haystack = events.filter((event) => (event.question || event.answer || "").length > 0);
  for (const event of haystack) {
    const text = `${event.question ?? ""} ${event.answer ?? ""}`;
    if (overlaps(item.what, text) < 0.34) continue;

    if (item.kind === "proposal" && /reject/i.test(`${event.kind ?? ""} ${text}`)) {
      const reason =
        (event.answer ?? "").replace(/^.*?reject(ed)?[:\s-]*/i, "").trim() || "no reason recorded";
      return { text: `You rejected something similar on ${shortDate(event.ts)}: ${reason}` };
    }
    if ((item.kind === "digest" || item.kind === "task") && /correct/i.test(`${event.kind ?? ""} ${text}`)) {
      return { text: `You corrected this classification on ${shortDate(event.ts)}` };
    }
  }
  return null;
}
