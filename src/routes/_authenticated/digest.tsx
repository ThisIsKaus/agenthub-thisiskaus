import { createFileRoute } from "@tanstack/react-router";
import { Panel } from "@/components/AppShell";

export const Route = createFileRoute("/_authenticated/digest")({
  head: () => ({
    meta: [
      { title: "Digest — AgentHub Remote" },
      { name: "description", content: "Nightly digest counts and flags. Counts only, never content." },
      { property: "og:title", content: "Digest — AgentHub Remote" },
      { property: "og:description", content: "Nightly digest counts and flags. Counts only, never content." },
    ],
  }),
  component: DigestPage,
});

function DigestPage() {
  return (
    <div className="space-y-4">
      <Panel title="Digest">Nothing wired here yet.</Panel>
    </div>
  );
}
