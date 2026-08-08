import { createFileRoute, redirect } from "@tanstack/react-router";

/** Ask is the unsaved case of Canvas. There is no separate surface. */
export const Route = createFileRoute("/_authenticated/ask")({
  validateSearch: (search: Record<string, unknown>) => ({
    q: typeof search.q === "string" ? search.q : undefined,
  }),
  beforeLoad: ({ search }) => {
    throw redirect({ to: "/canvas", search: { q: search.q } });
  },
});
