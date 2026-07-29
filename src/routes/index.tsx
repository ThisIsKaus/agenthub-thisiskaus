import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { supabase } from "@/integrations/supabase/client";
import { requestMagicLink } from "@/lib/auth.functions";

export const Route = createFileRoute("/")({
  head: () => ({
    meta: [
      { title: "AgentHub Remote" },
      { name: "description", content: "Private companion for a personal AI operations hub." },
      { property: "og:title", content: "AgentHub Remote" },
      { property: "og:description", content: "Private companion for a personal AI operations hub." },
    ],
  }),
  component: SignIn,
});

function SignIn() {
  const navigate = useNavigate();
  const send = useServerFn(requestMagicLink);
  const [email, setEmail] = useState("");
  const [pending, setPending] = useState(false);
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null);

  useEffect(() => {
    let active = true;
    supabase.auth.getSession().then(({ data }) => {
      if (active && data.session) navigate({ to: "/overview", replace: true });
    });
    return () => {
      active = false;
    };
  }, [navigate]);

  async function onSubmit(event: React.FormEvent) {
    event.preventDefault();
    setPending(true);
    setMessage(null);
    try {
      const result = await send({ data: { email } });
      setMessage({ ok: result.ok, text: result.message });
    } catch {
      setMessage({ ok: false, text: "This instance is private." });
    } finally {
      setPending(false);
    }
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-background px-4">
      <div className="w-full max-w-sm border border-rule bg-panel p-6">
        <h1 className="font-serif text-3xl leading-none text-paper">
          AgentHub <span className="text-copper">Remote</span>
        </h1>

        <form onSubmit={onSubmit} className="mt-8 space-y-3">
          <input
            type="email"
            required
            autoComplete="email"
            inputMode="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="email"
            className="h-11 w-full border border-rule bg-panel2 px-3 font-mono text-sm text-paper placeholder:text-faint focus:border-copper focus:outline-none"
          />
          <button
            type="submit"
            disabled={pending}
            className="h-11 w-full border border-copper font-mono text-[12px] uppercase tracking-[0.14em] text-copper transition-colors hover:bg-copper hover:text-ink disabled:opacity-50"
          >
            {pending ? "Sending" : "Send link"}
          </button>
        </form>

        {message && (
          <p
            className={`mt-4 font-mono text-[12px] ${message.ok ? "text-ok" : "text-risk"}`}
            role="status"
          >
            {message.text}
          </p>
        )}
      </div>
    </div>
  );
}
