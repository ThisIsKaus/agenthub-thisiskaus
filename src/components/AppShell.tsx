import { useQuery } from "@tanstack/react-query";
import { Link, Outlet, useNavigate } from "@tanstack/react-router";
import { supabase } from "@/integrations/supabase/client";
import { stateQueryOptions } from "@/lib/state";
import { useOnline } from "@/hooks/use-online";
import { useQueryClient } from "@tanstack/react-query";
import { useLocal } from "@/lib/local-bridge";
import { JobDrawer } from "@/components/JobDrawer";

const TABS = [
  { to: "/overview", label: "Overview" },
  { to: "/ask", label: "Ask" },
  { to: "/capture", label: "Capture" },
  { to: "/digest", label: "Digest" },
  { to: "/evals", label: "Evals" },

  { to: "/factory", label: "Factory" },
  { to: "/files", label: "Files" },
  { to: "/knowledge", label: "Knowledge" },
  { to: "/models", label: "Models" },
  { to: "/prompts", label: "Prompts" },
  { to: "/memory", label: "Memory" },
  { to: "/health", label: "Health" },
  { to: "/cost", label: "Cost" },


] as const;

function tone(value: string | undefined) {
  if (value === "up" || value === "ok" || value === "passed") return "text-ok";
  if (value === "degraded" || value === "warn" || value === "warning") return "text-watch";
  if (value === "down" || value === "failed") return "text-risk";
  return "text-faint";
}

export function Pill({
  label,
  value,
  className,
}: {
  label: string;
  value: string;
  className?: string;
}) {
  return (
    <span className="inline-flex shrink-0 items-center gap-2 border border-rule bg-panel2 px-2 py-1 font-mono text-[11px] tracking-tight">
      <span className="text-faint uppercase">{label}</span>
      <span className={className ?? "text-paper"}>{value}</span>
    </span>
  );
}

function PlanePill() {
  const { available, machine } = useLocal();
  const posture = String(machine?.posture ?? "").trim();
  return (
    <span className="inline-flex shrink-0 items-center gap-2 border border-rule bg-panel2 px-2 py-1 font-mono text-[11px]">
      <span
        aria-hidden
        className={`h-1.5 w-1.5 rounded-full ${available ? "bg-copper" : "bg-faint"}`}
      />
      <span className={available ? "text-paper" : "text-faint"}>
        {available ? (posture ? `local · ${posture}` : "local") : "remote"}
      </span>
    </span>
  );
}


export function AppShell() {
  const { data } = useQuery(stateQueryOptions);
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const online = useOnline();

  const services = data?.services ?? {};
  const health = data?.health ?? {};
  const spend = data?.spend ?? {};

  async function signOut() {
    await queryClient.cancelQueries();
    queryClient.clear();
    await supabase.auth.signOut();
    navigate({ to: "/", replace: true });
  }

  return (
    <div className="min-h-screen bg-background">
      <header className="sticky top-0 z-20 border-b border-rule bg-background/95 backdrop-blur">
        <div className="mx-auto w-full max-w-[1100px] px-4">
          <div className="flex items-baseline justify-between gap-4 py-3">
            <h1 className="font-serif text-2xl leading-none text-paper">
              AgentHub <span className="text-copper">Remote</span>
            </h1>
            <div className="flex items-center gap-3">
              <PlanePill />
              {!online && (
                <span className="border border-watch/60 px-2 py-1 font-mono text-[10px] uppercase tracking-[0.14em] text-watch">
                  Offline
                </span>
              )}
              <button
                onClick={signOut}
                className="font-mono text-[11px] uppercase tracking-wide text-faint transition-colors hover:text-copper"
              >
                Sign out
              </button>
            </div>
          </div>

          <div className="-mx-4 flex gap-2 overflow-x-auto px-4 pb-3 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
            <Pill label="lms" value={String(services.lms ?? "—")} className={tone(services.lms)} />
            <Pill
              label="router"
              value={String(services.router ?? "—")}
              className={tone(services.router)}
            />
            <Pill label="aliases" value={String(services.aliases ?? 0)} />
            <Pill
              label="health"
              value={`${health.passed ?? 0}/${health.warnings ?? 0}/${health.failed ?? 0}`}
              className={
                (health.failed ?? 0) > 0
                  ? "text-risk"
                  : (health.warnings ?? 0) > 0
                    ? "text-watch"
                    : "text-ok"
              }
            />
            <Pill label="mtd" value={`$${Number(spend.mtd ?? 0).toFixed(2)}`} />
          </div>

          <nav className="-mx-4 flex gap-5 overflow-x-auto px-4 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
            {TABS.map((tab) => (
              <Link
                key={tab.to}
                to={tab.to}
                className="shrink-0 border-b-2 border-transparent pb-2 text-sm text-muted-foreground transition-colors hover:text-paper"
                activeProps={{ className: "!border-copper !text-paper" }}
              >
                {tab.label}
              </Link>
            ))}
          </nav>
        </div>
      </header>

      <main className="mx-auto w-full max-w-[1100px] px-4 py-8">
        <Outlet />
      </main>

      <footer className="mt-8 border-t border-rule pb-16">
        <p className="mx-auto w-full max-w-[1100px] px-4 py-6 font-mono text-[10px] leading-relaxed text-faint">
          AgentHub Remote · reads published status only · the machine is never reachable from here
        </p>
      </footer>

      <JobDrawer />
    </div>
  );
}

export function Panel({ title, children }: { title: string; children?: React.ReactNode }) {
  return (
    <section className="border border-rule bg-panel p-5">
      <h2 className="font-mono text-[11px] uppercase tracking-[0.14em] text-faint">{title}</h2>
      <div className="mt-4 text-sm text-muted-foreground">{children}</div>
    </section>
  );
}
