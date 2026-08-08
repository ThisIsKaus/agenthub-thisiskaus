import type { ReactNode } from "react";

/**
 * <Section> owns every second-level heading in the app.
 *
 *   heading  : Bricolage Grotesque 500, exactly 25px, -0.42px, sentence case
 *   rhythm   : 56px above, 24px below the heading
 *   subtitle : secondary text, capped at 72ch
 *
 * No view may set its own h2 size. Use `flush` inside a panel where the
 * 56px lead-in would double an existing gap.
 */
export function SectionHeading({
  children,
  note,
}: {
  children: ReactNode;
  note?: ReactNode;
}) {
  return (
    <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
      <h2 className="font-serif text-[25px] leading-[1.15] text-paper">{children}</h2>
      {note ? <span className="mono-label text-faint">{note}</span> : null}
    </div>
  );
}

export function Section({
  title,
  note,
  subtitle,
  flush = false,
  children,
}: {
  title: ReactNode;
  note?: ReactNode;
  subtitle?: ReactNode;
  flush?: boolean;
  children?: ReactNode;
}) {
  return (
    <section className={flush ? "" : "mt-14 first:mt-0"}>
      <SectionHeading note={note}>{title}</SectionHeading>
      {subtitle ? (
        <p className="mt-2 max-w-[72ch] text-[13px] leading-relaxed text-muted-foreground">
          {subtitle}
        </p>
      ) : null}
      {children ? <div className="mt-6">{children}</div> : null}
    </section>
  );
}
