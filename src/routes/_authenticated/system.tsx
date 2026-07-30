import { createFileRoute, redirect } from "@tanstack/react-router";

export const Route = createFileRoute("/_authenticated/system")({
  beforeLoad: () => {
    throw redirect({ to: "/overview", replace: true });
  },
});
