import { createFileRoute, redirect } from "@tanstack/react-router";
import { AppShell } from "@/components/AppShell";
import { supabase } from "@/integrations/supabase/client";

export const Route = createFileRoute("/_authenticated")({
  ssr: false,
  beforeLoad: async () => {
    // Offline (home-screen launch with no connection): getUser() cannot reach
    // the auth server, so fall back to the session already persisted on this
    // device. Every server call still re-validates the bearer token.
    if (typeof navigator !== "undefined" && navigator.onLine === false) {
      const { data } = await supabase.auth.getSession();
      if (!data.session?.user) throw redirect({ to: "/" });
      return { user: data.session.user };
    }

    const { data, error } = await supabase.auth.getUser();
    if (error || !data.user) throw redirect({ to: "/" });
    return { user: data.user };
  },

  component: AppShell,
  notFoundComponent: () => (
    <div className="p-8 font-mono text-sm text-faint">No such section.</div>
  ),
});
