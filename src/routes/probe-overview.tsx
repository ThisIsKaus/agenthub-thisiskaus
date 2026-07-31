import { createFileRoute } from "@tanstack/react-router";
import { Route as OverviewRoute } from "./_authenticated/overview";

export const Route = createFileRoute("/probe-overview")({
  component: () => {
    const C = OverviewRoute.options.component as React.ComponentType;
    return <div className="mx-auto max-w-5xl p-4"><C /></div>;
  },
});
