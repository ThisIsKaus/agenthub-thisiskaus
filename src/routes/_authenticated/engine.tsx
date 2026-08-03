import { createFileRoute, redirect } from "@tanstack/react-router";

/** Group header — opens its first sub-view rather than dead-ending on a 404. */
export const Route = createFileRoute("/_authenticated/engine")({
  beforeLoad: () => {
    throw redirect({ to: "/models", replace: true });
  },
});
