import { createFileRoute, redirect } from "@tanstack/react-router";

/** Projects merged into Canvas: a canvas carries its own stage. */
export const Route = createFileRoute("/_authenticated/factory")({
  beforeLoad: () => {
    throw redirect({ to: "/canvas", search: { q: undefined, seed: undefined, id: undefined } });
  },
});
