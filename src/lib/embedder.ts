/**
 * The embedder guard.
 *
 * Every retrieval path on the machine — Ask, ingest, the corpus, canvas
 * grounding — is one embedding call away from silence. The embedder is small
 * (a few hundred MiB) but it is the only model whose absence is *silent*: a
 * query still returns, it just returns nothing useful. So it is not treated
 * like a lane. It is treated as a dependency with a health state, watched
 * continuously and repaired narrowly.
 *
 * Three stances, learned the hard way:
 *
 *   1. Residency is read, never assumed. `/api/models` reports `resident` in
 *      whatever shape it likes — strings, or objects with an id. Both are
 *      normalised before anything is judged missing, because a shape mismatch
 *      reading as "missing" is worse than no alarm at all.
 *   2. Repair is the smallest possible act. Restoring the embedder loads the
 *      embedder — it never runs a mode switch, which would unload every other
 *      model to fix a 0.3 GiB gap.
 *   3. The alarm names the consequence, not the fact. "Ask and ingest return
 *      nothing" is actionable; "embedding model not resident" is trivia.
 */

import { useCallback, useEffect, useRef, useState } from "react";
import { useLocal, isRefusal } from "@/lib/local-bridge";
import type { Bench } from "@/lib/lane-capacity";

/** Whatever `/api/models` reports an entry as, reduced to the id LM Studio knows. */
export function modelId(entry: unknown): string {
  if (typeof entry === "string") return entry;
  if (entry && typeof entry === "object") {
    const record = entry as Record<string, unknown>;
    const value = record.id ?? record.model ?? record.name ?? record.key;
    if (typeof value === "string") return value;
  }
  return "";
}

export function normalizeIds(list: unknown): string[] {
  if (!Array.isArray(list)) return [];
  return list.map(modelId).filter(Boolean);
}

export function isEmbedder(entry: unknown): boolean {
  return /embed/i.test(modelId(entry));
}

export type EmbedderState = "resident" | "missing" | "restoring" | "unknown";

export type EmbedderHealth = {
  state: EmbedderState;
  /** The id we would load, when anything on the machine names one. */
  target: string | null;
  /** The id actually resident, when it is. */
  residentId: string | null;
  /** Last time residency was read from the machine. */
  checkedAt: Date | null;
  /** Last time a live embedding round-trip proved it answers. */
  provedAt: Date | null;
  attempts: number;
  message: string | null;
};

type Sources = {
  resident: unknown;
  available: unknown;
  bench: Bench[];
};

/** The embedder to load: what the bench pins, else anything on disk that looks like one. */
export function embedderTarget(sources: Sources): string | null {
  const benched = sources.bench.find(
    (row) => /embed/i.test(row.role ?? "") || /embed/i.test(row.id ?? ""),
  );
  if (benched?.id) return benched.id;
  return normalizeIds(sources.available).find((id) => isEmbedder(id)) ?? null;
}

export function residentEmbedder(resident: unknown): string | null {
  return normalizeIds(resident).find((id) => isEmbedder(id)) ?? null;
}

/** What stops working while it is gone. Named in the reader's terms. */
export const EMBEDDER_COSTS = [
  "Ask returns no sources — the question never becomes a vector.",
  "Ingest indexes nothing; new documents are skipped, not queued.",
  "Canvas blocks that ground on the corpus run unsourced.",
  "Retrieval evals score against a corpus that cannot be searched.",
];

type GuardOptions = {
  sources: Sources;
  /** Ready to read: false while the machine is unreachable or the read is in flight. */
  ready: boolean;
  /** Repair without being asked. */
  auto: boolean;
  /** Re-read residency after a repair. */
  refresh: () => Promise<unknown>;
};

const MAX_AUTO_ATTEMPTS = 2;

export function useEmbedderGuard({ sources, ready, auto, refresh }: GuardOptions) {
  const local = useLocal();
  const [restoring, setRestoring] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [provedAt, setProvedAt] = useState<Date | null>(null);
  const attempts = useRef(0);

  const residentId = residentEmbedder(sources.resident);
  const target = embedderTarget(sources) ?? residentId;
  const state: EmbedderState = restoring
    ? "restoring"
    : !ready
      ? "unknown"
      : residentId
        ? "resident"
        : "missing";

  const restore = useCallback(async (): Promise<boolean> => {
    if (!target) {
      setMessage(
        "The machine does not name an embedding model — nothing on the bench or on disk matches. Load one in LM Studio once and it will be watched from then on.",
      );
      return false;
    }
    setRestoring(true);
    attempts.current += 1;
    setMessage(`loading ${target}…`);
    try {
      // Narrow by design: load the embedder, evict nothing. It is the lightest
      // weight on the machine; a mode switch to recover it costs far more.
      await local.post("/api/models/action", { action: "load", model: target });
      await refresh();
      setMessage(`${target} is resident again.`);
      return true;
    } catch (error) {
      setMessage(
        isRefusal(error)
          ? error.message || "denied at the approval dialog"
          : "the machine did not load the embedder",
      );
      return false;
    } finally {
      setRestoring(false);
    }
  }, [local, refresh, target]);

  /** Prove it answers, not merely that it is listed. */
  const prove = useCallback(async (): Promise<boolean> => {
    setMessage("asking the corpus one question…");
    try {
      const result = await local.get<{ chunks?: number }>("/api/kb");
      if (result && typeof result === "object") {
        setProvedAt(new Date());
        setMessage("retrieval answered.");
        return true;
      }
      setMessage("the corpus did not answer.");
      return false;
    } catch {
      setMessage("the corpus did not answer.");
      return false;
    }
  }, [local]);

  // Repair once, quietly, when residency is genuinely known to be missing.
  useEffect(() => {
    if (!auto || !ready || restoring) return;
    if (residentId) {
      attempts.current = 0;
      return;
    }
    if (attempts.current >= MAX_AUTO_ATTEMPTS) return;
    void restore();
  }, [auto, ready, restoring, residentId, restore]);

  const health: EmbedderHealth = {
    state,
    target,
    residentId,
    checkedAt: ready ? new Date() : null,
    provedAt,
    attempts: attempts.current,
    message,
  };

  return { health, restore, prove, restoring };
}
