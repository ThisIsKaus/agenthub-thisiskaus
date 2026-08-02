/**
 * Progressive ask.
 *
 * Retrieval returns in well under a second; a local 35B takes 45 to 90 seconds
 * to write. Rendering both at the end wastes the difference, so this helper
 * surfaces the sources the moment they are known and streams the answer beneath
 * them.
 *
 * It prefers `POST /api/ask/stream` (NDJSON: one `{sources}` line, then
 * `{delta}` lines, then `{done}`). Machines that do not expose it fall back to
 * the single-shot `POST /api/ask` — the caller's code path is identical either
 * way, it simply sees sources and answer arrive together.
 */

import { loopbackInit } from "./local-bridge";

export type AskSource = { file?: string; path?: string; distance?: number };


export type AskStreamResult = {
  answer: string;
  model?: string;
  sources: AskSource[];
  /** True when the answer arrived progressively rather than in one piece. */
  streamed: boolean;
};

type Poster = <T>(path: string, fields: Record<string, string | undefined>) => Promise<T>;

export async function askProgressive(
  base: string,
  post: Poster,
  input: { q: string; model: string; k: number },
  on: { sources?: (sources: AskSource[]) => void; delta?: (answer: string) => void },
): Promise<AskStreamResult> {
  const streamed = await tryStream(base, input, on);
  if (streamed) return streamed;

  const data = await post<{ answer?: string; model?: string; sources?: AskSource[] }>("/api/ask", {
    q: input.q,
    model: input.model,
    k: String(input.k),
  });
  const sources = data.sources ?? [];
  on.sources?.(sources);
  return { answer: data.answer ?? "", model: data.model, sources, streamed: false };
}

async function tryStream(
  base: string,
  input: { q: string; model: string; k: number },
  on: { sources?: (sources: AskSource[]) => void; delta?: (answer: string) => void },
): Promise<AskStreamResult | null> {
  const body = new FormData();
  body.set("q", input.q);
  body.set("model", input.model);
  body.set("k", String(input.k));

  let response: Response;
  try {
    response = await fetch(
      `${base}/api/ask/stream`,
      loopbackInit({ method: "POST", body }),
    );

  } catch {
    return null;
  }

  // 404/405 means this machine has no streaming endpoint yet. A 403 is a
  // refusal and belongs to the caller, so let the fallback carry it.
  if (!response.ok || !response.body) return null;

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let answer = "";
  let model: string | undefined;
  let sources: AskSource[] = [];

  const handle = (line: string) => {
    const trimmed = line.trim();
    if (!trimmed) return;
    let event: { sources?: AskSource[]; delta?: string; answer?: string; model?: string };
    try {
      event = JSON.parse(trimmed);
    } catch {
      // Plain text chunks are treated as answer text.
      answer += trimmed;
      on.delta?.(answer);
      return;
    }
    if (event.model) model = event.model;
    if (event.sources) {
      sources = event.sources;
      on.sources?.(sources);
    }
    if (typeof event.delta === "string") {
      answer += event.delta;
      on.delta?.(answer);
    }
    if (typeof event.answer === "string" && !answer) {
      answer = event.answer;
      on.delta?.(answer);
    }
  };

  for (;;) {
    const { value, done } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split("\n");
    buffer = lines.pop() ?? "";
    for (const line of lines) handle(line);
  }
  if (buffer) handle(buffer);

  if (!answer && sources.length === 0) return null;
  return { answer, model, sources, streamed: true };
}
