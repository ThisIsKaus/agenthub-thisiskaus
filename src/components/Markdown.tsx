/**
 * A small markdown reader for skill bodies.
 *
 * Skill files use a narrow subset — headings, lists, fenced code, bold and
 * inline code — so a dependency would buy nothing but weight. Nothing here
 * renders raw HTML: text is always placed as text.
 */
import { Fragment, type ReactNode } from "react";

/** `code`, **bold**, *italic* — applied in that order so code stays literal. */
function inline(text: string, keyPrefix: string): ReactNode[] {
  const out: ReactNode[] = [];
  const pattern = /`([^`]+)`|\*\*([^*]+)\*\*|\*([^*]+)\*/g;
  let last = 0;
  let match: RegExpExecArray | null;
  let index = 0;
  while ((match = pattern.exec(text))) {
    if (match.index > last) out.push(text.slice(last, match.index));
    const key = `${keyPrefix}-${index++}`;
    if (match[1] != null) {
      out.push(
        <code key={key} className="border border-rule bg-panel px-1 font-mono text-[11px] text-copper">
          {match[1]}
        </code>,
      );
    } else if (match[2] != null) {
      out.push(
        <strong key={key} className="font-medium text-paper">
          {match[2]}
        </strong>,
      );
    } else {
      out.push(
        <em key={key} className="italic">
          {match[3]}
        </em>,
      );
    }
    last = pattern.lastIndex;
  }
  if (last < text.length) out.push(text.slice(last));
  return out;
}

export function Markdown({ text }: { text: string }) {
  const lines = text.replace(/\r\n/g, "\n").split("\n");
  const blocks: ReactNode[] = [];
  let list: string[] = [];
  let code: string[] | null = null;

  const flushList = (key: string) => {
    if (!list.length) return;
    blocks.push(
      <ul key={key} className="max-w-[72ch] list-disc space-y-1 pl-5 text-[14px] leading-[1.7] text-muted-foreground">
        {list.map((item, index) => (
          <li key={index}>{inline(item, `${key}-${index}`)}</li>
        ))}
      </ul>,
    );
    list = [];
  };

  lines.forEach((line, index) => {
    const key = `b${index}`;
    if (line.trim().startsWith("```")) {
      if (code) {
        blocks.push(
          <pre
            key={key}
            className="max-w-full overflow-x-auto border border-rule bg-panel p-3 font-mono text-[11px] leading-relaxed text-paper"
          >
            {code.join("\n")}
          </pre>,
        );
        code = null;
      } else {
        flushList(`${key}-l`);
        code = [];
      }
      return;
    }
    if (code) {
      code.push(line);
      return;
    }
    const bullet = /^\s*[-*+]\s+(.*)$/.exec(line);
    if (bullet) {
      list.push(bullet[1]);
      return;
    }
    flushList(`${key}-l`);
    const heading = /^(#{1,6})\s+(.*)$/.exec(line);
    if (heading) {
      const level = heading[1].length;
      blocks.push(
        <p
          key={key}
          className={
            level <= 2
              ? "font-serif text-[15px] font-medium text-paper"
              : "font-mono text-[10px] uppercase tracking-[0.14em] text-faint"
          }
        >
          {heading[2]}
        </p>,
      );
      return;
    }
    if (!line.trim()) return;
    blocks.push(
      <p key={key} className="max-w-[72ch] text-[14px] leading-[1.7] text-muted-foreground">
        {inline(line, key)}
      </p>,
    );
  });
  flushList("tail-l");
  if (code) {
    blocks.push(
      <pre key="tail-code" className="overflow-x-auto border border-rule bg-panel p-3 font-mono text-[11px] text-paper">
        {code.join("\n")}
      </pre>,
    );
  }

  if (!blocks.length) {
    return <p className="font-mono text-[10px] text-faint">this skill has no body yet</p>;
  }
  return <div className="space-y-2">{blocks.map((block, index) => <Fragment key={index}>{block}</Fragment>)}</div>;
}
