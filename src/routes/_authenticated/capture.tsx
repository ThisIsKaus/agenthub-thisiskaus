import { createFileRoute, redirect } from "@tanstack/react-router";

/** Capture is now the first lane of Inbox — one stream, not two places. */
export const Route = createFileRoute("/_authenticated/capture")({
  beforeLoad: () => {
    throw redirect({ to: "/inbox" });
  },
});
