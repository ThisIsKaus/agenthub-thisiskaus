import { createFileRoute, redirect } from "@tanstack/react-router";

/** Group header — opens its first sub-view rather than dead-ending on a 404. */
export const Route = createFileRoute("/_authenticated/corpus")({
  beforeLoad: () => {
    throw redirect({ to: "/files", replace: true });
  },
});
