import { createFileRoute } from "@tanstack/react-router";
import { Panel } from "@/components/AppShell";

export const Route = createFileRoute("/_authenticated/cost")({
  head: () => ({
    meta: [
      { title: "Cost — AgentHub Remote" },
      { name: "description", content: "Month-to-date metered spend and request counts." },
      { property: "og:title", content: "Cost — AgentHub Remote" },
      { property: "og:description", content: "Month-to-date metered spend and request counts." },
    ],
  }),
  component: CostPage,
});

function CostPage() {
  return (
    <div className="space-y-4">
      <Panel title="Cost">Nothing wired here yet.</Panel>
    </div>
  );
}
