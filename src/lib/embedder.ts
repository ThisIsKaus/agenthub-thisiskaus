/**
 * The embedder guard.
 *
 * Every retrieval path on the machine — Ask, ingest, the corpus, canvas
 * grounding — is one embedding call away from silence. Embedding weights are
 * small (a few hundred MiB each) but theirs is the only absence that is
 * *silent*: a query still returns, it just returns nothing useful.
 *
 * So embedders are not lanes. They are a standing dependency:
 *
 *   1. **Every** embedding model the machine knows about is kept resident —
 *      not just one. Whatever a lane, an ingest job or an eval reaches for is
 *      already loaded.
 *   2. Residency is read, never assumed. `/api/models` reports entries as
 *      strings or as objects; both are normalised before anything is judged.
 *   3. Repair is the smallest possible act — load the missing embedder, evict
 *      nothing. Never a mode switch, which would unload the whole set to
 *      recover a 0.3 GiB weight.
 *   4. The watchdog runs continuously: on first read, on every reconnect, and
 *      on a timer — so a machine restart restores the set without being asked.
 *   5. The alarm names the consequence, not the fact.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useLocal, isRefusal } from "@/lib/local-bridge";
import { toNum } from "@/lib/format";
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

export type EmbedderState = "resident" | "answering" | "partial" | "missing" | "restoring" | "unknown";

/** A proof is only worth trusting for so long. */
const PROOF_TTL_MS = 10 * 60_000;
/** How often the watchdog re-reads residency and reloads anything that dropped. */
const WATCH_INTERVAL_MS = 60_000;

/** One embedding model the machine knows about, and whether it is loaded. */
export type EmbedderEntry = {
  id: string;
  /** In the resident list right now. */
  listed: boolean;
  /** Weight from the bench, when the bench accounts for it. */
  gib: number | null;
  /** Pinned by the bench as the primary embedding role. */
  primary: boolean;
};

export type EmbedderHealth = {
  state: EmbedderState;
  /** Every embedding model the machine knows about. */
  models: EmbedderEntry[];
  /** The primary embedder id — what retrieval reaches for by default. */
  target: string | null;
  /** Ids known but not loaded. */
  missing: string[];
  residentCount: number;
  knownCount: number;
  /** Whether at least one embedder is loaded. */
  listed: boolean;
  /** Last time residency was read from the machine. */
  checkedAt: Date | null;
  /** Last time a live embedding round-trip proved it answers. */
  provedAt: Date | null;
  /** Outcome of that round-trip: true = returned sources, false = returned none. */
  proved: boolean | null;
  /** Times the watchdog has reloaded a dropped embedder this session. */
  repairs: number;
  message: string | null;
  /** Kept resident automatically — always true; surfaced for the UI to state. */
  keepResident: boolean;
};

type Sources = {
  resident: unknown;
  available: unknown;
  bench: Bench[];
};

function benchGib(id: string, bench: Bench[]): number | null {
  const value = id.toLowerCase();
  const match = bench.find((item) => {
    const other = (item.id ?? "").toLowerCase();
    return other && (other === value || other.includes(value) || value.includes(other));
  });
  return toNum(match?.gib);
}

/** Every embedding model named anywhere on the machine, deduped. */
export function embedderCatalogue(sources: Sources): string[] {
  const seen = new Set<string>();
  const push = (id: string) => {
    if (id && isEmbedder(id) && !seen.has(id)) seen.add(id);
  };
  sources.bench.forEach((row) => {
    if (/embed/i.test(row.role ?? "") || /embed/i.test(row.id ?? "")) push(row.id ?? "");
  });
  normalizeIds(sources.resident).forEach(push);
  normalizeIds(sources.available).forEach(push);
  return [...seen];
}

/** The embedder to lead with: what the bench pins, else the first one known. */
export function embedderTarget(sources: Sources): string | null {
  const benched = sources.bench.find(
    (row) => /embed/i.test(row.role ?? "") || /embed/i.test(row.id ?? ""),
  );
  if (benched?.id) return benched.id;
  return embedderCatalogue(sources)[0] ?? null;
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
  /** Re-read residency after a repair. */
  refresh: () => Promise<unknown>;
};

const MAX_AUTO_ATTEMPTS = 3;

