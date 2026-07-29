import { useEffect, useState } from "react";

type BeforeInstallPromptEvent = Event & {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: "accepted" | "dismissed" }>;
};

const DISMISS_KEY = "agenthub:install-dismissed";

export function InstallPrompt() {
  const [event, setEvent] = useState<BeforeInstallPromptEvent | null>(null);

  useEffect(() => {
    if (localStorage.getItem(DISMISS_KEY)) return;
    const onPrompt = (e: Event) => {
      e.preventDefault();
      setEvent(e as BeforeInstallPromptEvent);
    };
    window.addEventListener("beforeinstallprompt", onPrompt);
    return () => window.removeEventListener("beforeinstallprompt", onPrompt);
  }, []);

  function dismiss() {
    localStorage.setItem(DISMISS_KEY, "1");
    setEvent(null);
  }

  if (!event) return null;

  return (
    <div className="mb-6 flex flex-wrap items-center justify-between gap-3 border border-rule bg-panel2 px-4 py-3">
      <p className="font-mono text-[11px] uppercase tracking-[0.14em] text-faint">
        Add AgentHub to the home screen
      </p>
      <div className="flex gap-2">
        <button
          onClick={async () => {
            await event.prompt();
            await event.userChoice;
            dismiss();
          }}
          className="border border-copper px-3 py-1 font-mono text-[11px] uppercase tracking-[0.14em] text-copper transition-colors hover:bg-copper hover:text-ink"
        >
          Install
        </button>
        <button
          onClick={dismiss}
          className="px-2 font-mono text-[11px] uppercase tracking-[0.14em] text-faint transition-colors hover:text-paper"
        >
          Not now
        </button>
      </div>
    </div>
  );
}
