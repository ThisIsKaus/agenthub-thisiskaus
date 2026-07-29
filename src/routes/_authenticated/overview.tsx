import { createFileRoute } from "@tanstack/react-router";
import { Panel } from "@/components/AppShell";

export const Route = createFileRoute("/_authenticated/overview")({
  head: () => ({
    meta: [
      { title: "Overview — AgentHub Remote" },
      { name: "description", content: "Machine status, corpus counts and health at a glance." },
      { property: "og:title", content: "Overview — AgentHub Remote" },
      { property: "og:description", content: "Machine status, corpus counts and health at a glance." },
    ],
  }),
  component: OverviewPage,
});

function OverviewPage() {
  return (
    <div className="space-y-4">
      <Panel title="Overview">Nothing wired here yet.</Panel>
    </div>
  );
}