export function useEmbedderGuard({ sources, ready, refresh }: GuardOptions) {
  const local = useLocal();
  const [restoring, setRestoring] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [provedAt, setProvedAt] = useState<Date | null>(null);
  const [proved, setProved] = useState<boolean | null>(null);
  const [proving, setProving] = useState(false);
  const [repairs, setRepairs] = useState(0);
  const [tick, setTick] = useState(0);
  const attempts = useRef(0);
  const [checkedAt, setCheckedAt] = useState<Date | null>(null);

  const residentIds = useMemo(() => normalizeIds(sources.resident), [sources.resident]);
  const known = useMemo(() => embedderCatalogue(sources), [sources]);
  const target = embedderTarget(sources);

  const models: EmbedderEntry[] = useMemo(
    () =>
      known.map((id) => ({
        id,
        listed: residentIds.some((entry) => entry.toLowerCase() === id.toLowerCase()),
        gib: benchGib(id, sources.bench),
        primary: id === target,
      })),
    [known, residentIds, sources.bench, target],
  );

  const missing = models.filter((model) => !model.listed).map((model) => model.id);
  const residentCount = models.length - missing.length;
  const listed = residentCount > 0;

  useEffect(() => {
    if (ready) setCheckedAt(new Date());
  }, [ready, residentCount, known.length]);

  // Evidence beats inventory. A live round-trip that came back with sources is
  // proof embedding is working, whatever the model list happens to say.
  const proofFresh =
    provedAt !== null && Date.now() - provedAt.getTime() < PROOF_TTL_MS && proved !== null;

  const state: EmbedderState = restoring
    ? "restoring"
    : proofFresh
      ? proved
        ? listed
          ? missing.length
            ? "partial"
            : "resident"
          : "answering"
        : "missing"
      : !ready
        ? "unknown"
        : listed
          ? missing.length
            ? "partial"
            : "resident"
          : "unknown";

  /** Load one embedder. Narrow by design: evict nothing. */
  const loadOne = useCallback(
    async (id: string) => {
      await local.post("/api/models/action", { action: "load", model: id });
    },
    [local],
  );

  /** Bring the whole embedding set back to resident. */
  const restore = useCallback(
    async (only?: string): Promise<boolean> => {
      const wanted = only ? [only] : missing.length ? missing : target ? [target] : [];
      if (!wanted.length) {
        setMessage(
          known.length
            ? "Every embedding model the machine knows about is already loaded."
            : "The machine does not name an embedding model — nothing on the bench or on disk matches. Load one in LM Studio once and it will be kept resident from then on.",
        );
        return false;
      }
      setRestoring(true);
      attempts.current += 1;
      try {
        for (const id of wanted) {
          setMessage(`loading ${id}…`);
          // One at a time: LM Studio frees and claims memory per call.
          await loadOne(id);
        }
        await refresh();
        setRepairs((count) => count + wanted.length);
        setMessage(
          wanted.length === 1
            ? `${wanted[0]} is resident again.`
            : `${wanted.length} embedding models loaded — the set is resident.`,
        );
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
    },
    [missing, target, known.length, loadOne, refresh],
  );

  /**
   * Prove it embeds, not merely that it is listed. `/api/kb` only reads a table
   * of counts — it never touches the model — so the only honest probe is a real
   * retrieval: one short question, one source.
   */
  const prove = useCallback(async (): Promise<boolean> => {
    setProving(true);
    setMessage("embedding one probe question…");
    try {
      const result = await local.post<{ sources?: unknown[] }>("/api/ask", {
        q: "embedder health probe",
        k: 1,
      });
      const hits = Array.isArray(result?.sources) ? result.sources.length : 0;
      setProvedAt(new Date());
      if (hits > 0) {
        setProved(true);
        setMessage(`retrieval answered with ${hits} source — the embedder is vectorising.`);
        return true;
      }
      setProved(false);
      setMessage(
        "the question answered but returned no sources — nothing was vectorised, so the embedder is not serving.",
      );
      return false;
    } catch (error) {
      setProvedAt(new Date());
      setProved(false);
      setMessage(
        isRefusal(error)
          ? error.message || "denied at the approval dialog"
          : "the probe did not complete — retrieval could not be proved.",
      );
      return false;
    } finally {
      setProving(false);
    }
  }, [local]);

  // The watchdog. Embedders are not optional, so this is not a preference: any
  // known embedding model that is not resident is reloaded, on first read, on
  // reconnect after a machine restart, and on a timer thereafter.
  useEffect(() => {
    if (!ready || restoring) return;
    if (!missing.length) {
      attempts.current = 0;
      return;
    }
    if (attempts.current >= MAX_AUTO_ATTEMPTS) return;
    void restore();
  }, [ready, restoring, missing.length, restore, tick]);

  // Heartbeat: re-read residency so a drop is noticed without a page visit.
  useEffect(() => {
    if (!ready) return;
    const id = setInterval(() => {
      attempts.current = 0;
      setTick((value) => value + 1);
      void refresh();
    }, WATCH_INTERVAL_MS);
    return () => clearInterval(id);
  }, [ready, refresh]);

  const health: EmbedderHealth = {
    state,
    models,
    target,
    missing,
    residentCount,
    knownCount: models.length,
    listed,
    checkedAt,
    provedAt,
    proved,
    repairs,
    message,
    keepResident: true,
  };

  return { health, restore, prove, restoring, proving };
}
