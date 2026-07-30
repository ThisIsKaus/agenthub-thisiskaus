import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { getRequest } from "@tanstack/react-start/server";
import { createClient } from "@supabase/supabase-js";
import { z } from "zod";

const PRIVATE_MESSAGE = "This instance is private.";

const inputSchema = z.object({
  email: z.string().trim().toLowerCase().email().max(255),
});

/**
 * Sends a magic link, but only to the single address held in the
 * ALLOWED_EMAIL secret. Every other address is refused server-side and
 * no email is sent.
 */
export const requestMagicLink = createServerFn({ method: "POST" })
  .inputValidator((data: unknown) => inputSchema.parse(data))
  .handler(async ({ data }) => {
    const allowed = (process.env.ALLOWED_EMAIL ?? "").trim().toLowerCase();

    if (!allowed || data.email !== allowed) {
      return { ok: false as const, message: PRIVATE_MESSAGE };
    }

    const url = process.env.SUPABASE_URL!;
    const key = process.env.SUPABASE_PUBLISHABLE_KEY!;

    const supabase = createClient(url, key, {
      auth: { persistSession: false, autoRefreshToken: false },
      global: {
        fetch: (input, init) => {
          const headers = new Headers(init?.headers);
          if (key.startsWith("sb_") && headers.get("Authorization") === `Bearer ${key}`) {
            headers.delete("Authorization");
          }
          headers.set("apikey", key);
          return fetch(input, { ...init, headers });
        },
      },
    });

    const request = getRequest();
    const origin =
      request?.headers.get("origin") ??
      (request?.url ? new URL(request.url).origin : undefined);

    const { error } = await supabase.auth.signInWithOtp({
      email: data.email,
      options: {
        shouldCreateUser: true,
        emailRedirectTo: origin,
      },
    });

    if (error) {
      console.error("[auth] magic link failed", error.message);
      return { ok: false as const, message: "Could not send the link. Try again." };
    }

    return { ok: true as const, message: "Link sent. Check your inbox." };
  });

/**
 * Social sign-in bypasses the magic-link allowlist, so the resulting session
 * is re-checked server-side against ALLOWED_EMAIL before the app is shown.
 */
export const isSessionAllowed = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const allowed = (process.env.ALLOWED_EMAIL ?? "").trim().toLowerCase();
    const email = String((context.claims as { email?: string })?.email ?? "")
      .trim()
      .toLowerCase();
    return { ok: Boolean(allowed) && email === allowed };
  });
