const SW_URL = "/sw.js";

function isPreviewHost(hostname: string) {
  return (
    hostname.startsWith("id-preview--") ||
    hostname.startsWith("preview--") ||
    hostname === "lovableproject.com" ||
    hostname.endsWith(".lovableproject.com") ||
    hostname === "lovableproject-dev.com" ||
    hostname.endsWith(".lovableproject-dev.com") ||
    hostname === "beta.lovable.dev" ||
    hostname.endsWith(".beta.lovable.dev")
  );
}

async function unregisterAppWorkers() {
  if (!("serviceWorker" in navigator)) return;
  const registrations = await navigator.serviceWorker.getRegistrations();
  await Promise.allSettled(
    registrations
      .filter((registration) => (registration.active?.scriptURL ?? "").endsWith(SW_URL))
      .map((registration) => registration.unregister()),
  );
}

/**
 * Registers the app-shell service worker, but only in the real published app.
 * Dev, iframes, Lovable preview hosts and ?sw=off unregister instead.
 */
export function registerServiceWorker() {
  if (typeof window === "undefined" || !("serviceWorker" in navigator)) return;

  const refuse =
    !import.meta.env.PROD ||
    window.self !== window.top ||
    isPreviewHost(window.location.hostname) ||
    new URLSearchParams(window.location.search).has("sw") ||
    new URL(window.location.href).searchParams.get("sw") === "off";

  if (refuse) {
    void unregisterAppWorkers();
    return;
  }

  navigator.serviceWorker.register(SW_URL, { scope: "/" }).catch(() => {
    /* offline-first is best effort; never break the app over it */
  });
}

const RECOVERY_FLAG = "agenthub:shell-recovered";

/**
 * An earlier service worker served the cached "/" document for every deep link,
 * so the router booted with the wrong payload and threw "Invariant failed".
 * A device that still holds that cache self-heals here: drop the caches, drop
 * the worker, reload once.
 */
export function installStaleShellRecovery() {
  if (typeof window === "undefined") return;

  window.addEventListener("error", (event) => {
    const message = String(event.message ?? (event.error as Error | undefined)?.message ?? "");
    if (!/invariant failed/i.test(message)) return;
    if (sessionStorage.getItem(RECOVERY_FLAG)) return;
    sessionStorage.setItem(RECOVERY_FLAG, "1");
    void (async () => {
      try {
        if ("caches" in window) {
          const names = await caches.keys();
          await Promise.allSettled(names.map((name) => caches.delete(name)));
        }
        await unregisterAppWorkers();
      } finally {
        window.location.reload();
      }
    })();
  });
}

