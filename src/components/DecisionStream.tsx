import { useCallback, useEffect, useMemo, useState } from "react";
import { Panel } from "@/components/AppShell";
import { Skeleton, formatStamp } from "@/components/data";
import { isRefusal, useLocal } from "@/lib/local-bridge";
import {
  mergeStream,
  memoryEcho,
  type DecisionItem,
  type MemoryEvent,
} from "@/lib/decision-stream";

type Action = { label: string; run: () => void | Promise<void>; primary?: boolean };

/** Rows the machine can still act on. Everything else is history, not a decision. */

const PILL_TONE: Record<DecisionItem["kind"], string> = {
  check: "border-risk/50 text-risk",
  proposal: "border-copper/50 text-copper",
  build: "border-ok/50 text-ok",
  digest: "border-watch/50 text-watch",
  task: "border-rule text-muted-foreground",
};

export function DecisionStream() {
  const local = useLocal();
  const live = local.available;
  const resolved = local.resolved;
  const [items, setItems] = useState<DecisionItem[] | null>(null);
  const [echoes, setEchoes] = useState<Record<string, string>>({});
  const [dismissed, setDismissed] = useState<string[]>([]);
  const [at, setAt] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!live) return;
    const [digest, proposals, cascade, selftest] = await Promise.all([
      local.get("/api/digest").catch(() => null),
      local.get("/api/proposals").catch(() => null),
      local.get("/api/cascade/stats").catch(() => null),
      local.get("/api/selftest").catch(() => null),
    ]);
    const merged = mergeStream({
      digest: digest as never,
      proposals: proposals as never,
      cascade: cascade as never,
      selftest: selftest as never,
    });
    setItems(merged);
    setAt(new Date().toISOString());

    // Memory surfacing — only for the items actually on screen, only when a match exists.
    const found: Record<string, string> = {};
    await Promise.all(
      merged.slice(0, 8).map(async (item) => {
        if (item.kind === "build" || item.kind === "check") return;
        try {
          const memory = await local.get<{ events?: MemoryEvent[] }>("/api/memory", {
            q: item.what.slice(0, 120),
            n: 8,
          });
          const echo = memoryEcho(item, memory?.events ?? []);
          if (echo) found[item.id] = echo.text;
        } catch {
          /* memory is advisory; silence is correct */
        }
      }),
    );
    setEchoes(found);
  }, [live, local]);

  useEffect(() => {
    void load();
  }, [load]);

  const visible = useMemo(
    () => (items ?? []).filter((item) => !dismissed.includes(item.id)),
    [items, dismissed],
  );

  const dismiss = useCallback((id: string) => {
    setDismissed((current) => [...current, id]);
  }, []);

  if (!resolved) {
    return (
      <Panel title="Needs a decision">
        <div className="space-y-2">
          <Skeleton className="h-12 w-full" />
          <Skeleton className="h-12 w-full" />
          <Skeleton className="h-12 w-full" />
        </div>
      </Panel>
    );
  }

  if (!live) {
    return (
      <Panel title="Needs a decision">
        <p className="max-w-[72ch] text-[13px] leading-relaxed text-muted-foreground">
          Available on the machine. This section reads material that never leaves it.
        </p>
      </Panel>
    );
  }

  return (
    <Panel title="Needs a decision">
      {items === null ? (
        <div className="space-y-2">
          <Skeleton className="h-12 w-full" />
          <Skeleton className="h-12 w-full" />
          <Skeleton className="h-12 w-full" />
        </div>
      ) : visible.length === 0 ? (
        <p className="text-[13px] leading-relaxed text-muted-foreground">
          Nothing needs a decision.
        </p>
      ) : (
        <ul>
          {visible.map((item) => (
            <StreamRow
              key={item.id}
              item={item}
              echo={echoes[item.id]}
              onDone={dismiss}
              reload={load}
            />
          ))}
        </ul>
      )}
      {at && (
        <p className="mt-3 font-mono text-[10px] text-faint">
          {visible.length} ranked by consequence · read from the machine at {formatStamp(at)}
        </p>
      )}
    </Panel>
  );
}

