import { createFileRoute } from "@tanstack/react-router";
import { useCallback, useEffect, useState } from "react";
import { Panel } from "@/components/AppShell";
import { Empty, Skeleton } from "@/components/data";
import { LocalOnly } from "@/components/LocalOnly";
import { isRefusal, useLocal } from "@/lib/local-bridge";

export const Route = createFileRoute("/_authenticated/models")({
  head: () => ({
    meta: [
      { title: "Models — AgentHub" },
      {
        name: "description",
        content: "Resident models, measured throughput and router aliases on the machine.",
      },
      { property: "og:title", content: "Models — AgentHub" },
      {
        property: "og:description",
        content: "Resident models, measured throughput and router aliases on the machine.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: () => (
    <LocalOnly>
      <ModelsPage />
    </LocalOnly>
  ),
});

type Bench = { role: string; id: string; tps: number; gib: number };
type ModelsData = {
  resident?: string[];
  available?: string[];
  bench?: Bench[];
  aliases?: string[];
};

const MODES = [
  { action: "standard", label: "Standard" },
  { action: "coding", label: "Coding" },
  { action: "tools", label: "Tools" },
  { action: "light", label: "Light" },
] as const;

function isEmbedder(id: string) {
  return /embed/i.test(id);
}

function ModelsPage() {
  const local = useLocal();
  const [data, setData] = useState<ModelsData | null>(null);
  const [loading, setLoading] = useState(true);
  const [note, setNote] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      setData(await local.get<ModelsData>("/api/models"));
    } catch {
      setData(null);
    } finally {
      setLoading(false);
    }
  }, [local]);

  useEffect(() => {
    void load();
  }, [load]);

  async function act(action: string, model?: string, label?: string) {
    setBusy(label ?? action);
    setNote("awaiting the machine…");
    try {
      await local.post("/api/models/action", { action, model });
      setNote(`${label ?? action} — done`);
      await load();
    } catch (error) {
      setNote(
        isRefusal(error)
          ? error.message || "denied at the approval dialog"
          : "the machine did not carry that out",
      );
    } finally {
      setBusy(null);
    }
  }

  const resident = data?.resident ?? [];
  const embedderResident = resident.some(isEmbedder);

  return (
    <div className="space-y-4">
      <Panel title="Mode">
        <div className="flex flex-wrap gap-2">
          {MODES.map((mode) => (
            <button
              key={mode.action}
              type="button"
              disabled={busy !== null}
              onClick={() => void act(mode.action, undefined, mode.label)}
              className="border border-rule px-3 py-1.5 font-mono text-[11px] uppercase tracking-[0.12em] text-muted-foreground hover:border-copper hover:text-copper disabled:opacity-50"
            >
              {busy === mode.label ? "…" : mode.label}
            </button>
          ))}
        </div>
      </Panel>

      {!loading && !embedderResident && (
        <p className="border border-copper bg-panel px-3 py-2 text-[13px] leading-relaxed text-copper">
          The knowledge base cannot work without the embedding model. Switch to any mode to restore it.
        </p>
      )}

      <Panel title="Resident">
        {loading ? (
          <div className="space-y-2">
            {Array.from({ length: 3 }).map((_, index) => (
              <Skeleton key={index} className="h-4 w-full" />
            ))}
          </div>
        ) : resident.length === 0 ? (
          <Empty>Nothing loaded.</Empty>
        ) : (
          <ul>
            {resident.map((model) => (
              <li
                key={model}
                className="flex items-baseline gap-3 border-b border-rule py-2 last:border-b-0"
              >
                <span className="min-w-0 flex-1 break-all font-mono text-[12px] text-paper">
                  {model}
                </span>
                {isEmbedder(model) && (
                  <span className="shrink-0 font-mono text-[10px] text-faint">embedder</span>
                )}
                <button
                  type="button"
                  disabled={busy !== null}
                  onClick={() => void act("unload", model, `unload ${model}`)}
                  className="shrink-0 font-mono text-[10px] uppercase tracking-[0.12em] text-faint hover:text-risk disabled:opacity-50"
                >
                  Unload
                </button>
              </li>
            ))}
          </ul>
        )}
      </Panel>

      <Panel title="Available on disk">
        {loading ? (
          <Skeleton className="h-5 w-2/3" />
        ) : (data?.available ?? []).length === 0 ? (
          <Empty>No other models on disk.</Empty>
        ) : (
          <div className="flex flex-wrap gap-2">
            {(data?.available ?? []).map((model) => (
              <button
                key={model}
                type="button"
                disabled={busy !== null}
                onClick={() => void act("load", model, `load ${model}`)}
                className="border border-rule px-2 py-1 font-mono text-[10px] text-muted-foreground hover:border-copper hover:text-copper disabled:opacity-50"
              >
                {model}
              </button>
            ))}
          </div>
        )}
      </Panel>

      <Panel title="Measured performance">
        {loading ? (
          <Skeleton className="h-4 w-full" />
        ) : (data?.bench ?? []).length === 0 ? (
          <Empty>No benchmark on record.</Empty>
        ) : (
          <table className="w-full text-left">
            <thead>
              <tr className="border-b border-rule font-mono text-[10px] uppercase tracking-[0.14em] text-faint">
                <th className="py-1.5 font-normal">Role</th>
                <th className="py-1.5 font-normal">Model</th>
                <th className="py-1.5 text-right font-normal">Gen t/s</th>
                <th className="py-1.5 text-right font-normal">GiB</th>
              </tr>
            </thead>
            <tbody>
              {(data?.bench ?? []).map((row) => (
                <tr key={`${row.role}-${row.id}`} className="border-b border-rule last:border-b-0">
                  <td className="py-2 pr-2 text-[13px] text-paper">{row.role}</td>
                  <td className="break-all py-2 pr-2 font-mono text-[11px] text-muted-foreground">
                    {row.id}
                  </td>
                  <td className="py-2 text-right font-mono text-[12px] tabular-nums text-paper">
                    {row.tps?.toFixed?.(1) ?? row.tps}
                  </td>
                  <td className="py-2 text-right font-mono text-[12px] tabular-nums text-muted-foreground">
                    {row.gib?.toFixed?.(1) ?? row.gib}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Panel>

      <Panel title="Router aliases">
        {loading ? (
          <Skeleton className="h-5 w-1/2" />
        ) : (
          <div className="flex flex-wrap gap-2">
            {(data?.aliases ?? []).map((alias) => (
              <span
                key={alias}
                className="border border-rule bg-panel2 px-2 py-1 font-mono text-[10px] text-muted-foreground"
              >
                {alias}
              </span>
            ))}
          </div>
        )}
      </Panel>

      {note && <p className="font-mono text-[10px] text-faint">{note}</p>}
    </div>
  );
}
