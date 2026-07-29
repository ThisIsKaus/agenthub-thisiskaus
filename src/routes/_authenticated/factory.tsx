import { createFileRoute } from "@tanstack/react-router";
import { Panel } from "@/components/AppShell";

export const Route = createFileRoute("/_authenticated/factory")({
  head: () => ({
    meta: [
      { title: "Factory — AgentHub Remote" },
      { name: "description", content: "Work in progress against the WIP limit." },
      { property: "og:title", content: "Factory — AgentHub Remote" },
      { property: "og:description", content: "Work in progress against the WIP limit." },
    ],
  }),
  component: FactoryPage,
});

function FactoryPage() {
  return (
    <div className="space-y-4">
      <Panel title="Factory">Nothing wired here yet.</Panel>
    </div>
  );
}
