import { createFileRoute, redirect } from "@tanstack/react-router";

/** One Ask surface, and it lives under the omnibox on Overview. */
export const Route = createFileRoute("/_authenticated/ask")({
  beforeLoad: () => {
    throw redirect({ to: "/overview" });
  },
});
