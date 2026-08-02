import type { ReactNode } from "react";

/**
 * The one page frame. Every route renders inside it.
 * It owns the container width, the heading, the vertical rhythm and the footer,
 * so no later change can invent its own layout.
 *
 *   container : 86vw (7% clear each side), max 1240px, centred — never full-bleed
 *               the same 86vw applies at every breakpoint, mobile included
 *   title     : Instrument Serif 31px, sentence case
 *   subtitle  : secondary text, capped at 72ch
 *   children  : stacked with 56px between major sections
 *   footer    : Geist Mono 11px tertiary, always present
 */
export function Page({
  title,
  subtitle,
  footer,
  children,
}: {
  title: string;
  subtitle?: ReactNode;
  footer: string;
  children: ReactNode;
}) {
  return (
    <div className="page-container">
      <header className="border-b border-rule pb-4">
        <h1 className="font-serif text-[31px] leading-[1.1] text-paper">{title}</h1>
        {subtitle ? (
          <p className="mt-2 max-w-[72ch] text-[14px] leading-relaxed text-muted-foreground">
            {subtitle}
          </p>
        ) : null}
      </header>

      <div className="page-stack">{children}</div>

      <footer className="border-t border-rule pt-4">
        <p className="font-mono text-[11px] leading-relaxed text-faint">{footer}</p>
      </footer>
    </div>
  );
}
