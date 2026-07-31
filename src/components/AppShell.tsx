import { Link, Outlet, useNavigate, useRouterState } from "@tanstack/react-router";
import { supabase } from "@/integrations/supabase/client";
import { useHubState } from "@/hooks/use-realtime-state";
import { useOnline } from "@/hooks/use-online";
import { useQueryClient } from "@tanstack/react-query";
import { useLocal } from "@/lib/local-bridge";
import { JobDrawer } from "@/components/JobDrawer";

type Sub = { to: string; label: string };
type Group = { label: string; to: string; subs: Sub[] };

const GROUPS: Group[] = [
  { label: "Overview", to: "/overview", subs: [] },
  { label: "Canvas", to: "/canvas", subs: [] },
  { label: "Inbox", to: "/inbox", subs: [] },
  { label: "Skills", to: "/skills", subs: [] },
  {
    label: "Corpus",
    to: "/files",
    subs: [
      { to: "/files", label: "Files" },
      { to: "/knowledge", label: "Knowledge" },
      { to: "/memory", label: "Memory" },
    ],
  },
  {
    label: "Engine",
    to: "/models",
    subs: [
      { to: "/models", label: "Models" },
      { to: "/model-scanner", label: "Scanner" },
      { to: "/prompts", label: "Prompts" },
    ],
  },
  {
    label: "Improve",
    to: "/evals",
    subs: [
      { to: "/evals", label: "Evals" },
      { to: "/proposals", label: "Proposals" },
      { to: "/build", label: "Build" },
    ],
  },
  {
    label: "Health",
    to: "/health",
    subs: [
      { to: "/health", label: "Health" },
      { to: "/cost", label: "Cost" },
    ],
  },
];


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
  const { data } = useHubState();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const online = useOnline();

  const pathname = useRouterState({ select: (state) => state.location.pathname });
  const current =
    GROUPS.find((group) => group.to === pathname || group.subs.some((sub) => sub.to === pathname)) ?? null;

  const services = data?.services ?? {};
  const spend = data?.spend ?? {};
  const factory = data?.factory ?? {};

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
              AgentHub
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
            <Pill label="serving" value={String(services.lms ?? "—")} className={tone(services.lms)} />
            <PlanePill />
            <Pill label="mtd" value={`$${Number(spend.mtd ?? 0).toFixed(2)}`} />
            <Pill label="wip" value={`${factory.wip ?? 0}/${factory.limit ?? 2}`} />
          </div>

          <nav className="-mx-4 flex gap-5 overflow-x-auto px-4 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
            {GROUPS.map((group) => {
              const active =
                group.to === pathname || group.subs.some((sub) => sub.to === pathname);
              return (
                <Link
                  key={group.label}
                  to={group.to}
                  className={`shrink-0 border-b-2 pb-2 text-sm transition-colors hover:text-paper ${
                    active ? "border-copper text-paper" : "border-transparent text-muted-foreground"
                  }`}
                >
                  {group.label}
                </Link>
              );
            })}
          </nav>

          {current && current.subs.length > 1 && (
            <div className="-mx-4 flex gap-4 overflow-x-auto border-t border-rule px-4 py-2 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
              {current.subs.map((sub) => (
                <Link
                  key={sub.to}
                  to={sub.to}
                  className={`shrink-0 font-mono text-[11px] uppercase tracking-[0.12em] transition-colors hover:text-paper ${
                    sub.to === pathname ? "text-copper" : "text-faint"
                  }`}
                >
                  {sub.label}
                </Link>
              ))}
            </div>
          )}
        </div>
      </header>

      <main className="mx-auto w-full max-w-[1100px] px-4 py-8">
        <Outlet />
      </main>

      <footer className="mt-8 border-t border-rule pb-16">
        <p className="mx-auto w-full max-w-[1100px] px-4 py-6 font-mono text-[10px] leading-relaxed text-faint">
          AgentHub · local plane over loopback on the machine · published status everywhere else
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
