import { createFileRoute } from "@tanstack/react-router";
import { Panel } from "@/components/AppShell";

export const Route = createFileRoute("/_authenticated/capture")({
  head: () => ({
    meta: [
      { title: "Capture — AgentHub Remote" },
      { name: "description", content: "Queue a thought for the machine to process locally." },
      { property: "og:title", content: "Capture — AgentHub Remote" },
      { property: "og:description", content: "Queue a thought for the machine to process locally." },
    ],
  }),
  component: CapturePage,
});

function CapturePage() {
  return (
    <div className="space-y-4">
      <Panel title="Capture">Nothing wired here yet.</Panel>
    </div>
  );
}
