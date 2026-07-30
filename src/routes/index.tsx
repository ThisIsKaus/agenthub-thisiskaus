import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { supabase } from "@/integrations/supabase/client";
import { lovable } from "@/integrations/lovable/index";
import { requestMagicLink, isSessionAllowed } from "@/lib/auth.functions";

export const Route = createFileRoute("/")({
  head: () => ({
    meta: [
      { title: "Agent Hub" },
      { name: "description", content: "Private companion for a personal AI operations hub." },
      { property: "og:title", content: "Agent Hub" },
      { property: "og:description", content: "Private companion for a personal AI operations hub." },
    ],
  }),
  component: SignIn,
});

function SignIn() {
  const navigate = useNavigate();
  const send = useServerFn(requestMagicLink);
  const checkAllowed = useServerFn(isSessionAllowed);
  const [email, setEmail] = useState("");
  const [pending, setPending] = useState(false);
  const [applePending, setApplePending] = useState(false);
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null);

  useEffect(() => {
    let active = true;
    supabase.auth.getSession().then(async ({ data }) => {
      if (!active || !data.session) return;
      // Social sign-in bypasses the magic-link allowlist, so every session is
      // re-checked server-side before the workspace is shown.
      const allowed = await checkAllowed({}).catch(() => ({ ok: false }));
      if (!active) return;
      if (allowed.ok) {
        navigate({ to: "/overview", replace: true });
      } else {
        await supabase.auth.signOut();
        setMessage({ ok: false, text: "This instance is private." });
      }
    });
    return () => {
      active = false;
    };
  }, [navigate, checkAllowed]);

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

  async function onApple() {
    setApplePending(true);
    setMessage(null);
    const result = await lovable.auth.signInWithOAuth("apple", {
      redirect_uri: window.location.origin,
    });

    if (result.error) {
      setMessage({ ok: false, text: "Apple sign-in failed." });
      setApplePending(false);
      return;
    }
    if (result.redirected) return;

    const allowed = await checkAllowed({}).catch(() => ({ ok: false }));
    if (allowed.ok) {
      navigate({ to: "/overview", replace: true });
    } else {
      await supabase.auth.signOut();
      setMessage({ ok: false, text: "This instance is private." });
    }
    setApplePending(false);
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

        <div className="mt-6 flex items-center gap-3">
          <span className="h-px flex-1 bg-rule" />
          <span className="font-mono text-[10px] uppercase tracking-[0.18em] text-faint">or</span>
          <span className="h-px flex-1 bg-rule" />
        </div>

        <button
          type="button"
          onClick={onApple}
          disabled={applePending}
          className="mt-6 flex h-11 w-full items-center justify-center gap-2 border border-rule bg-panel2 font-mono text-[12px] uppercase tracking-[0.14em] text-paper transition-colors hover:border-copper hover:text-copper disabled:opacity-50"
        >
          <svg viewBox="0 0 384 512" aria-hidden="true" className="h-4 w-4 fill-current">
            <path d="M318.7 268.7c-.2-36.7 16.4-64.4 50-84.8-18.8-26.9-47.2-41.7-84.7-44.6-35.5-2.8-74.3 20.7-88.5 20.7-15 0-49.4-19.7-76.4-19.7C63.3 141.2 4 184.8 4 273.5q0 39.3 14.4 81.2c12.8 36.7 59 126.7 107.2 125.2 25.2-.6 43-17.9 75.8-17.9 31.8 0 48.3 17.9 76.4 17.9 48.6-.7 90.4-82.5 102.6-119.3-65.2-30.7-61.7-90-61.7-91.9zm-56.6-164.2c27.3-32.4 24.8-61.9 24-72.5-24.1 1.4-52 16.4-67.9 34.9-17.5 19.8-27.8 44.3-25.6 71.9 26.1 2 49.9-11.4 69.5-34.3z" />
          </svg>
          {applePending ? "Signing in" : "Sign in with Apple"}
        </button>



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