function StreamRow({
  item,
  echo,
  onDone,
  reload,
}: {
  item: DecisionItem;
  echo?: string;
  onDone: (id: string) => void;
  reload: () => Promise<void>;
}) {
  const local = useLocal();
  const [note, setNote] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [reason, setReason] = useState("");
  const [askReason, setAskReason] = useState(false);
  const [open, setOpen] = useState(false);

  const attempt = useCallback(
    async (label: string, fn: () => Promise<void>, done?: boolean) => {
      setBusy(true);
      setNote("awaiting approval on the machine…");
      try {
        await fn();
        setNote(`${label} recorded`);
        if (done) onDone(item.id);
        else await reload();
      } catch (error) {
        setNote(
          isRefusal(error)
            ? error.message || "denied at the approval dialog"
            : `the machine did not accept ${label.toLowerCase()}`,
        );
      } finally {
        setBusy(false);
      }
    },
    [item.id, onDone, reload],
  );

  const raw = item.raw as Record<string, string | undefined>;

  let actions: Action[] = [];
  if (item.kind === "digest" || item.kind === "task") {
    actions = [
      {
        label: "Correct",
        primary: true,
        run: () =>
          attempt("Correct", () =>
            local.post("/api/eval/correct", {
              text: raw.one ?? item.what,
              cls: raw.cls ?? "",
              entity: raw.ent ?? "",
              sensitivity: raw.sen ?? "",
            }),
          ),
      },
      {
        label: "Draft reply",
        run: () =>
          attempt("Draft reply", () =>
            local.post("/api/draft", { title: item.what.slice(0, 80), body: item.why }),
          ),
      },
      { label: "Dismiss", run: () => onDone(item.id) },
    ];
  } else if (item.kind === "proposal") {
    actions = [
      {
        label: "Approve",
        primary: true,
        run: () =>
          attempt(
            "Approve",
            () => local.post("/api/proposals/act", { id: String(raw.id ?? ""), action: "approve", note: "" }),
            true,
          ),
      },
      { label: "Reject", run: () => setAskReason((shown) => !shown) },
      {
        label: "Defer",
        run: () =>
          attempt(
            "Defer",
            () => local.post("/api/proposals/act", { id: String(raw.id ?? ""), action: "defer", note: "" }),
            true,
          ),
      },
    ];
  } else if (item.kind === "build") {
    // No endpoint merges or discards a branch, so no control claims to.
    // The evidence expands in place; the branch is merged on the machine.
    actions = [
      {
        label: open ? "Hide diff" : "Review diff",
        primary: true,
        run: () => setOpen((current) => !current),
      },
    ];
  } else {
    const fix = raw.fix ?? raw.detail ?? item.why;
    actions = [
      {
        label: "Fix now",
        primary: true,
        run: () =>
          attempt("Fix now", () =>
            local.post("/api/build", { intent: `${item.what} — ${fix}` }),
          ),
      },
      { label: "Acknowledge", run: () => onDone(item.id) },
    ];
  }

  return (
    <li className="border-t border-rule py-3 first:border-t-0 first:pt-0">
      <div className="flex flex-wrap items-start gap-x-3 gap-y-2">
        <span
          className={`mt-0.5 shrink-0 border px-1.5 py-0.5 font-mono text-[10px] uppercase tracking-[0.27em] ${PILL_TONE[item.kind]}`}
        >
          {item.pill}
        </span>
        <div className="min-w-0 flex-1">
          <p className="break-words text-[13px] leading-relaxed text-paper">{item.what}</p>
          <p className="mt-0.5 max-w-[72ch] break-words text-[12px] leading-relaxed text-faint">
            {item.why}
          </p>
          {echo && (
            <p className="mt-1 max-w-[72ch] break-words text-[12px] leading-relaxed text-faint">
              {echo}
            </p>
          )}
        </div>
        <div className="ml-auto flex shrink-0 flex-wrap items-center justify-end gap-1.5">
          {actions.map((action) => (
            <button
              key={action.label}
              type="button"
              disabled={busy}
              onClick={() => void action.run()}
              className={`border px-2 py-0.5 font-mono text-[10px] uppercase tracking-[0.27em] disabled:opacity-50 ${
                action.primary
                  ? "border-copper/60 text-copper hover:bg-copper/10"
                  : "border-rule text-muted-foreground hover:border-copper hover:text-copper"
              }`}
            >
              {action.label}
            </button>
          ))}
        </div>
      </div>

      {open && item.kind === "build" && (
        <div className="mt-2 border border-rule bg-panel2 p-2">
          <p className="font-mono text-[10px] uppercase tracking-[0.27em] text-faint">
            {raw.branch ? `branch ${raw.branch}` : "branch on the machine"}
          </p>
          {raw.diff ? (
            <pre className="mt-1 max-h-80 overflow-auto whitespace-pre-wrap break-words font-mono text-[11px] leading-relaxed text-paper">
              {String(raw.diff)}
            </pre>
          ) : (
            <p className="mt-1 max-w-[72ch] text-[12px] leading-relaxed text-faint">
              The run carries no diff. Files touched:{" "}
              {(item.raw as { files?: string[] }).files?.length
                ? String((item.raw as { files?: string[] }).files!.length)
                : "not recorded"}
              . Merge the branch on the machine — no endpoint merges it from here.
            </p>
          )}
        </div>
      )}

      {askReason && (
        <div className="mt-2 flex flex-wrap items-center gap-2">
          <input
            value={reason}
            onChange={(event) => setReason(event.target.value)}
            placeholder="Reason for rejection — required"
            className="min-w-0 flex-1 border border-rule bg-panel2 px-2 py-1 font-mono text-[11px] text-paper placeholder:text-faint focus:border-copper focus:outline-none"
          />
          <button
            type="button"
            disabled={busy || reason.trim().length === 0}
            onClick={() =>
              void attempt(
                "Reject",
                () =>
                  local.post("/api/proposals/act", {
                    id: String(raw.id ?? ""),
                    action: "reject",
                    note: reason.trim(),
                  }),
                true,
              )
            }
            className="border border-rule px-2 py-0.5 font-mono text-[10px] uppercase tracking-[0.27em] text-muted-foreground hover:border-copper hover:text-copper disabled:opacity-50"
          >
            Record rejection
          </button>
        </div>
      )}

      {note && <p className="mt-1 font-mono text-[10px] text-faint">{note}</p>}
    </li>
  );
}
