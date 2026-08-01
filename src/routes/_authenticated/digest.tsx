import { createFileRoute, redirect } from "@tanstack/react-router";

/** Triage is now the overnight lane of Inbox. */
export const Route = createFileRoute("/_authenticated/digest")({
  beforeLoad: () => {
    throw redirect({ to: "/inbox" });
  },
});
