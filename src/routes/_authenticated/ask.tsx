import { createFileRoute, redirect } from "@tanstack/react-router";

/** Ask now lives inside the canvas as a prompt block. */
export const Route = createFileRoute("/_authenticated/ask")({
  beforeLoad: () => {
    throw redirect({ to: "/canvas", search: {}, replace: true });
  },
});
