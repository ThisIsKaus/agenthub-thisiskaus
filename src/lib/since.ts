import { useEffect, useRef, useState } from "react";
import type { StateRow } from "@/lib/state";

const KEY = "agenthub.lastSeen.v1";

export type Snapshot = {
  at: string;
  spendMtd: number;
  requests: number;
  chunks: number;
  documents: number;
  digestItems: number;
  digestFlags: number;
  digestTasks: number;
  digestDate: string | null;
  wip: number;
  stages: Record<string, string>;
  passed: number;
  warnings: number;
  failed: number;
};

type FactoryProject = { id?: string; ref?: string; name?: string; stage?: string };

export function snapshotOf(state: StateRow): Snapshot {
  const projects = (state.factory?.projects ?? []) as FactoryProject[];
  const stages: Record<string, string> = {};
  projects.forEach((project, index) => {
    const ref = project.ref ?? project.name ?? project.id ?? `project-${index + 1}`;
    stages[ref] = project.stage ?? "—";
  });

  return {
    at: state.updated_at,
    spendMtd: Number(state.spend?.mtd ?? 0),
    requests: Number(state.spend?.requests ?? 0),
    chunks: Number(state.corpus?.chunks ?? 0),
    documents: Number(state.corpus?.documents ?? 0),
    digestItems: Number(state.digest?.items ?? 0),
    digestFlags: Number(state.digest?.flags ?? 0),
    digestTasks: Number(state.digest?.tasks ?? 0),
    digestDate: state.digest?.date ?? null,
    wip: Number(state.factory?.wip ?? 0),
    stages,
    passed: Number(state.health?.passed ?? 0),
    warnings: Number(state.health?.warnings ?? 0),
    failed: Number(state.health?.failed ?? 0),
  };
}

function delta(now: number, before: number) {
  const diff = now - before;
  if (diff === 0) return null;
  return diff > 0 ? `+${diff.toLocaleString()}` : diff.toLocaleString();
}

export function changesSince(previous: Snapshot | null, current: Snapshot): string[] {
  if (!previous) return [];
  const lines: string[] = [];

  const spendDiff = current.spendMtd - previous.spendMtd;
  if (Math.abs(spendDiff) >= 0.01) {
    lines.push(
      `Metered spend ${spendDiff > 0 ? "up" : "down"} $${Math.abs(spendDiff).toFixed(2)} — now $${current.spendMtd.toFixed(2)} MTD`,
    );
  }
  const requestDiff = delta(current.requests, previous.requests);
  if (requestDiff) lines.push(`Metered requests ${requestDiff} — now ${current.requests.toLocaleString()}`);

  const chunkDiff = delta(current.chunks, previous.chunks);
  if (chunkDiff) lines.push(`Corpus chunks ${chunkDiff} — now ${current.chunks.toLocaleString()}`);
  const docDiff = delta(current.documents, previous.documents);
  if (docDiff) lines.push(`Documents indexed ${docDiff} — now ${current.documents.toLocaleString()}`);

  if (current.digestDate !== previous.digestDate) {
    lines.push(`New digest run dated ${current.digestDate ?? "—"}`);
  }
  const itemDiff = delta(current.digestItems, previous.digestItems);
  if (itemDiff) lines.push(`Digest items ${itemDiff} — now ${current.digestItems}`);
  const flagDiff = delta(current.digestFlags, previous.digestFlags);
  if (flagDiff) lines.push(`Flagged ${flagDiff} — now ${current.digestFlags}`);
  const taskDiff = delta(current.digestTasks, previous.digestTasks);
  if (taskDiff) lines.push(`Outstanding tasks ${taskDiff} — now ${current.digestTasks}`);

  const wipDiff = delta(current.wip, previous.wip);
  if (wipDiff) lines.push(`Factory WIP ${wipDiff} — now ${current.wip} active`);

  for (const [ref, stage] of Object.entries(current.stages)) {
    const before = previous.stages[ref];
    if (before === undefined) lines.push(`New project ${ref} at ${stage}`);
    else if (before !== stage) lines.push(`${ref} moved ${before} → ${stage}`);
  }

  if (
    current.passed !== previous.passed ||
    current.warnings !== previous.warnings ||
    current.failed !== previous.failed
  ) {
    lines.push(
      `Self-test now ${current.passed} passed · ${current.warnings} warnings · ${current.failed} failed`,
    );
  }

  return lines;
}

function read(): Snapshot | null {
  try {
    const raw = localStorage.getItem(KEY);
    return raw ? (JSON.parse(raw) as Snapshot) : null;
  } catch {
    return null;
  }
}

/**
 * Holds the snapshot recorded on the previous visit for the life of this visit,
 * then writes the latest one back so the next visit can diff against it.
 */
export function useLastSeen(state: StateRow | null | undefined) {
  const [previous, setPrevious] = useState<Snapshot | null>(null);
  const [firstVisit, setFirstVisit] = useState(false);
  const captured = useRef(false);

  useEffect(() => {
    if (!state || captured.current) return;
    captured.current = true;
    const stored = read();
    setPrevious(stored);
    setFirstVisit(stored === null);
  }, [state]);

  useEffect(() => {
    if (!state || !captured.current) return;
    try {
      localStorage.setItem(KEY, JSON.stringify(snapshotOf(state)));
    } catch {
      /* storage unavailable — the diff simply resets next visit */
    }
  }, [state]);

  return { previous, firstVisit };
}
